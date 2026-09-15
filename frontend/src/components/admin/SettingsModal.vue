<template>
  <transition enter-active-class="transition duration-200" enter-from-class="opacity-0" enter-to-class="opacity-100">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm admin-modal-overlay" @click="emit('close')"></div>

      <section class="relative w-full max-w-5xl max-h-[88vh] overflow-hidden flex flex-col glass admin-modal rounded-2xl" style="animation:modal-in 0.25s ease-out">
        <header class="px-6 pt-5 pb-4 flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
              <i class="fas fa-cog text-indigo-500 dark:text-indigo-400"></i>
            </div>
            <div>
              <h3 class="text-base font-bold text-white">{{ $t('settings.title') }}</h3>
            </div>
          </div>
          <button @click="emit('close')" class="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer" :aria-label="$t('common.close')">
            <i class="fas fa-times"></i>
          </button>
        </header>

        <form @submit.prevent="save" class="flex-1 min-h-0 flex flex-col">
          <div class="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,1fr)_320px]">
            <div class="min-h-0 overflow-y-auto p-5 sm:p-6 space-y-6 border-b lg:border-b-0 lg:border-r border-white/5">
              <section class="space-y-4">
                <h4 class="text-sm font-semibold text-white">{{ $t('settings.statusPageInfo') }}</h4>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">{{ $t('settings.siteTitle') }}</span>
                  <input v-model.trim="settings.site_title" placeholder="Uptime Monitor" class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none">
                </label>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">{{ $t('settings.siteDescription') }}</span>
                  <textarea v-model.trim="settings.site_description" rows="3" :placeholder="$t('settings.siteDescriptionPlaceholder')" class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none resize-none"></textarea>
                </label>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">{{ $t('settings.logoUrl') }} <span class="text-xs font-normal text-slate-500">{{ $t('common.optional') }}</span></span>
                  <input v-model.trim="settings.site_logo_url" placeholder="https://example.com/logo.svg" class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none">
                  <span class="text-xs text-slate-500">{{ $t('settings.logoUrlHint') }}</span>
                </label>
              </section>

              <section class="space-y-4">
                <div class="pt-2 border-t border-white/5">
                  <h4 class="text-sm font-semibold text-white mt-4">{{ $t('settings.accessControl') }}</h4>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <button type="button" @click="settings.status_page_visibility = 'public'"
                    class="rounded-xl border px-4 py-3 text-left transition cursor-pointer"
                    :class="settings.status_page_visibility !== 'private' ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-slate-700 hover:border-slate-600'">
                    <span class="flex items-center gap-2 text-sm font-semibold text-white">
                      <i class="fas fa-globe text-emerald-400"></i>
                      {{ $t('settings.visibilityPublic') }}
                    </span>
                    <span class="block text-xs text-slate-500 mt-1">{{ $t('settings.visibilityPublicHint') }}</span>
                  </button>
                  <button type="button" @click="settings.status_page_visibility = 'private'"
                    class="rounded-xl border px-4 py-3 text-left transition cursor-pointer"
                    :class="settings.status_page_visibility === 'private' ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-slate-700 hover:border-slate-600'">
                    <span class="flex items-center gap-2 text-sm font-semibold text-white">
                      <i class="fas fa-lock text-emerald-400"></i>
                      {{ $t('settings.visibilityPrivate') }}
                    </span>
                    <span class="block text-xs text-slate-500 mt-1">{{ $t('settings.visibilityPrivateHint') }}</span>
                  </button>
                </div>

                <!-- 密码只在私密模式下有意义:公开时后端完全不看它,显示出来只会误导 -->
                <label v-if="settings.status_page_visibility === 'private'" class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">
                    {{ $t('settings.statusPassword') }}
                    <span class="text-xs font-normal text-slate-500">{{ hasStatusPassword ? $t('settings.statusPasswordOptional') : $t('settings.statusPasswordNeeded') }}</span>
                  </span>
                  <input v-model.trim="statusPassword" type="password" autocomplete="new-password" :placeholder="$t('settings.statusPasswordPlaceholder')"
                    class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none">
                  <span class="text-xs text-slate-500">{{ $t('settings.statusPasswordHint') }}</span>
                </label>
              </section>

              <section class="space-y-4">
                <div class="pt-2 border-t border-white/5">
                  <h4 class="text-sm font-semibold text-white mt-4">{{ $t('settings.general') }}</h4>
                </div>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">{{ $t('settings.language') }}</span>
                  <AppSelect v-model="settings.language" variant="field-md" :options="languageSelectOptions" />
                </label>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">{{ $t('settings.timezone') }}</span>
                  <AppSelect v-model="settings.timezone" variant="field-md" :options="timezoneSelectOptions" />
                </label>
              </section>

              <section class="space-y-4">
                <div class="pt-2 border-t border-white/5">
                  <h4 class="text-sm font-semibold text-white mt-4">{{ $t('settings.alertRules') }}</h4>
                  <p class="text-xs text-slate-500 mt-1">{{ $t('settings.alertRulesHint') }}</p>
                  <!-- 文案本身搬去了独立入口(按模板管理),这里只留判定口径 -->
                  <p class="text-xs text-slate-600 mt-1">{{ $t('settings.templatesMoved') }}</p>
                </div>

                <div class="grid sm:grid-cols-3 gap-3">
                  <label class="grid gap-2">
                    <span class="text-sm font-medium text-slate-300">{{ $t('settings.errorRateWindow') }}</span>
                    <input type="number" min="1" max="1440" v-model.number="settings.alert_error_rate_window"
                      class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none">
                  </label>
                  <label class="grid gap-2">
                    <span class="text-sm font-medium text-slate-300">{{ $t('settings.errorRateMinSamples') }}</span>
                    <input type="number" min="1" max="1000" v-model.number="settings.alert_error_rate_min_samples"
                      class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none">
                  </label>
                  <label class="grid gap-2">
                    <span class="text-sm font-medium text-slate-300">{{ $t('settings.errorRateSilence') }}</span>
                    <input type="number" min="1" max="10080" v-model.number="settings.alert_error_rate_silence"
                      class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none">
                  </label>
                </div>

                <label class="grid gap-2">
                  <span class="text-sm font-medium text-slate-300">{{ $t('settings.latencySilence') }}</span>
                  <input type="number" min="1" max="10080" v-model.number="settings.alert_latency_silence"
                    class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none">
                </label>
              </section>
            </div>

            <aside class="min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4 bg-slate-50/80 dark:bg-slate-950/20">
              <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 p-4">
                <h4 class="text-sm font-semibold text-white">{{ $t('settings.scope') }}</h4>
                <ul class="mt-3 space-y-2 text-xs text-slate-400">
                  <li class="flex gap-2">
                    <i class="fas fa-desktop text-emerald-400 mt-0.5"></i>
                    <span>{{ $t('settings.scopeStatusPage') }}</span>
                  </li>
                  <li class="flex gap-2">
                    <i class="fas fa-file-import text-emerald-400 mt-0.5"></i>
                    <span>{{ $t('settings.scopeImport') }}</span>
                  </li>
                  <li class="flex gap-2">
                    <i class="fas fa-file-export text-emerald-400 mt-0.5"></i>
                    <span>{{ $t('settings.scopeExport') }}</span>
                  </li>
                </ul>
              </section>

              <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 p-4 space-y-3">
                <div>
                  <h4 class="text-sm font-semibold text-white">{{ $t('settings.exportTitle') }}</h4>
                  <p class="text-xs text-slate-500 mt-1">{{ $t('settings.exportHint') }}</p>
                </div>

                <button type="button" @click="exportMonitors" :disabled="!monitors.length"
                  class="w-full flex items-center gap-3 rounded-xl border border-slate-700 px-4 py-3 text-left hover:border-emerald-500/50 hover:bg-emerald-500/5 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                  <span class="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                    <i class="fas fa-download"></i>
                  </span>
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold text-white">{{ $t('settings.exportAction') }}</span>
                    <span class="block text-xs text-slate-500 truncate">{{ $t('settings.exportCount', { count: monitors.length }) }}</span>
                  </span>
                </button>
              </section>

              <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 p-4 space-y-3">
                <div>
                  <h4 class="text-sm font-semibold text-white">{{ $t('settings.importTitle') }}</h4>
                  <p class="text-xs text-slate-500 mt-1">{{ $t('settings.importHint') }}</p>
                </div>

                <label class="flex items-center gap-3 rounded-xl border border-dashed border-slate-700 px-4 py-4 cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition">
                  <span class="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                    <i class="fas" :class="importing ? 'fa-spinner fa-spin' : 'fa-upload'"></i>
                  </span>
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold text-white">{{ importing ? $t('settings.importing') : $t('settings.chooseFile') }}</span>
                    <span class="block text-xs text-slate-500 truncate">{{ $t('settings.importBefore') }}</span>
                  </span>
                  <input type="file" accept=".json" @change="importMonitors" class="hidden" :disabled="importing">
                </label>
              </section>
            </aside>
          </div>

          <footer class="px-6 py-4 border-t border-white/5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/80 dark:bg-slate-950/20">
            <p class="text-xs text-slate-500">{{ $t('settings.saveHint') }}</p>
            <div class="flex items-center justify-end gap-3">
              <button type="button" @click="emit('close')" class="inline-flex items-center justify-center px-3 py-2 rounded-xl border border-slate-700 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer">
                {{ $t('common.cancel') }}
              </button>
              <button type="submit" :disabled="saving" class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-transparent bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed">
                <i class="fas mr-1.5" :class="saving ? 'fa-spinner fa-spin' : 'fa-save'"></i>
                {{ saving ? $t('common.saving') : $t('settings.save') }}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '../../composables/useToast';
import { API_BASE, authFetchT } from '../../utils/api';
import { setAppLanguage, setAppTimezone } from '../../main';
// 与状态页、详情页共用同一份站点配置,不再各拉一遍
import * as resources from '../../composables/resources';
import AppSelect from '../common/AppSelect.vue';

const { t } = useI18n();
const emit = defineEmits(['close', 'saved', 'import-done']);
const props = defineProps({
    monitors: { type: Array, default: () => [] },
});
const { addToast } = useToast();

const sha256Hex = async (value) => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
};
const saving = ref(false);
const importing = ref(false);
const languageOptions = ['en', 'zh'];
const languageSelectOptions = computed(() => languageOptions.map(l => ({ value: l, label: t('languages.' + l) })));
const timezoneSelectOptions = computed(() => timezoneOptions.map(tz => ({ value: tz.value, label: t('timezones.' + tz.key) })));
const timezoneOptions = [
    { value: 'UTC', key: 'utc' },
    { value: 'Asia/Shanghai', key: 'asiaShanghai' },
    { value: 'Asia/Tokyo', key: 'asiaTokyo' },
    { value: 'Asia/Seoul', key: 'asiaSeoul' },
    { value: 'Europe/Berlin', key: 'europeBerlin' },
    { value: 'Europe/Paris', key: 'europeParis' },
    { value: 'Europe/Rome', key: 'europeRome' },
    { value: 'Europe/Madrid', key: 'europeMadrid' },
    { value: 'America/New_York', key: 'americaNewYork' },
    { value: 'America/Los_Angeles', key: 'americaLosAngeles' },
    { value: 'Asia/Singapore', key: 'asiaSingapore' },
    { value: 'Asia/Kolkata', key: 'asiaKolkata' },
    { value: 'Australia/Sydney', key: 'australiaSydney' },
    { value: 'Europe/London', key: 'europeLondon' },
];
const settings = ref({
    site_title: 'Uptime Monitor',
    site_description: '',
    site_logo_url: '',
    // 告警文案不在这里:它们在「告警模板」入口统一管理,并可按渠道绑定不同模板
    alert_error_rate_window: 5,
    alert_error_rate_min_samples: 5,
    alert_error_rate_silence: 60,
    alert_latency_silence: 60,
    language: 'zh',
    timezone: 'Asia/Shanghai',
    status_page_visibility: 'public',
});

/** 数字型设置:后端存的是字符串,读回来要转成数字,否则 number input 会显示异常 */
const NUMERIC_SETTING_KEYS = [
    'alert_error_rate_window', 'alert_error_rate_min_samples',
    'alert_error_rate_silence', 'alert_latency_silence',
];
const DEFAULTS_NUMERIC = { alert_error_rate_window: 5, alert_error_rate_min_samples: 5, alert_error_rate_silence: 60, alert_latency_silence: 60 };
const toNumber = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};
const statusPassword = ref('');
/** 是否已设置过访问密码(GET /settings 会返回哈希),用于区分"必填"与"留空则保持原密码" */
const hasStatusPassword = ref(false);

/** 用资源里的配置填充表单。资源已经加载过时这是同步的,拿不到数据则原样返回 */
const applyResourceSettings = () => {
    const d = resources.siteSettings.data.value;
    if (!d) return;
    settings.value = {
        site_title: d.site_title || 'Uptime Monitor',
        site_description: d.site_description || '',
        site_logo_url: d.site_logo_url || '',
        ...Object.fromEntries(NUMERIC_SETTING_KEYS.map(k => [k, toNumber(d[k], DEFAULTS_NUMERIC[k])])),
        language: d.language || 'zh',
        timezone: d.timezone || 'Asia/Shanghai',
        status_page_visibility: d.status_page_visibility === 'private' ? 'private' : 'public',
    };
    statusPassword.value = '';
    hasStatusPassword.value = !!d.status_page_password;
};

const fetchSettings = async () => {
    const before = resources.siteSettings.updatedAt.value;
    // 先用缓存把表单填出来,避免每次打开都空着等一次网络往返
    applyResourceSettings();
    await resources.siteSettings.ensure();
    // 只有这次真的发生了重新请求(updatedAt 变了)才覆盖表单 ——
    // 否则用户刚敲进去的内容会被后台刷新回来的数据冲掉
    if (resources.siteSettings.updatedAt.value !== before) applyResourceSettings();
    if (resources.siteSettings.error.value) addToast(t('settings.loadFailed'), 'error');
};

const save = async () => {
    if (saving.value) return;
    // 仅在"切到私密但还没有任何密码"时拦截;已有密码且留空表示保持原密码
    if (settings.value.status_page_visibility === 'private' && !statusPassword.value && !hasStatusPassword.value) {
        addToast(t('settings.statusPasswordRequired'), 'error');
        return;
    }
    saving.value = true;
    try {
        const payload = { ...settings.value };
        if (statusPassword.value) payload.status_page_password = await sha256Hex(statusPassword.value);
        const r = await authFetchT(`${API_BASE}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (r.ok) {
            addToast(t('settings.saved'), 'success');
            setAppLanguage(settings.value.language);
            setAppTimezone(settings.value.timezone);
            emit('saved');
            emit('close');
        } else {
            addToast(t('common.saveFailed'), 'error');
        }
    } catch {
        addToast(t('common.networkError'), 'error');
    } finally {
        saving.value = false;
    }
};

/** 导出当前监控项的完整配置(导入入口读的是同一份结构) */
const exportMonitors = () => {
    const data = props.monitors.map(m => ({
        name: m.name, url: m.url, method: m.method, interval: m.interval, keyword: m.keyword,
        user_agent: m.user_agent, tags: m.tags, request_headers: m.request_headers, request_body: m.request_body,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = URL.createObjectURL(blob);
    a.download = `uptime-monitors-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 200);
    addToast(t('settings.exported', { count: data.length }), 'success');
};

const importMonitors = async (e) => {
    const file = e.target.files[0];
    if (!file || importing.value) return;
    importing.value = true;
    try {
        const text = await file.text();
        const items = JSON.parse(text);
        if (!Array.isArray(items)) {
            addToast(t('settings.invalidFormat'), 'error');
            return;
        }

        let ok = 0;
        for (const item of items) {
            const r = await authFetchT(`${API_BASE}/monitors`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item),
            });
            if (r.ok) ok++;
        }
        addToast(t('settings.importResult', { ok, total: items.length }), 'success');
        emit('import-done');
        emit('close');
    } catch {
        addToast(t('settings.importFailed'), 'error');
    } finally {
        importing.value = false;
        e.target.value = '';
    }
};

fetchSettings();
</script>
