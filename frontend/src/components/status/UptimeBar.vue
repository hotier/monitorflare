<template>
  <div class="monitor-row3 mt-4" :style="{ '--bar-h': `${height}px` }">
    <div class="uptime-bar-track">
      <div v-for="(day, i) in displayDays" :key="i" class="uptime-bar-cell">
        <template v-if="day.started">
          <span class="uptime-bar-fill" :class="dayColorClass(day)"></span>
          <div class="uptime-tooltip hover-tip tip-arrow-down">
            {{ day.date }} ·
            <span v-if="day.total > 0">{{ ((day.up / day.total) * 100).toFixed(1) }}%</span>
            <span v-else>{{ $t('uptimeBar.noData') }}</span>
          </div>
        </template>
      </div>
    </div>
    <div class="flex justify-between items-center gap-2 mt-1.5">
      <span class="text-[10px] font-mono text-slate-400/60 dark:text-slate-600/60">{{ fullWindow ? $t('uptimeBar.daysAgo', { days: slotCount }) : firstDate }}</span>
      <div class="flex items-center gap-2.5">
        <span v-if="fullWindow" class="text-[10px] font-mono text-slate-400/60 dark:text-slate-600/60">{{ $t('uptimeBar.today') }}</span>
        <!-- 尾部插槽:详情页用它把可用率数字排到"今天"右边同一行 -->
        <slot name="tail" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { localDateStr, todayLocalDateStr, shiftDateStr } from '../../utils/format';

const props = defineProps({
    monitor: { type: Object, required: true },
    /** 窗口天数,也是格子数:详情页可在 7 / 30 / 90 之间切换 */
    days: { type: Number, default: 90 },
    /** 色块高度(px):详情页的条比首页卡片里的更高一些 */
    height: { type: Number, default: 18 },
});

const DAY_MS = 86400000;

/** 格子数 = 窗口天数 */
const slotCount = computed(() => Math.max(1, Math.round(props.days)));

/** 两个 YYYY-MM-DD 之间的整天数(用 UTC 锚点做纯日历运算,避开夏令时干扰) */
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * 生成 slotCount 个格子的日期数组(左 → 右 = 旧 → 新,左端是创建日)。
 * 日期轴按应用时区(设置里的 timezone)切天,与后端 daily_stats 的分桶口径完全一致——
 * 否则凌晨时段两边会差一天,出现"11 号创建却有 10 号记录"这种对不上的情况。
 * 起点锚定监控创建日:创建当天就占最左边第一格,之后一天天长出来;
 * 历史填满整个窗口后整体右移,恒定显示最近 N 天。
 * 所以今天刚添加的监控,当天那根绿条就在最左边。
 */
const displayDays = computed(() => {
    const slots = slotCount.value;
    const stats = props.monitor.daily_stats || [];
    const map = {};
    stats.forEach(s => { map[s.date] = s; });

    const todayStr = todayLocalDateStr();                      // 应用时区下的今天
    const createdStr = localDateStr(props.monitor.created_at); // 创建日也按同一时区取
    // spanBack = 今天往前回看的格子数;创建日缺失或早于窗口时恒为 slots-1(即最近 N 天)
    const spanBack = createdStr
        ? Math.min(slots - 1, Math.max(0, daysBetween(createdStr, todayStr)))
        : slots - 1;

    const days = [];
    for (let i = 0; i < slots; i++) {
        const ds = shiftDateStr(todayStr, i - spanBack);
        const s = map[ds];
        // i > spanBack 的格子落在今天之后(还没发生),不画色块,条就贴着最左边一天天长
        days.push({ date: ds, up: s ? s.up : 0, total: s ? s.total : 0, started: i <= spanBack });
    }
    return days;
});

/** 是否铺满整个窗口(否则说明监控创建不满 N 天,窗口右端还没到今天就结束了) */
const fullWindow = computed(() => displayDays.value[slotCount.value - 1].started);
/** 窗口起点日期(MM-DD),数据不足时用来替换左侧的"N 天前" */
const firstDate = computed(() => displayDays.value[0].date.slice(5));

/** 色块配色:无数据灰、≥99.9% 绿、≥95% 黄、其余红(只有 started 的格子才会渲染色块) */
const dayColorClass = (day) => {
    if (day.total === 0) return 'bg-slate-200/80 dark:bg-slate-800/60';
    const pct = (day.up / day.total) * 100;
    if (pct >= 99.9) return 'bg-emerald-400 dark:bg-emerald-500';
    if (pct >= 95)   return 'bg-yellow-400 dark:bg-yellow-500';
    return 'bg-red-400 dark:bg-red-500';
};
</script>
