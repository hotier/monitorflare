<template>
  <div class="min-h-screen flex flex-col text-slate-800 dark:text-slate-200 grid-bg">
    <StatusHeader :isDark="isDark" :siteSettings="settings" @toggle-theme="toggleTheme" />

    <main class="flex-1 max-w-5xl w-full mx-auto px-6 py-10">
      <!-- 锁屏(私密模式) -->
      <StatusLockScreen v-if="locked" :title="settings.site_title || 'MonitorFlare'" @unlocked="onUnlocked" />

      <template v-else>
      <!-- 英雄状态区 -->
      <HeroBanner v-if="monitors.length > 0" :monitors="monitors" :activeMonitors="activeMonitors"
        :allUp="allUp" :hasRetrying="hasRetrying" :hasDown="hasDown" :avgLatency="avgLatency" :error="error"
        @retry="loadMonitors" />

      <!-- 加载占位 -->
      <div v-if="loading && monitors.length === 0" class="space-y-3 fade-up-d2">
        <div v-for="i in 4" :key="i" class="glass rounded-2xl h-20 animate-pulse"></div>
      </div>

      <!-- 无监控项 -->
      <div v-if="!loading && monitors.length === 0" class="text-center py-24 glass rounded-2xl border border-dashed border-slate-200 dark:border-white/[0.06] fade-up-d2">
        <div class="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-white/[0.03] flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-slate-300 dark:text-slate-700" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"/>
          </svg>
        </div>
        <p class="text-slate-400 dark:text-slate-600 text-sm tracking-widest">{{ $t('statusPage.noMonitorsConfigured') }}</p>
      </div>

      <!-- 事件公告 -->
      <div v-if="incidents.length > 0" class="mb-6 space-y-2 fade-up">
        <div v-for="inc in incidents" :key="inc.id"
          class="rounded-2xl px-5 py-4 border flex items-start gap-4"
          :class="{
            'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-500/20': inc.severity === 'critical',
            'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-500/20': inc.severity === 'warning',
            'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-500/20': inc.severity === 'info'
          }">
          <i class="fas text-lg mt-0.5" :class="{
            'fa-exclamation-circle text-red-500': inc.severity === 'critical',
            'fa-exclamation-triangle text-yellow-500': inc.severity === 'warning',
            'fa-info-circle text-blue-500': inc.severity === 'info'
          }"></i>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sm text-slate-900 dark:text-white">{{ inc.title }}</p>
            <p v-if="inc.description" class="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{{ inc.description }}</p>
            <p class="text-xs text-slate-400 dark:text-slate-500 mt-1 font-mono">{{ formatDate(inc.created_at) }}</p>
          </div>
        </div>
      </div>

      <!-- 监控列表 -->
      <div v-if="monitors.length > 0" class="fade-up-d1">
        <div class="flex items-center justify-between mb-5">
          <div class="flex items-center gap-3">
            <div class="w-1 h-5 rounded-full bg-emerald-500"></div>
            <h2 class="text-sm font-bold text-slate-600 dark:text-slate-400">{{ $t('statusPage.serviceStatus') }}</h2>
            <span v-if="lastUpdated" class="text-[11px] font-mono text-slate-400 dark:text-slate-500">{{ lastUpdated }}</span>
          </div>
          <div class="flex items-center gap-3 text-[11px] font-mono text-slate-500 dark:text-slate-600">
            <span class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500/50"></span>
              {{ $t('statusPage.activeMonitors', { count: activeMonitors.length }) }}
            </span>
          </div>
        </div>

        <div class="space-y-6">
          <section v-for="section in monitorSections" :key="section.name" class="space-y-3">
            <div v-if="monitorSections.length > 1" class="flex items-center justify-between">
              <h3 class="text-xs font-bold text-slate-500 dark:text-slate-500 flex items-center gap-2">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                {{ section.name }}
              </h3>
              <span class="text-[11px] font-mono text-slate-400 dark:text-slate-600">{{ $t('statusPage.items', { count: section.items.length }) }}</span>
            </div>
            <MonitorCard v-for="(m, idx) in section.items" :key="m.id" :monitor="m" :index="idx" />
          </section>
        </div>
      </div>

      <!-- 订阅 / RSS -->
      <div v-if="monitors.length > 0" class="mt-10 fade-up-d3">
        <div class="glass rounded-2xl px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 class="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <i class="fas fa-envelope-open-text text-emerald-500"></i>
              {{ $t('statusPage.subscribe') }}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-500 mt-1">{{ $t('statusPage.subscribeHint') }}</p>
          </div>
          <form class="flex w-full sm:w-auto gap-2" @submit.prevent="subscribe">
            <input v-model="subEmail" type="email" :placeholder="$t('statusPage.emailPlaceholder')"
              class="flex-1 sm:w-64 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 px-4 py-3 text-xs font-mono text-slate-800 dark:text-white outline-none focus:border-emerald-500/60 placeholder-slate-400 dark:placeholder-slate-600">
            <button type="submit" :disabled="subscribing"
              class="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-5 py-2.5 transition-colors disabled:opacity-60 cursor-pointer">
              <i class="fas" :class="subscribing ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'"></i>
            </button>
          </form>
        </div>
        <div class="mt-3 flex items-center justify-between text-xs text-slate-400 dark:text-slate-600">
          <span v-if="subMsg" :class="subOk ? 'text-emerald-500' : 'text-red-500'">{{ subMsg }}</span>
          <a :href="`${API_BASE}/feed.xml`" target="_blank" class="flex items-center gap-1.5 hover:text-emerald-500 transition-colors">
            <i class="fas fa-rss text-orange-500"></i> {{ $t('statusPage.rssFeed') }}
          </a>
        </div>
      </div>
      </template>
    </main>

    <StatusFooter :loading="loading" :refreshing="refreshing" :canLogout="!locked && !!statusToken" @refresh="manualRefresh" @logout="onLogout" />
  </div>
</template>

<script setup>
// 组件名是 <keep-alive :include="[...]"> 的匹配依据(App.vue),改名会直接导致缓存失效
defineOptions({ name: 'StatusPage' });

import { ref, computed, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTheme } from '../composables/useTheme';
import { API_BASE, fetchT, isStatusLocked, statusLogout, STATUS_TOKEN_KEY } from '../utils/api';
import { formatDate, formatNow } from '../utils/format';
// 跨页共享的数据。这些资源是模块级的,切页不会丢 —— 有数据时 loading 保持 false,
// 所以从详情页/管理页切回来是直接渲染,不再闪骨架屏。
import * as resources from '../composables/resources';

import StatusHeader from '../components/status/StatusHeader.vue';
import HeroBanner from '../components/status/HeroBanner.vue';
import MonitorCard from '../components/status/MonitorCard.vue';
import StatusFooter from '../components/status/StatusFooter.vue';
import StatusLockScreen from '../components/status/StatusLockScreen.vue';

const { t } = useI18n();
const { isDark, toggleTheme } = useTheme('theme');

/** 资源首次加载完成前 data 是 null,模板直接取字段会报错 —— 用默认值兜底 */
const DEFAULT_SETTINGS = { site_title: 'MonitorFlare', site_description: '', site_logo_url: '' };

const monitors = computed(() => resources.publicMonitors.data.value?.monitors || []);
const incidents = computed(() => resources.publicIncidents.data.value || []);
const settings = computed(() => resources.siteSettings.data.value || DEFAULT_SETTINGS);

/** 骨架屏只在"真的没数据可渲染"时出现,不看 refreshing */
const loading = computed(() => resources.publicMonitors.loading.value);

/** 把资源的 Error 翻译成用户可见文案。locked 单独走锁屏,不当错误报 */
const error = computed(() => {
    const e = resources.publicMonitors.error.value;
    if (!e || e.locked) return null;
    if (e.status) {
        return e.detail
            ? t('statusPage.apiError', { error: e.detail })
            : t('statusPage.serverError', { status: e.status });
    }
    return t('statusPage.connectionTimeout');
});

const lastUpdated = ref('');
const refreshing = ref(false);
const subEmail = ref('');
const subMsg = ref('');
const subOk = ref(false);
const subscribing = ref(false);
const statusToken = ref(localStorage.getItem(STATUS_TOKEN_KEY) || '');

/**
 * 手动置为锁定态。用户主动退出、或订阅接口返回锁定时用。
 * 计算属性不能直接写,所以需要一个本地标志跟资源的 locked 做"或"。
 */
const forceLocked = ref(false);
const locked = computed(() => forceLocked.value
    || resources.publicMonitors.locked.value
    || resources.publicIncidents.locked.value
    || resources.siteSettings.locked.value);

const activeMonitors = computed(() => monitors.value.filter(m => m.paused !== 1 && m.status !== 'PAUSED'));
const allUp = computed(() => activeMonitors.value.length > 0 && activeMonitors.value.every(m => m.status === 'UP'));
const hasRetrying = computed(() => activeMonitors.value.some(m => m.status === 'RETRYING'));
const hasDown = computed(() => activeMonitors.value.some(m => m.status === 'DOWN'));
const avgLatency = computed(() => {
    const active = activeMonitors.value.filter(m => m.latency != null);
    if (active.length === 0) return null;
    return Math.round(active.reduce((sum, m) => sum + m.latency, 0) / active.length);
});
const monitorSections = computed(() => {
    const groups = new Map();
    for (const monitor of monitors.value) {
        const tag = (monitor.tags || '').split(',').map(x => x.trim()).filter(Boolean)[0] || t('statusPage.ungrouped');
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag).push(monitor);
    }
    return [...groups.entries()].map(([name, items]) => ({ name, items }));
});

/**
 * 品牌信息写进 document.title / meta
 *
 * 单独抽出来是因为详情页也会改标题,从详情返回时必须重新盖回站点标题 ——
 * 只在 watch 里做会漏掉"数据没变但标题被别人改过"的情况。
 */
const applyBranding = () => {
    if (settings.value.site_title) document.title = settings.value.site_title;
    const meta = document.querySelector('meta[name=description]');
    if (meta && settings.value.site_description) meta.content = settings.value.site_description;
};

const loadMonitors = async () => {
    await resources.publicMonitors.ensure();
    // 命中缓存直接返回时这里的 formatNow 会有最多 ttl(15s)的偏差,
    // 但展示的是"数据的新鲜程度",可接受;失败时不动,避免给出误导性时间
    if (!resources.publicMonitors.error.value) lastUpdated.value = formatNow();
};

const manualRefresh = async () => {
    refreshing.value = true;
    await resources.publicMonitors.refresh();
    if (!resources.publicMonitors.error.value) lastUpdated.value = formatNow();
    setTimeout(() => { refreshing.value = false; }, 700);
};

const fetchIncidents = () => resources.publicIncidents.ensure();
const fetchSettings = async () => {
    await resources.siteSettings.ensure();
    applyBranding();
};

const onUnlocked = () => {
    forceLocked.value = false;
    statusToken.value = localStorage.getItem(STATUS_TOKEN_KEY) || '';
    // 解锁换了 token,之前被 401 挡下的数据和 locked 标记都要清掉重来
    resources.publicMonitors.invalidate();
    resources.publicIncidents.invalidate();
    resources.siteSettings.invalidate();
    loadMonitors();
    fetchIncidents();
    fetchSettings();
};

const onLogout = () => {
    statusLogout();
    statusToken.value = '';
    // 连持久化快照一起清:私密模式退出后不该还能从 localStorage 读回内容
    resources.publicMonitors.invalidate();
    resources.publicIncidents.invalidate();
    resources.siteSettings.invalidate();
    forceLocked.value = true;
    window.scrollTo({ top: 0 });
};

const subscribe = async () => {
    if (!subEmail.value || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(subEmail.value)) {
        subOk.value = false;
        subMsg.value = t('statusPage.invalidEmail');
        return;
    }
    subscribing.value = true;
    try {
        const r = await fetchT(`${API_BASE}/api/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: subEmail.value }),
        });
        subOk.value = r.ok;
        // locked 是只读 computed,这里要写的是它背后的手动锁定标志
        if (await isStatusLocked(r)) { forceLocked.value = true; return; }
        subMsg.value = r.ok ? t('statusPage.subscribed') : t('common.actionFailed');
        if (r.ok) subEmail.value = '';
    } catch {
        subOk.value = false;
        subMsg.value = t('common.networkError');
    } finally {
        subscribing.value = false;
    }
};

// ── 轮询的启停 ──
// 页面被 keep-alive 缓存后 onUnmounted 不会触发,清理逻辑必须挂到 onDeactivated 上,
// 否则停在别的页面时这里还在每 30 秒打一次接口。
// start 做成幂等:首次进入时 onMounted 与 onActivated 会连续触发,不能装两个定时器。
let _timer = null;
// 60 秒一次:服务端对公开接口有 30s 内存缓存 + 边缘缓存,再快也拿不到更新的数据。
// 页面切到后台时不轮询,重新可见时立刻补一次。
const onVisibility = () => { if (!document.hidden && !locked.value) loadMonitors(); };
const startPolling = () => {
    if (_timer) return;
    _timer = setInterval(() => { if (!locked.value && !document.hidden) loadMonitors(); }, 60000);
    document.addEventListener('visibilitychange', onVisibility);
};
const stopPolling = () => {
    if (_timer) { clearInterval(_timer); _timer = null; }
    document.removeEventListener('visibilitychange', onVisibility);
};

onMounted(() => {
    loadMonitors();
    fetchIncidents();
    fetchSettings();
    startPolling();
});
// 从别的页面切回来:数据若已过期就静默刷新(不会闪骨架屏)
onActivated(() => {
    startPolling();
    applyBranding();          // 详情页可能改过标题,回列表时要盖回来
    loadMonitors();
    fetchIncidents();
});
onDeactivated(stopPolling);
onUnmounted(stopPolling);
</script>
