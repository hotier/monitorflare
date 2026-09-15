<template>
  <div class="min-h-screen flex flex-col text-slate-800 dark:text-slate-200">
    <!-- 背景光晕 -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none -z-10">
      <div class="absolute -top-40 -right-40 w-[600px] h-[600px] bg-green-600/[0.02] dark:bg-green-600/[0.08] rounded-full blur-3xl"></div>
      <div class="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-blue-600/[0.02] dark:bg-blue-600/[0.06] rounded-full blur-3xl"></div>
    </div>

    <!-- 登录弹窗 -->
    <LoginDialog v-if="!isAuthenticated" @login="onLogin" />

    <!-- 顶部导航 -->
    <AdminHeader v-if="isAuthenticated" :isDark="isDark" :siteSettings="siteSettings"
      @toggle-theme="toggleTheme" @logout="logout" />

    <!-- 主要内容 -->
    <main v-if="isAuthenticated" class="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
      <!-- 页面标题 -->
      <div class="mb-8 fade-up flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{{ $t('adminPage.title') }}</h1>
          <p class="text-slate-500 text-sm mt-0.5">{{ $t('adminPage.subtitle') }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button @click="showIncidents = true" class="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium rounded-xl transition-all cursor-pointer border border-slate-300 dark:border-slate-600/50">
            <i class="fas fa-flag text-xs"></i> {{ $t('adminPage.incidents') }}
          </button>
          <button @click="showSettings = true" class="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium rounded-xl transition-all cursor-pointer border border-slate-300 dark:border-slate-600/50">
            <i class="fas fa-cog text-xs"></i> {{ $t('adminPage.settings') }}
          </button>
          <button @click="showApiKeys = true" class="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium rounded-xl transition-all cursor-pointer border border-slate-300 dark:border-slate-600/50">
            <i class="fas fa-key text-xs"></i> {{ $t('adminPage.apiKeys') }}
          </button>
          <button @click="showChannels = true" class="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium rounded-xl transition-all cursor-pointer border border-slate-300 dark:border-slate-600/50">
            <i class="fas fa-bell text-xs"></i> {{ $t('adminPage.channels') }}
          </button>
          <button @click="showAlertTemplates = true" class="flex items-center gap-1.5 px-3 py-2 bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-medium rounded-xl transition-all cursor-pointer border border-slate-300 dark:border-slate-600/50">
            <i class="fas fa-file-code text-xs"></i> {{ $t('adminPage.alertTemplates') }}
          </button>
          <button @click="showAddModal = true" class="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-xl transition-all hover:shadow-lg hover:shadow-green-500/20 cursor-pointer border border-transparent">
            <i class="fas fa-plus text-xs"></i> {{ $t('adminPage.addMonitor') }}
          </button>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="mb-6 glass rounded-xl p-4 flex items-center gap-3 border border-orange-300 dark:border-orange-500/40 bg-orange-50/80 dark:bg-orange-500/10 fade-up">
        <i class="fas fa-exclamation-circle text-orange-400 shrink-0"></i>
        <p class="text-sm text-orange-300 flex-1">{{ error }}</p>
        <button @click="reloadMonitors" class="text-xs px-3 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 transition-colors font-medium cursor-pointer">{{ $t('common.retry') }}</button>
      </div>

      <!-- 统计概览 -->
      <StatsOverview v-if="isAuthenticated && monitors.length > 0" :stats="stats" />

      <div v-if="isAuthenticated && health" class="mb-6 glass rounded-xl px-4 py-3 fade-up flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span class="font-semibold text-slate-500 dark:text-slate-400">{{ $t('adminPage.systemStatus') }}</span>
        <span class="font-mono text-slate-600 dark:text-slate-300">{{ $t('adminPage.sysDb') }} {{ health.logs }}</span>
        <span class="font-mono text-slate-600 dark:text-slate-300">{{ $t('adminPage.sysChannels') }} {{ health.enabled_channels }}</span>
        <span class="font-mono text-slate-600 dark:text-slate-300">{{ $t('adminPage.sysDaily') }} {{ health.latest_daily_uptime || '-' }}</span>
        <span class="font-mono text-slate-600 dark:text-slate-300">{{ $t('adminPage.sysLast') }} {{ formatDateFull(health.latest_log_at) }}</span>
        <button @click="fetchHealth" class="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold transition cursor-pointer" :class="health.ok ? 'text-emerald-500 hover:bg-emerald-500/10' : 'text-red-400 hover:bg-red-500/10'">
          <i class="fas" :class="health.ok ? 'fa-check-circle' : 'fa-exclamation-circle'"></i>
          {{ health.ok ? $t('adminPage.healthOk') : $t('adminPage.healthBad') }}
        </button>
      </div>

      <!-- 加载占位 -->
      <div v-if="loading && monitors.length === 0" class="space-y-3 fade-up-d2">
        <div v-for="i in 4" :key="i" class="glass rounded-xl h-16 animate-pulse"></div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="monitors.length === 0 && !loading"
        class="text-center py-20 glass rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 fade-up-d2">
        <div class="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
          <i class="fas fa-satellite-dish text-2xl text-slate-400 dark:text-slate-600"></i>
        </div>
        <h3 class="text-lg font-medium text-slate-900 dark:text-white">{{ $t('adminPage.noMonitorsTitle') }}</h3>
        <p class="text-slate-500 mt-1 mb-6 text-sm">{{ $t('adminPage.noMonitorsDesc') }}</p>
        <button @click="showAddModal = true" class="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-bold rounded-xl transition-all shadow-sm hover:shadow-lg hover:shadow-green-500/20 cursor-pointer">
          <i class="fas fa-plus text-xs"></i> {{ $t('adminPage.addFirstMonitor') }}
        </button>
      </div>

      <!-- 监控列表 -->
      <MonitorList v-else
        :monitors="monitors" :filteredMonitors="filteredMonitors" :allTags="allTags"
        :activeTag="activeTag" :selectedIds="selectedIds" :searchQuery="searchQuery" :sortKey="sortKey" :loading="loading" :batchChecking="batchChecking"
        :checkingIds="checkingIds"
        @update:activeTag="activeTag = $event" @update:selectedIds="selectedIds = $event"
        @update:searchQuery="searchQuery = $event" @update:sortKey="sortKey = $event"
        @force-check="forceCheck" @toggle-pause="togglePause" @open-config="openConfig"
        @view-logs="viewLogs" @clone="cloneMonitor" @delete="deleteMonitor"
        @batch-action="batchAction" @reorder="handleReorder" @refresh="reloadMonitors"
      />
    </main>

    <!-- Footer -->
    <footer v-if="isAuthenticated" class="mt-auto py-2.5 border-t border-white/5">
      <div class="max-w-5xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 items-center gap-3">
        <div class="hidden md:block"></div>
        <p class="text-xs text-slate-600 text-center">
          &copy; {{ new Date().getFullYear() }} <a :href="footerUrl" target="_blank" class="hover:text-green-400 transition-colors font-medium">{{ footerAuthor }}</a>. {{ $t('footer.allRightsReserved') }}
        </p>
        <div class="flex items-center justify-center md:justify-self-end gap-4 text-xs text-slate-700 font-mono">
          <span><i class="fas fa-code-branch mr-1"></i>v1.4.0</span>
        </div>
      </div>
    </footer>

    <!-- 所有 Modal -->
    <AddMonitorModal v-if="showAddModal" :newMonitor="newMonitor" :submitting="submitting"
      @close="showAddModal = false" @submit="addMonitor" />

    <ConfigModal v-if="showConfig" :configTarget="configTarget" :configForm="configForm" :configSaving="configSaving"
      :globalRules="globalAlertRules" @close="showConfig = false" @save="saveConfig" />

    <LogsModal v-if="showLogs" :monitor="currentMonitor" :logs="logs" :logsLoading="logsLoading"
      :hasMoreLogs="hasMoreLogs" :sparkline="sparklineComputed" :uptimeStats="uptimeStats" :latencyPercentiles="latencyPercentiles"
      @close="showLogs = false" @load-more="loadMoreLogs" />

    <ChannelsModal v-if="showChannels" @close="showChannels = false" />

    <AlertTemplatesModal v-if="showAlertTemplates" @close="showAlertTemplates = false" />

    <IncidentsModal v-if="showIncidents" :monitors="monitors" @close="showIncidents = false" />

    <SettingsModal v-if="showSettings" :monitors="monitors" @close="showSettings = false" @saved="onSettingsSaved" @import-done="onImportDone" />

    <ApiKeysModal v-if="showApiKeys" @close="showApiKeys = false" />

    <ToastContainer />
  </div>
</template>

<script setup>
// 组件名是 <keep-alive :include="[...]"> 的匹配依据(App.vue),改名会直接导致缓存失效
defineOptions({ name: 'AdminPage' });

import { ref, reactive, computed, watch, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuth } from '../composables/useAuth';
import { useTheme } from '../composables/useTheme';
import { useToast } from '../composables/useToast';
import { useConfirm } from '../composables/useConfirm';
// authFetchT = 带 Bearer 头 + 统一 401 处理(清 session 并回登录页)。
// 原先只有本页内部的 authFetch 做了 401 处理,提到 utils/api 里共享,各弹窗行为一致。
import { API_BASE, authFetchT, ADMIN_TOKEN_KEY } from '../utils/api';
import { formatDateFull } from '../utils/format';
// 列表、自检、站点配置都提到模块级资源,切页回来直接渲染缓存
import * as resources from '../composables/resources';

// 子组件
import LoginDialog from '../components/admin/LoginDialog.vue';
import AdminHeader from '../components/admin/AdminHeader.vue';
import StatsOverview from '../components/admin/StatsOverview.vue';
import MonitorList from '../components/admin/MonitorList.vue';
import AddMonitorModal from '../components/admin/AddMonitorModal.vue';
import ConfigModal from '../components/admin/ConfigModal.vue';
import LogsModal from '../components/admin/LogsModal.vue';
import ChannelsModal from '../components/admin/ChannelsModal.vue';
import AlertTemplatesModal from '../components/admin/AlertTemplatesModal.vue';
import IncidentsModal from '../components/admin/IncidentsModal.vue';
import SettingsModal from '../components/admin/SettingsModal.vue';
import ApiKeysModal from '../components/admin/ApiKeysModal.vue';
import ToastContainer from '../components/admin/ToastContainer.vue';

// 主题 key 与状态页保持一致(localStorage.theme)。
// 若此处单独用别的 key,进入后台时 initTheme 会按「跟随系统」把 <html>.dark 摘掉,导致整页被切回浅色。
const { isDark, toggleTheme } = useTheme('theme');
const { isAuthenticated, storedToken, logout } = useAuth();
const { addToast } = useToast();
const { t } = useI18n();

const footerAuthor = import.meta.env.VITE_FOOTER_AUTHOR || 'MonitorFlare';
const footerUrl = import.meta.env.VITE_FOOTER_URL || '#';

// ── 核心状态 ──
/** 空配置的稳定引用,避免 computed 每次返回新对象导致 watch 空转 */
const EMPTY_SETTINGS = {};

/**
 * 监控列表 = 管理端配置(/monitors) + 公开状态数据(/monitors/public?detail=1)
 *
 * 注意这里返回的是**新对象**(展开合并),不像以前那样就地往 adminData 的元素上挂
 * _latency/_sparkData。原因是 computed 每次重算都会重建数组,任何"挂在监控对象上的
 * 临时标记"都会随之丢失 —— 所以 _checking 这类标记一律改由组件集中持有。
 */
const monitors = computed(() => {
    const pub = new Map((resources.publicMonitors.data.value?.monitors || []).map(m => [m.id, m]));
    return (resources.adminMonitors.data.value || []).map(m => {
        const p = pub.get(m.id);
        return { ...m, _latency: p?.latency ?? null, _sparkData: p?.recent_latencies ?? null };
    });
});
/** 骨架屏只在"还没有列表数据"时出现 */
const loading = computed(() => resources.adminMonitors.loading.value);
const health = computed(() => resources.health.data.value);
const siteSettings = computed(() => resources.siteSettings.data.value || EMPTY_SETTINGS);

const error = computed(() => {
    const e = resources.adminMonitors.error.value;
    if (!e) return null;
    if (e.status) {
        return e.detail
            ? t('statusPage.apiError', { error: e.detail })
            : t('adminPage.loadFailed', { status: e.status });
    }
    return t('statusPage.connectionTimeout');
});

/** 正在手动检测的监控 id。放在这里而不是挂在监控对象上,见 monitors 的注释 */
const checkingIds = reactive(new Set());

// ── 搜索/排序/筛选 ──
const searchQuery = ref('');
const sortKey = ref('');
const activeTag = ref('');
const selectedIds = ref([]);
const batchChecking = ref(false);

// ── Modal 控制 ──
const showAddModal = ref(false);
const showConfig = ref(false);
const showLogs = ref(false);
const showChannels = ref(false);
const showAlertTemplates = ref(false);
const showIncidents = ref(false);
const showSettings = ref(false);
const showApiKeys = ref(false);

// ── 添加监控 ──
const newMonitor = ref({ name: '', url: '', type: 'http', record_type: 'A', expected: '', port: 443, method: 'GET', keyword: '', user_agent: '', tags: '', request_headers: '', request_body: '', interval: 300, check_ssl: true, check_domain: true, alert_silence_uptime: 24, alert_error_rate: 0, alert_latency_ms: 0 });
const submitting = ref(false);

// ── 配置面板 ──
const configTarget = ref(null);
const configForm = ref({});
const configSaving = ref(false);

// ── 日志面板 ──
const logs = ref([]);
const logsLoading = ref(false);
const currentMonitor = ref(null);
const logOffset = ref(0);
const logLimit = 50;
const hasMoreLogs = ref(false);

// ── 确认对话框(全局单例,渲染在 App.vue) ──
const { confirmState, confirmDialog, resolveConfirm } = useConfirm();

// 带鉴权请求统一走 utils/api 的 authFetchT,本页不再自带一份

// ── 统计概览 ──
const stats = computed(() => ({
    total: monitors.value.length,
    online: monitors.value.filter(m => m.status === 'UP').length,
    offline: monitors.value.filter(m => m.status === 'DOWN' || m.status === 'RETRYING').length,
    paused: monitors.value.filter(m => m.paused === 1).length,
}));

// ── Tag 和筛选 ──
const allTags = computed(() => {
    const tags = new Set();
    monitors.value.forEach(m => { if (m.tags) m.tags.split(',').forEach(t => { const s = t.trim(); if (s) tags.add(s); }); });
    return [...tags].sort();
});
const filteredMonitors = computed(() => {
    let list = monitors.value;
    if (activeTag.value) list = list.filter(m => m.tags && m.tags.split(',').map(t => t.trim()).includes(activeTag.value));
    const q = searchQuery.value.trim().toLowerCase();
    if (q) list = list.filter(m => (m.name && m.name.toLowerCase().includes(q)) || (m.url && m.url.toLowerCase().includes(q)));
    if (sortKey.value) {
        list = [...list].sort((a, b) => {
            switch (sortKey.value) {
                case 'name': return (a.name || '').localeCompare(b.name || '', 'zh-CN');
                case 'status': { const order = { 'DOWN': 0, 'RETRYING': 1, 'UP': 2, 'PAUSED': 3 }; return (order[a.status] ?? 9) - (order[b.status] ?? 9); }
                case 'latency': return (a._latency ?? 9999) - (b._latency ?? 9999);
                case 'ssl': { const dA = a.cert_expiry ? new Date(a.cert_expiry).getTime() : Infinity; const dB = b.cert_expiry ? new Date(b.cert_expiry).getTime() : Infinity; return dA - dB; }
                default: return 0;
            }
        });
    }
    return list;
});

// ── 数据获取 ──
/**
 * 拉取(尊重 ttl)
 *
 * 用于挂载/切页回来:资源在 ttl 内直接命中缓存,不会每次切页都重新打接口。
 * 需要"立刻看到最新数据"的场景请用 reloadMonitors / reloadAll。
 */
const loadAll = () => {
    if (!isAuthenticated.value) return;
    resources.adminMonitors.ensure();
    resources.publicMonitors.ensure();
    resources.health.ensure();
    resources.siteSettings.ensure();
};

/**
 * 定时轮询:常规资源 60s,最重的"公开详情"隔轮才拉(≈120s)。
 * 后台标签页整体停摆,回到前台立刻补一次 —— 这样开着管理页放一整天也不会
 * 无限空转地打接口。
 */
let _tick = 0;
const refreshTick = () => {
    if (document.hidden) return;
    _tick += 1;
    resources.adminMonitors.ensure();
    resources.health.ensure();
    resources.siteSettings.ensure();
    if (_tick % 2 === 0) resources.publicMonitors.ensure();
};
const onVisibility = () => { if (!document.hidden) loadAll(); };

/** 强制刷新列表(增删改、手动检测、批量操作之后用) */
const reloadMonitors = () => {
    if (!isAuthenticated.value) return;
    resources.adminMonitors.refresh();
    resources.publicMonitors.refresh();
};

/** 强制刷新全部 */
const reloadAll = () => {
    if (!isAuthenticated.value) return;
    reloadMonitors();
    resources.health.refresh();
};

const fetchHealth = () => { if (isAuthenticated.value) resources.health.refresh(); };

/** 站点品牌信息(logo/标题),与状态页共用同一份资源 */
const applyBranding = () => {
    const s = siteSettings.value;
    if (s.site_title) document.title = s.site_title;
    const meta = document.querySelector('meta[name=description]');
    if (meta && s.site_description) meta.content = s.site_description;
};

// 资源里已有数据时立刻套用一次,之后每次更新再套用
watch(siteSettings, applyBranding, { immediate: true });

/** 设置弹窗保存成功后:站点配置要立刻刷新,否则状态页还挂着旧标题/logo */
const onSettingsSaved = () => {
    resources.siteSettings.refresh();
    applyBranding();
};

const onLogin = () => { reloadAll(); resources.siteSettings.ensure(); };

// 导入完成后:先立刻刷新,再等首次探测跑完补一次,让新导入的监控尽快显示延迟
const onImportDone = () => { reloadMonitors(); setTimeout(reloadMonitors, 3000); };

// ── 添加监控 ──
const addMonitor = async () => {
    if (!newMonitor.value.name || !newMonitor.value.url) { addToast(t('adminPage.fillNameUrl'), 'error'); return; }
    submitting.value = true;
    try {
        const { type: _type, record_type, expected, port, ...rest } = newMonitor.value;
        const type = _type || 'http';
        let config = '{}';
        if (type === 'dns') config = JSON.stringify({ record_type: record_type || 'A', expected: expected || '' });
        else if (type === 'port') {
            const portNum = Number(port);
            if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) { addToast(t('adminPage.invalidPort'), 'error'); return; }
            config = JSON.stringify({ port: portNum });
        }
        const body = { ...rest, type, config, check_ssl: newMonitor.value.check_ssl ? 1 : 0, check_domain: newMonitor.value.check_domain ? 1 : 0, interval: Number(newMonitor.value.interval) };
        const res = await authFetchT(`${API_BASE}/monitors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) {
            const created = await res.json();
            newMonitor.value = { name: '', url: '', type: 'http', record_type: 'A', expected: '', port: 443, method: 'GET', keyword: '', user_agent: '', tags: '', request_headers: '', request_body: '', interval: 300, check_ssl: true, check_domain: true, alert_silence_uptime: 24, alert_error_rate: 0, alert_latency_ms: 0 };
            showAddModal.value = false;
            addToast(t('adminPage.monitorAdded'), 'success');
            await reloadMonitors();
            // 服务端在创建后异步执行首次探测,稍后再拉一次以尽快显示第一个延迟
            if (created?.id) setTimeout(reloadMonitors, 2500);
        }
        else { const d = await res.json(); addToast(d.error || t('common.addFailed'), 'error'); }
    } catch { addToast(t('common.networkError'), 'error'); }
    finally { submitting.value = false; }
};

// ── 删除 ──
const deleteMonitor = async (m) => {
    const ok = await confirmDialog(t('adminPage.confirmDelete', { name: m.name })); if (!ok) return;
    try { const res = await authFetchT(`${API_BASE}/monitors/${m.id}`, { method: 'DELETE' }); if (res.ok) { addToast(t('adminPage.deleted', { name: m.name }), 'success'); reloadMonitors(); } else { addToast(t('common.deleteFailed'), 'error'); } } catch { addToast(t('common.networkError'), 'error'); }
};

// ── 手动检测 ──
const forceCheck = async (m) => {
    // 用 id 集合判重,不再往监控对象上挂 _checking:列表是 computed 出来的,对象会被重建
    if (checkingIds.has(m.id)) return;
    checkingIds.add(m.id);
    try { const res = await authFetchT(`${API_BASE}/monitors/${m.id}?action=check`, { method: 'POST' }); if (res.ok) { addToast(t('adminPage.updated', { name: m.name }), 'success'); reloadMonitors(); } } catch { addToast(t('common.networkError'), 'error'); }
    finally { checkingIds.delete(m.id); }
};

// ── 暂停/恢复 ──
const togglePause = async (m) => {
    try { const res = await authFetchT(`${API_BASE}/monitors/${m.id}?action=pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: m.paused ? 0 : 1 }) }); if (res.ok) { const d = await res.json(); addToast(d.paused ? t('adminPage.paused', { name: m.name }) : t('adminPage.resumed', { name: m.name }), 'info'); reloadMonitors(); } else { addToast(t('common.actionFailed'), 'error'); } } catch { addToast(t('common.networkError'), 'error'); }
};

// ── 克隆 ──
const cloneMonitor = (m) => {
    let cfg = {}; try { cfg = JSON.parse(m.config || '{}'); } catch {}
    newMonitor.value = { name: m.name + ' (Copy)', url: m.url, type: m.type || 'http', record_type: cfg.record_type || 'A', expected: cfg.expected || '', port: cfg.port ?? '', method: m.method || 'GET', keyword: m.keyword || '', user_agent: m.user_agent || '', tags: m.tags || '', request_headers: m.request_headers || '', request_body: m.request_body || '', interval: m.interval || 300, check_ssl: m.check_ssl !== 0, check_domain: m.check_domain !== 0, alert_silence_uptime: m.alert_silence_uptime || 24, alert_error_rate: m.alert_error_rate || 0 };
    showAddModal.value = true;
};

// ── 配置 ──
/** 站点设置里的全局告警判定口径:监控配置弹窗用它显示「留空跟随全局」的默认值 */
const globalAlertRules = computed(() => {
    const s = siteSettings.value || {};
    return {
        errorRateWindowMin: Number(s.alert_error_rate_window) || 5,
        errorRateMinSamples: Number(s.alert_error_rate_min_samples) || 5,
        errorRateSilenceMin: Number(s.alert_error_rate_silence) || 60,
        latencySilenceMin: Number(s.alert_latency_silence) || 60,
    };
});

/** 判定口径覆盖值:留空/非法 → null(后端据此清空覆盖,回落到全局规则) */
const toRuleOverride = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

const openConfig = (m) => {
    configTarget.value = m;
    configForm.value = { name: m.name || '', url: m.url || '', method: m.method || 'GET', keyword: m.keyword || '', user_agent: m.user_agent || '', tags: m.tags || '', request_headers: m.request_headers || '', request_body: m.request_body || '', interval: m.interval || 300, check_ssl: m.check_ssl !== 0, check_domain: m.check_domain !== 0, alert_silence_uptime: m.alert_silence_uptime ?? 24, alert_silence_ssl: m.alert_silence_ssl ?? 24, alert_silence_domain: m.alert_silence_domain ?? 24, alert_error_rate: m.alert_error_rate ?? 0, alert_latency_ms: m.alert_latency_ms ?? 0, alert_error_rate_window: m.alert_error_rate_window ?? null, alert_error_rate_min_samples: m.alert_error_rate_min_samples ?? null, alert_error_rate_silence: m.alert_error_rate_silence ?? null, alert_latency_silence: m.alert_latency_silence ?? null };
    showConfig.value = true;
};

const saveConfig = async () => {
    if (!configTarget.value) return;
    if (!String(configForm.value.name || '').trim() || !String(configForm.value.url || '').trim()) { addToast(t('adminPage.fillNameUrl'), 'error'); return; }
    configSaving.value = true;
    try {
        const body = { name: configForm.value.name, url: configForm.value.url, method: configForm.value.method || 'GET', keyword: configForm.value.keyword, user_agent: configForm.value.user_agent, tags: configForm.value.tags || '', request_headers: configForm.value.request_headers || '', request_body: configForm.value.request_body || '', interval: Number(configForm.value.interval), check_ssl: configForm.value.check_ssl ? 1 : 0, check_domain: configForm.value.check_domain ? 1 : 0, alert_silence_uptime: Number(configForm.value.alert_silence_uptime), alert_silence_ssl: Number(configForm.value.alert_silence_ssl), alert_silence_domain: Number(configForm.value.alert_silence_domain), alert_error_rate: Number(configForm.value.alert_error_rate ?? 0), alert_latency_ms: Math.min(Math.max(Math.round(Number(configForm.value.alert_latency_ms) || 0), 0), 600000), alert_error_rate_window: toRuleOverride(configForm.value.alert_error_rate_window), alert_error_rate_min_samples: toRuleOverride(configForm.value.alert_error_rate_min_samples), alert_error_rate_silence: toRuleOverride(configForm.value.alert_error_rate_silence), alert_latency_silence: toRuleOverride(configForm.value.alert_latency_silence) };
        const res = await authFetchT(`${API_BASE}/monitors/${configTarget.value.id}/config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) { addToast(t('adminPage.saved'), 'success'); showConfig.value = false; reloadMonitors(); }
        else { const d = await res.json(); addToast(d.error || t('common.saveFailed'), 'error'); }
    } catch { addToast(t('common.networkError'), 'error'); }
    finally { configSaving.value = false; }
};

// ── 日志 ──
// 按监控 id 缓存日志:30 秒内重开同一个监控的日志面板直接渲染,不再重新拉。
// 缓存放在组件里就够 —— AdminPage 被 keep-alive 保住了,切页不会丢。
const logsCache = new Map();
const LOGS_TTL = 30000;

const viewLogs = async (monitor) => {
    currentMonitor.value = monitor;
    showLogs.value = true;

    const cached = logsCache.get(monitor.id);
    if (cached && Date.now() - cached.at < LOGS_TTL) {
        logs.value = cached.logs;
        logOffset.value = cached.offset;
        hasMoreLogs.value = cached.hasMore;
        logsLoading.value = false;
        return;
    }

    logs.value = []; logOffset.value = 0; hasMoreLogs.value = false; logsLoading.value = true;
    try {
        const res = await authFetchT(`${API_BASE}/monitors?id=${monitor.id}&include=logs&limit=${logLimit}&offset=0`);
        if (res.ok) {
            const d = await res.json();
            // 晚到的响应不能覆盖:用户可能已经点开另一个监控了
            if (currentMonitor.value?.id !== monitor.id) return;
            const rows = d.logs?.[monitor.id] || [];
            logs.value = rows;
            hasMoreLogs.value = rows.length >= logLimit;
            logOffset.value = rows.length;
            logsCache.set(monitor.id, { logs: rows, offset: logOffset.value, hasMore: hasMoreLogs.value, at: Date.now() });
        }
    } catch {} finally { logsLoading.value = false; }
};
const loadMoreLogs = async () => {
    if (!currentMonitor.value || logsLoading.value) return; logsLoading.value = true;
    try {
        const res = await authFetchT(`${API_BASE}/monitors?id=${currentMonitor.value.id}&include=logs&limit=${logLimit}&offset=${logOffset.value}`);
        if (res.ok) {
            const d = await res.json();
            const rows = d.logs?.[currentMonitor.value.id] || [];
            logs.value = [...logs.value, ...rows];
            hasMoreLogs.value = rows.length >= logLimit;
            logOffset.value += rows.length;
            // 连"加载更多"的结果一起缓存,否则重开面板会丢掉已经翻过的页
            logsCache.set(currentMonitor.value.id, { logs: logs.value, offset: logOffset.value, hasMore: hasMoreLogs.value, at: Date.now() });
        }
    } catch {} finally { logsLoading.value = false; }
};

// ── Sparkline / Uptime 计算 ──
const sparklineComputed = computed(() => {
    if (!logs.value || logs.value.length < 2) return null;
    const ordered = [...logs.value].reverse();
    const W = 560, H = 56, P = 6;
    const latencies = ordered.map(l => l.latency || 0);
    const maxL = Math.max(...latencies, 1);
    const points = ordered.map((log, i) => ({ x: P + (i / Math.max(ordered.length - 1, 1)) * (W - P * 2), y: H - P - ((log.latency || 0) / maxL) * (H - P * 2), fail: !!log.is_fail, t: log.created_at, l: log.latency || 0 }));
    let path = '', penDown = false;
    points.forEach(p => { if (!p.fail) { path += penDown ? ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`; penDown = true; } else { penDown = false; } });
    // 面积路径:与折线同源,但按"连续成功段"分别闭合到底边。失败点把折线断开,
    // 面积若整条连通就会横跨断口,看着像这段时间一直在监测,所以同样分段。
    let area = '', seg = [];
    const flushArea = () => {
        if (seg.length >= 2) {
            area += `M ${seg[0].x.toFixed(1)} ${H} L ${seg.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')} L ${seg[seg.length - 1].x.toFixed(1)} ${H} Z `;
        }
        seg = [];
    };
    points.forEach(p => { if (p.fail) flushArea(); else seg.push(p); });
    flushArea();
    return { points, path, area, maxL, W, H };
});

const uptimeStats = computed(() => {
    if (!logs.value || logs.value.length === 0) return null;
    const calc = (hours) => { const cutoff = Date.now() - hours * 3600000; const filtered = logs.value.filter(l => { const t = new Date(l.created_at).getTime(); return !isNaN(t) && t >= cutoff; }); if (filtered.length === 0) return null; return ((filtered.filter(l => !l.is_fail).length / filtered.length) * 100).toFixed(1); };
    return { h24: calc(24), d7: calc(24*7), d30: calc(24*30) };
});

const latencyPercentiles = computed(() => {
    if (!logs.value || logs.value.length < 5) return null;
    const lats = logs.value.filter(l => !l.is_fail && l.latency > 0).map(l => l.latency).sort((a, b) => a - b);
    if (lats.length < 5) return null;
    const pct = (arr, p) => arr[Math.max(0, Math.min(Math.ceil(arr.length * p / 100) - 1, arr.length - 1))];
    return { p95: pct(lats, 95), p99: pct(lats, 99) };
});

// ── 批量操作 ──
const batchAction = async (action) => {
    if (selectedIds.value.length === 0) return;
    if (action === 'delete') { const ok = await confirmDialog(t('adminPage.batchConfirm', { count: selectedIds.value.length })); if (!ok) return; }
    if (action === 'check') batchChecking.value = true;
    try {
        const res = await authFetchT(`${API_BASE}/monitors/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids: selectedIds.value }) });
        if (res.ok) {
            const d = await res.json();
            if (action === 'check') {
                addToast(t('adminPage.batchRefreshed', { count: d.affected ?? selectedIds.value.length }), 'success');
            } else {
                addToast(t('adminPage.batchSuccess', { count: d.affected ?? selectedIds.value.length }), 'success');
                selectedIds.value = [];
            }
            reloadMonitors();
        } else { addToast(t('adminPage.batchFailed'), 'error'); }
    } catch { addToast(t('common.networkError'), 'error'); }
    finally { if (action === 'check') batchChecking.value = false; }
};

// ── 排序 ──
const handleReorder = async (ids) => {
    try { await authFetchT(`${API_BASE}/monitors/reorder`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }); addToast(t('adminPage.orderSaved'), 'success'); reloadMonitors(); } catch { addToast(t('adminPage.orderSaveFailed'), 'error'); }
};

// ── 键盘快捷键与轮询的启停 ──
// keep-alive 下 onUnmounted 不会触发,所以这两样都必须挂到 onDeactivated 上:
// 否则停在状态页时后台仍在每 30 秒轮询,按 r / n / / 还会操作到不可见的管理页。
// (原先这个 setInterval 连句柄都没存、keydown 也没解绑,是这轮改造最容易出问题的地方。)
const onKeydown = (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'Escape') { showAddModal.value = false; showLogs.value = false; showConfig.value = false; showChannels.value = false; showAlertTemplates.value = false; showIncidents.value = false; showSettings.value = false; if (confirmState.value.show) resolveConfirm(false); }
    if ((e.key === 'n' || e.key === 'N') && !showAddModal.value && !showLogs.value && !showConfig.value) { e.preventDefault(); showAddModal.value = true; }
    if ((e.key === 'r' || e.key === 'R') && !showAddModal.value && !showLogs.value && !showConfig.value) { e.preventDefault(); reloadMonitors(); }
    if (e.key === '/' && !showAddModal.value && !showLogs.value && !showConfig.value) { e.preventDefault(); document.querySelector('.search-input')?.focus(); }
};

let _timer = null;
// start 做成幂等:首次进入时 onMounted 与 onActivated 会连续触发,不能重复注册
const startActive = () => {
    if (_timer) return;
    _timer = setInterval(refreshTick, 60000);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibility);
};
const stopActive = () => {
    if (_timer) { clearInterval(_timer); _timer = null; }
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('visibilitychange', onVisibility);
};

onMounted(() => {
    // OAuth 回调:URL hash 中携带 token(#/admin?token=xxx)时直接保存
    const hashToken = new URLSearchParams(window.location.hash.split('?')[1] || '').get('token');
    if (hashToken && !storedToken.value) {
        sessionStorage.setItem(ADMIN_TOKEN_KEY, hashToken);
        storedToken.value = hashToken;
        // 清理 URL 中的 token,避免泄露
        history.replaceState(null, '', window.location.pathname);
    }
    loadAll();
    startActive();
});
onActivated(() => {
    startActive();
    applyBranding();
    loadAll();
});
onDeactivated(stopActive);
onUnmounted(stopActive);
</script>
