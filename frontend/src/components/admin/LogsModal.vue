<template>
  <transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm admin-modal-overlay" @click="$emit('close')"></div>
      <div class="relative w-full max-w-4xl glass admin-modal rounded-2xl shadow-2xl flex flex-col overflow-hidden" style="animation:modal-in 0.25s ease-out; max-height: 85vh">
        <div class="px-8 pt-5 pb-4 flex justify-between items-center">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0"><i class="fas fa-list-ul text-blue-500 dark:text-blue-400"></i></div>
            <div><h3 class="text-base font-bold text-white">{{ monitor?.name }}</h3><p class="text-xs text-slate-500 mt-0.5 font-mono">{{ $t('logs.tagline') }}</p></div>
          </div>
          <button @click="$emit('close')" class="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer" :aria-label="$t('common.close')"><i class="fas fa-times text-lg"></i></button>
        </div>

        <!-- Uptime 统计 + P95/P99 -->
        <div v-if="uptimeStats && (uptimeStats.h24 !== null || uptimeStats.d7 !== null)" class="px-8 py-3 border-b border-white/5 bg-slate-900/30">
          <div class="flex items-center gap-6 text-xs flex-wrap">
            <div v-for="stat in [{labelKey:'stats.uptime24h', val: uptimeStats.h24},{labelKey:'stats.uptime7d', val: uptimeStats.d7},{labelKey:'stats.uptime30d', val: uptimeStats.d30}]" :key="stat.labelKey">
              <span class="text-slate-400 font-medium">{{ $t(stat.labelKey) }}</span>
              <span class="font-mono font-bold ml-1.5" :class="stat.val === null ? 'text-slate-500' : Number(stat.val) >= 99 ? 'text-green-400' : Number(stat.val) >= 95 ? 'text-yellow-400' : 'text-red-400'">{{ stat.val !== null ? stat.val + '%' : $t('logs.na') }}</span>
            </div>
            <div class="h-3 w-px bg-white/10"></div>
            <div v-if="latencyPercentiles"><span class="text-slate-400 font-medium">P95</span><span class="font-mono font-bold ml-1 text-sky-400">{{ latencyPercentiles.p95 }}ms</span></div>
            <div v-if="latencyPercentiles"><span class="text-slate-400 font-medium">P99</span><span class="font-mono font-bold ml-1 text-orange-400">{{ latencyPercentiles.p99 }}ms</span></div>
          </div>
        </div>

        <!-- Sparkline 折线图:可交互(悬停查看 / 点击固定 / 方向键切换),与监控详情页同一套做法 -->
        <div v-if="logs.length > 1 && sparkline" class="px-8 py-4 border-b border-white/5 sparkline-container bg-slate-900/20">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">{{ $t('logs.latencyTrend') }}</span>
            <span class="text-xs text-slate-500 font-mono">{{ $t('logs.maxLatency', { max: sparkline.maxL }) }}</span>
          </div>
          <div class="relative select-none cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
            tabindex="0"
            @pointermove="onChartPointer" @pointerleave="onChartLeave" @click="onChartClick" @keydown="onChartKeydown" @blur="onChartBlur">
            <svg :viewBox="`0 0 ${sparkline.W} ${sparkline.H}`" class="w-full block" :style="{ height: sparkline.H + 'px' }" preserveAspectRatio="none">
              <defs>
                <!-- 面积渐变:与监控详情页延迟趋势图同一套参数(顶部 25% 主题色 → 底部透明) -->
                <linearGradient id="logs-latency-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#22c55e" stop-opacity="0.25" />
                  <stop offset="100%" stop-color="#22c55e" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path :d="sparkline.area" fill="url(#logs-latency-grad)" />
              <path :d="sparkline.path" fill="none" stroke="#22c55e" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
              <circle v-for="(p, i) in sparkline.points" :key="i" :cx="p.x" :cy="p.y" r="3" :fill="p.fail ? '#ef4444' : '#22c55e'" :opacity="p.fail ? 1 : 0.8" />
              <g v-for="(p, i) in sparkline.points.filter(pt => pt.fail)" :key="'x' + i">
                <line :x1="p.x - 4" :y1="p.y - 4" :x2="p.x + 4" :y2="p.y + 4" stroke="#ef4444" stroke-width="1.5" />
                <line :x1="p.x + 4" :y1="p.y - 4" :x2="p.x - 4" :y2="p.y + 4" stroke="#ef4444" stroke-width="1.5" />
              </g>
              <template v-if="activePoint">
                <line :x1="activePoint.x" :x2="activePoint.x" :y1="0" :y2="sparkline.H" stroke="#e2e8f0" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" />
                <circle :cx="activePoint.x" :cy="activePoint.y" :r="pinIdx !== null ? 4.5 : 4" :fill="activePoint.fail ? '#ef4444' : '#22c55e'" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" />
              </template>
            </svg>

            <!-- 悬浮提示:与延迟趋势页 / 90 天可用性条共用 .hover-tip 外观 -->
            <div v-if="activePoint" class="hover-tip absolute"
              :class="[activePoint.y < 40 ? 'tip-arrow-up' : 'tip-arrow-down', pinIdx !== null ? 'is-pinned' : '']" :style="tooltipStyle">
              <p class="text-slate-400">{{ formatDateTime(activePoint.t) }}</p>
              <p class="font-semibold" :class="latencyTipClass(activePoint.l)">{{ activePoint.l }}ms</p>
            </div>
          </div>
        </div>

        <!-- 日志表格 -->
        <div class="flex-1 min-h-0 overflow-y-auto p-0">
          <table class="w-full text-left border-collapse">
            <thead class="bg-slate-900/50 sticky top-0 z-10">
              <tr>
                <th class="px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider border-b border-slate-700">{{ $t('logs.time') }}</th>
                <th class="px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider border-b border-slate-700">{{ $t('logs.statusCode') }}</th>
                <th class="px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider border-b border-slate-700">{{ $t('logs.latency') }}</th>
                <th class="px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider border-b border-slate-700">{{ $t('logs.reason') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-700/50">
              <tr v-for="log in logs" :key="log.id" class="hover:bg-white/5 transition">
                <td class="px-6 py-3 text-xs font-mono text-slate-400 whitespace-nowrap">{{ formatDateTime(log.created_at) }}</td>
                <td class="px-6 py-3 text-xs font-mono"><span :class="log.status_code >= 200 && log.status_code < 300 ? 'text-green-600' : 'text-red-600'">{{ log.status_code || '-' }}</span></td>
                <td class="px-6 py-3 text-xs font-mono text-slate-400">{{ log.latency }}ms</td>
                <td class="px-6 py-3 text-xs">
                  <span v-if="log.is_fail" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400">{{ log.reason || $t('logs.failed') }}</span>
                  <span v-else class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/15 text-green-400">{{ $t('logs.success') }}</span>
                </td>
              </tr>
              <tr v-if="logs.length === 0 && !logsLoading"><td colspan="4" class="px-6 py-12 text-center text-slate-500">{{ $t('logs.noLogs') }}</td></tr>
              <tr v-if="logsLoading"><td colspan="4" class="px-6 py-12 text-center"><i class="fas fa-circle-notch fa-spin text-green-500 text-xl"></i></td></tr>
            </tbody>
          </table>
          <div v-if="logs.length > 0 && hasMoreLogs && !logsLoading" class="p-4 text-center border-t border-white/5">
            <button @click="$emit('load-more')" class="px-6 py-2 text-xs font-medium text-green-400 hover:text-white bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-xl transition-all cursor-pointer">
              <i class="fas fa-chevron-down mr-1.5"></i>{{ $t('logs.loadMore') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed } from 'vue';
import { formatDateTime, latencyTipClass } from '../../utils/format';

const props = defineProps({ monitor: Object, logs: Array, logsLoading: Boolean, hasMoreLogs: Boolean, sparkline: Object, uptimeStats: Object, latencyPercentiles: Object });
defineEmits(['close', 'load-more']);

/* ---- 延迟趋势图交互:悬停查看、点击固定、方向键切换 ---- */
const hoverIdx = ref(null);
const pinIdx = ref(null);
const activeIdx = computed(() => pinIdx.value ?? hoverIdx.value);
const chartPoints = computed(() => props.sparkline?.points || []);
const activePoint = computed(() => {
    const idx = activeIdx.value;
    const pts = chartPoints.value;
    if (idx === null || idx === undefined || idx < 0 || idx >= pts.length) return null;
    return pts[idx];
});

const nearestIdx = (clientX, el) => {
    const pts = chartPoints.value;
    if (!pts.length || !el || !props.sparkline) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return null;
    const vx = ((clientX - rect.left) / rect.width) * props.sparkline.W;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
        const d = Math.abs(pts[i].x - vx);
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
};

const onChartPointer = (e) => { hoverIdx.value = nearestIdx(e.clientX, e.currentTarget); };
const onChartLeave = () => { hoverIdx.value = null; };
const onChartClick = (e) => {
    const idx = nearestIdx(e.clientX, e.currentTarget);
    if (idx === null) return;
    hoverIdx.value = idx;
    pinIdx.value = pinIdx.value === idx ? null : idx;
};
const onChartBlur = () => { hoverIdx.value = null; pinIdx.value = null; };
const onChartKeydown = (e) => {
    const pts = chartPoints.value;
    if (!pts.length) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const cur = activeIdx.value ?? pts.length - 1;
        const next = Math.min(Math.max(cur + (e.key === 'ArrowRight' ? 1 : -1), 0), pts.length - 1);
        hoverIdx.value = next;
        pinIdx.value = next;
    } else if (e.key === 'Escape') {
        hoverIdx.value = null;
        pinIdx.value = null;
    }
};

/** 提示框定位:贴近数据点,靠近左右边缘时贴边,点位偏上时翻到下方(箭头随之换向) */
const tooltipStyle = computed(() => {
    const p = activePoint.value;
    const sp = props.sparkline;
    if (!p || !sp) return {};
    const xPct = (p.x / sp.W) * 100;
    const shiftX = xPct < 12 ? '0' : xPct > 88 ? '-100%' : '-50%';
    const shiftY = p.y < 40 ? '12px' : 'calc(-100% - 12px)';
    return {
        left: `${xPct}%`,
        top: `${p.y}px`,
        transform: `translate(${shiftX}, ${shiftY})`,
        '--tip-arrow-x': shiftX === '0' ? '12px' : shiftX === '-100%' ? 'calc(100% - 12px)' : '50%',
    };
});
</script>
