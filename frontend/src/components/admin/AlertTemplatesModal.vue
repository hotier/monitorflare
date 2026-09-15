<template>
  <transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm admin-modal-overlay" @click="emit('close')"></div>
      <div class="relative w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col glass admin-modal rounded-2xl shadow-2xl" style="animation:modal-in 0.25s ease-out">
        <div class="px-5 sm:px-6 pt-5 pb-4">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-xl bg-green-500/15 flex items-center justify-center shrink-0">
                <i class="fas fa-file-code text-green-600 dark:text-green-400"></i>
              </div>
              <div class="min-w-0">
                <h3 class="text-base font-bold text-white">{{ $t('alertTemplates.title') }}</h3>
                <p class="text-xs text-slate-500 mt-0.5">{{ $t('alertTemplates.subtitle') }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2 sm:justify-end">
              <button @click="startCreate" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-transparent bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 transition-colors cursor-pointer">
                <i class="fas fa-plus text-xs"></i> {{ $t('alertTemplates.newVersion') }}
              </button>
              <button @click="emit('close')" class="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 transition-colors cursor-pointer" :aria-label="$t('common.close')">
                <i class="fas fa-times text-lg"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden lg:flex lg:flex-col p-5 sm:p-6 lg:p-0">
          <div v-if="loadError" class="shrink-0 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 flex items-center gap-3 mb-5 lg:mx-5 lg:mt-5">
            <i class="fas fa-exclamation-circle text-orange-400 shrink-0"></i>
            <p class="text-sm text-orange-300 flex-1">{{ loadError }}</p>
            <button @click="load" class="text-xs font-semibold text-orange-300 hover:text-orange-200 cursor-pointer">{{ $t('common.retry') }}</button>
          </div>

          <!-- 左右两栏各自独立滚动:宽屏时模板列表与编辑区互不牵连 -->
          <div class="grid gap-5 lg:gap-0 lg:grid-cols-12 lg:flex-1 lg:min-h-0 lg:grid-rows-[minmax(0,1fr)]">
            <!-- 模板列表 -->
            <section class="lg:col-span-4 space-y-3 lg:min-h-0 lg:overflow-y-auto lg:p-5 lg:border-r lg:border-slate-700/60">
              <div v-if="loading" class="space-y-3">
                <div v-for="i in 3" :key="i" class="h-24 rounded-xl bg-slate-800/50 animate-pulse"></div>
              </div>

              <div v-else-if="versions.length === 0" class="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 px-6 py-10 text-center">
                <div class="mx-auto mb-4 w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center">
                  <i class="fas fa-file-code text-slate-500"></i>
                </div>
                <h4 class="text-base font-bold text-white">{{ $t('alertTemplates.emptyTitle') }}</h4>
                <p class="text-sm text-slate-500 mt-1 mb-5">{{ $t('alertTemplates.emptyHint') }}</p>
                <button @click="startCreate" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-transparent bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-500 cursor-pointer">
                  <i class="fas fa-plus text-xs"></i> {{ $t('alertTemplates.createFirst') }}
                </button>
              </div>

              <div v-else class="space-y-3">
                <article v-for="v in versions" :key="v.id"
                  class="rounded-xl border px-4 py-3 transition-all"
                  :class="isSelected(v) ? 'border-green-500/50 bg-green-500/10 shadow-lg shadow-green-500/5' : 'border-slate-700 bg-slate-900/35 hover:border-slate-600 hover:bg-slate-900/55'">
                  <button type="button" class="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 rounded-lg cursor-pointer"
                    @click="selectVersion(v)">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h5 class="text-sm font-bold text-slate-900 dark:text-white truncate">{{ v.name }}</h5>
                      <span v-if="v.is_default" class="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
                        {{ $t('alertTemplates.defaultTag') }}
                      </span>
                      <span v-if="isSelected(v) && dirty" class="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                        {{ $t('alertTemplates.unsavedTag') }}
                      </span>
                    </div>
                    <p v-if="v.note" class="text-xs text-slate-500 mt-1 line-clamp-2">{{ v.note }}</p>
                    <p class="text-[10px] text-slate-600 mt-1">{{ $t('alertTemplates.updatedAt') }} {{ formatTime(v.updated_at) }}</p>
                  </button>

                  <div class="flex items-center gap-1 mt-3">
                    <button @click="duplicate(v)" :disabled="busyId === v.id" class="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:text-green-600 dark:hover:text-green-300 hover:border-green-500/40 disabled:opacity-50 transition-colors cursor-pointer">
                      <i class="fas fa-copy text-[10px]"></i> {{ $t('alertTemplates.duplicate') }}
                    </button>
                    <button v-if="!v.is_default" @click="makeDefault(v)" :disabled="busyId === v.id" class="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-300 hover:border-emerald-500/40 disabled:opacity-50 transition-colors cursor-pointer">
                      <i class="fas fa-star text-[10px]"></i> {{ $t('alertTemplates.makeDefault') }}
                    </button>
                    <!-- 默认模板是告警文案的兜底,不让删;要先设别的模板为默认,再来删这份 -->
                    <button v-if="!v.is_default" @click="remove(v)" :disabled="busyId === v.id" class="ml-auto inline-flex min-h-8 items-center gap-1 rounded-lg border border-red-500/20 px-2 py-1 text-[11px] text-red-600 dark:text-red-400/80 hover:text-red-600 dark:hover:text-red-300 hover:border-red-500/40 disabled:opacity-50 transition-colors cursor-pointer">
                      <i class="fas fa-trash text-[10px]"></i> {{ $t('common.delete') }}
                    </button>
                  </div>
                </article>
              </div>
            </section>

            <!-- 编辑区 -->
            <section class="lg:col-span-8 lg:min-h-0 lg:overflow-y-auto lg:p-5">
              <div v-if="!draft" class="rounded-2xl border border-slate-700 bg-slate-900/30 p-8 text-center">
                <div class="w-11 h-11 rounded-xl bg-green-500/15 flex items-center justify-center mx-auto mb-4">
                  <i class="fas fa-file-code text-green-600 dark:text-green-400"></i>
                </div>
                <h4 class="text-base font-bold text-slate-900 dark:text-white">{{ $t('alertTemplates.selectTitle') }}</h4>
                <p class="text-sm text-slate-500 mt-1">{{ $t('alertTemplates.selectHint') }}</p>
              </div>

              <div v-else class="rounded-2xl border border-slate-700 bg-slate-900/30 overflow-hidden">
                <div class="px-5 py-4 border-b border-slate-700/70 bg-slate-900/35">
                  <h4 class="text-base font-bold text-white">{{ draft.id ? draft.name || $t('alertTemplates.untitled') : $t('alertTemplates.newVersion') }}</h4>
                  <p class="text-xs text-slate-500 mt-0.5">{{ $t('alertTemplates.editorHint') }}</p>
                </div>

                <div class="p-5 space-y-5">
                  <div class="grid sm:grid-cols-2 gap-3">
                    <label class="grid gap-2">
                      <span class="text-sm font-medium text-slate-300">{{ $t('alertTemplates.nameLabel') }}</span>
                      <input v-model.trim="draft.name" :placeholder="$t('alertTemplates.namePlaceholder')"
                        class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-green-500 outline-none">
                    </label>
                    <label class="grid gap-2">
                      <span class="text-sm font-medium text-slate-300">{{ $t('alertTemplates.noteLabel') }} <span class="text-slate-600">{{ $t('common.optional') }}</span></span>
                      <input v-model.trim="draft.note" :placeholder="$t('alertTemplates.notePlaceholder')"
                        class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-green-500 outline-none">
                    </label>
                  </div>

                  <label class="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" v-model="draft.is_default" class="accent-green-500">
                    {{ $t('alertTemplates.setDefault') }}
                  </label>

                  <!-- 每条单独写清"什么时候发"和"能用什么变量":这两件事光看模板名是猜不出来的 -->
                  <label v-for="f in fields" :key="f.key" class="grid gap-2">
                    <span class="text-sm font-medium text-slate-300">{{ f.label }}</span>
                    <textarea v-model.trim="draft.payload[f.key]" rows="2" :placeholder="f.placeholder"
                      class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-green-500 outline-none resize-none"></textarea>
                    <span class="text-xs text-slate-500"><i class="fas fa-bolt text-amber-500/80 mr-1"></i>{{ f.trigger }}</span>
                    <span class="text-xs text-slate-500">{{ $t('alertTemplates.varsLabel') }}
                      <span class="font-mono text-green-600 dark:text-green-400">{{ f.vars }}</span>
                    </span>
                  </label>

                  <div class="pt-4 border-t border-slate-700/60">
                    <h5 class="text-sm font-semibold text-slate-900 dark:text-white mb-3">{{ $t('alertTemplates.titlesTitle') }}</h5>
                    <div class="grid sm:grid-cols-2 gap-3">
                      <label class="grid gap-2">
                        <span class="text-sm font-medium text-slate-300">{{ $t('alertTemplates.titleDown') }}</span>
                        <input v-model.trim="draft.payload.title_down" :placeholder="$t('alertTemplates.titleDownPlaceholder')"
                          class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-green-500 outline-none">
                        <span class="text-xs text-slate-500">{{ $t('alertTemplates.varsLabel') }}
                          <span class="font-mono text-green-600 dark:text-green-400">{{ BRANDING_VARS }}</span>
                        </span>
                      </label>
                      <label class="grid gap-2">
                        <span class="text-sm font-medium text-slate-300">{{ $t('alertTemplates.titleUp') }}</span>
                        <input v-model.trim="draft.payload.title_up" :placeholder="$t('alertTemplates.titleUpPlaceholder')"
                          class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-green-500 outline-none">
                        <span class="text-xs text-slate-500">{{ $t('alertTemplates.varsLabel') }}
                          <span class="font-mono text-green-600 dark:text-green-400">{{ BRANDING_VARS }}</span>
                        </span>
                      </label>
                    </div>
                    <label class="grid gap-2 mt-3">
                      <span class="text-sm font-medium text-slate-300">{{ $t('alertTemplates.footer') }}</span>
                      <input v-model.trim="draft.payload.footer" :placeholder="$t('alertTemplates.footerPlaceholder')"
                        class="w-full border border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-800/80 text-white focus:border-green-500 outline-none">
                      <span class="text-xs text-slate-500">{{ $t('alertTemplates.varsLabel') }}
                        <span class="font-mono text-green-600 dark:text-green-400">{{ BRANDING_VARS }}</span>
                      </span>
                    </label>
                    <p class="text-xs text-slate-500 mt-2">{{ $t('alertTemplates.titlesHint') }}</p>
                  </div>
                </div>

                <div class="px-5 py-4 border-t border-slate-700/70 bg-slate-900/35 flex flex-col sm:flex-row gap-2 sm:justify-end">
                  <button @click="draft = null" class="inline-flex items-center justify-center rounded-xl border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 cursor-pointer">
                    {{ $t('common.cancel') }}
                  </button>
                  <button @click="saveAsNew" :disabled="saving" class="inline-flex items-center justify-center rounded-xl border border-green-500/40 px-3 py-2 text-xs font-bold text-green-700 dark:text-green-400 hover:bg-green-500/10 cursor-pointer disabled:opacity-60">
                    {{ $t('alertTemplates.saveAsNew') }}
                  </button>
                  <button @click="save" :disabled="saving" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-transparent bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-500 disabled:opacity-60 cursor-pointer">
                    <i class="fas text-xs" :class="saving ? 'fa-spinner fa-spin' : 'fa-save'"></i>
                    {{ saving ? $t('common.saving') : $t('common.save') }}
                  </button>
                </div>
              </div>
            </section>
          </div>

        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { API_BASE, authFetchT } from '../../utils/api';
import { formatDateTime } from '../../utils/format';

const { t, locale } = useI18n();
const emit = defineEmits(['close']);
const { addToast } = useToast();
const { confirmDialog } = useConfirm();

/** 标题/落款可用的变量(详情槽位的变量在 fields 里逐条列出) */
const BRANDING_VARS = '{name} {url} {status} {time}';

/** 新建模板时填入的示例文案(与后端 defaultTemplatePayload 对齐:中文站给中文) */
const BUILTIN_PAYLOAD_ZH = {
    down: '故障原因:{reason}',
    up: '服务已恢复,响应时间 {latency}ms',
    error_rate: '最近 {error_rate_window} 分钟错误率 {error_rate}%,已超过阈值 {threshold}%',
    ssl: '{name} 的 SSL 证书将在 {days} 天后过期({expiry})',
    domain: '域名 {name} 将在 {days} 天后过期({expiry})',
    latency: '延迟 {latency}ms,已超过阈值 {threshold}ms',
    title_down: '服务故障报警',
    title_up: '服务恢复通知',
    footer: 'MonitorFlare',
};

const BUILTIN_PAYLOAD_EN = {
    down: 'Error: {reason}',
    up: 'Response time: {latency}ms',
    error_rate: 'Error rate {error_rate}% in last {error_rate_window} minutes (threshold {threshold}%)',
    ssl: 'SSL certificate for {name} expires in {days} days ({expiry})',
    domain: 'Domain {name} expires in {days} days ({expiry})',
    latency: 'Latency {latency}ms exceeded threshold {threshold}ms',
    title_down: '',
    title_up: '',
    footer: '',
};

const BUILTIN_PAYLOAD = locale.value.startsWith('zh') ? BUILTIN_PAYLOAD_ZH : BUILTIN_PAYLOAD_EN;

const fields = computed(() => [
    { key: 'down', label: t('alertTemplates.fieldDown'), trigger: t('alertTemplates.triggerDown'), placeholder: BUILTIN_PAYLOAD.down, vars: '{name} {url} {status} {reason} {status_code} {latency} {time}' },
        { key: 'up', label: t('alertTemplates.fieldUp'), trigger: t('alertTemplates.triggerUp'), placeholder: BUILTIN_PAYLOAD.up, vars: '{name} {url} {status} {reason} {status_code} {latency} {time}' },
        { key: 'error_rate', label: t('alertTemplates.fieldErrorRate'), trigger: t('alertTemplates.triggerErrorRate'), placeholder: BUILTIN_PAYLOAD.error_rate, vars: '{name} {url} {status} {error_rate} {error_rate_window} {threshold} {time}' },
        { key: 'ssl', label: t('alertTemplates.fieldSsl'), trigger: t('alertTemplates.triggerSsl'), placeholder: BUILTIN_PAYLOAD.ssl, vars: '{name} {url} {status} {days} {expiry} {time}' },
        { key: 'domain', label: t('alertTemplates.fieldDomain'), trigger: t('alertTemplates.triggerDomain'), placeholder: BUILTIN_PAYLOAD.domain, vars: '{name} {url} {status} {days} {expiry} {time}' },
    { key: 'latency', label: t('alertTemplates.fieldLatency'), trigger: t('alertTemplates.triggerLatency'), placeholder: BUILTIN_PAYLOAD.latency, vars: '{name} {url} {status} {latency} {threshold} {time}' },
]);

const versions = ref([]);
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const busyId = ref(null);

/** 当前编辑中的模板;id 为 null 表示"新建" */
const draft = ref(null);
const selectedId = ref(null);
/** 表单是否已改动(离开/切换前用来提醒) */
const dirty = ref(false);

const isSelected = (v) => (draft.value ? draft.value.id === v.id : selectedId.value === v.id);

// 后端存的是 UTC 裸串,统一走 formatDateTime 转到应用时区,别再切片当本地时间显示
const formatTime = (v) => formatDateTime(v);

// 「未保存」标记:记一份快照做基线,切换模板或关闭前据此提醒
let baseline = '';
const snapshot = () => JSON.stringify({
    name: draft.value?.name, note: draft.value?.note,
    is_default: draft.value?.is_default, payload: draft.value?.payload,
});
const resetBaseline = () => { baseline = snapshot(); dirty.value = false; };
watch(draft, () => { dirty.value = baseline !== snapshot(); }, { deep: true });

const load = async () => {
    loading.value = true;
    loadError.value = '';
    try {
        const res = await authFetchT(`${API_BASE}/alert-templates`);
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        versions.value = d.versions || [];
        // 首次进入默认打开默认模板,省掉一次点击
        if (!draft.value) {
            const def = versions.value.find(v => v.is_default) || versions.value[0];
            if (def) selectVersion(def, true);
        }
    } catch {
        loadError.value = t('alertTemplates.loadFailed');
    } finally {
        loading.value = false;
    }
};

const clone = (v) => ({
    id: v.id ?? null,
    name: v.name || '',
    note: v.note || '',
    is_default: !!v.is_default,
    payload: { ...BUILTIN_PAYLOAD, ...(v.payload || {}) },
});

/** 切换/关闭前确认,避免辛苦写的文案被静默丢弃 */
const confirmDiscard = async () => {
    if (!dirty.value) return true;
    return confirmDialog(t('alertTemplates.discardConfirm'));
};

const selectVersion = async (v, force = false) => {
    if (!force && !(await confirmDiscard())) return;
    draft.value = clone(v);
    selectedId.value = v.id;
    resetBaseline();
};

const startCreate = async () => {
    if (!(await confirmDiscard())) return;
    draft.value = { id: null, name: '', note: '', is_default: false, payload: { ...BUILTIN_PAYLOAD } };
    selectedId.value = null;
    resetBaseline();
};

const save = async () => {
    if (!draft.value || saving.value) return;
    if (!draft.value.name.trim()) { addToast(t('alertTemplates.nameRequired'), 'error'); return; }
    saving.value = true;
    try {
        const body = { name: draft.value.name, note: draft.value.note, payload: draft.value.payload, is_default: draft.value.is_default };
        const url = draft.value.id ? `${API_BASE}/alert-templates/${draft.value.id}` : `${API_BASE}/alert-templates`;
        const res = await authFetchT(url, {
            method: draft.value.id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) { addToast(t('alertTemplates.saveFailed'), 'error'); return; }
        const d = await res.json();
        addToast(t('alertTemplates.saved'), 'success');
        // 新建后必须切到真实 id,否则再点一次保存会又建一个副本
        const targetId = draft.value.id || d.id;
        await load();
        const target = versions.value.find(v => v.id === targetId);
        if (target) selectVersion(target, true); else resetBaseline();
    } catch {
        addToast(t('common.networkError'), 'error');
    } finally {
        saving.value = false;
    }
};

/** 基于当前内容另存一份:改文案前先留底,也方便给不同渠道做不同措辞 */
const saveAsNew = async () => {
    if (!draft.value || saving.value) return;
    saving.value = true;
    try {
        const res = await authFetchT(`${API_BASE}/alert-templates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: `${draft.value.name || t('alertTemplates.untitled')} (copy)`,
                note: draft.value.note,
                payload: draft.value.payload,
                is_default: false,
            }),
        });
        if (!res.ok) { addToast(t('alertTemplates.saveFailed'), 'error'); return; }
        const d = await res.json();
        addToast(t('alertTemplates.saved'), 'success');
        dirty.value = false;
        await load();
        const created = versions.value.find(v => v.id === d.id);
        if (created) selectVersion(created, true);
    } catch {
        addToast(t('common.networkError'), 'error');
    } finally {
        saving.value = false;
    }
};

const duplicate = async (v) => {
    busyId.value = v.id;
    try {
        const res = await authFetchT(`${API_BASE}/alert-templates/${v.id}?action=duplicate`, { method: 'POST' });
        if (!res.ok) { addToast(t('alertTemplates.operationFailed'), 'error'); return; }
        await load();
    } catch {
        addToast(t('common.networkError'), 'error');
    } finally {
        busyId.value = null;
    }
};

const makeDefault = async (v) => {
    busyId.value = v.id;
    try {
        const res = await authFetchT(`${API_BASE}/alert-templates/${v.id}?action=default`, { method: 'POST' });
        if (!res.ok) { addToast(t('alertTemplates.operationFailed'), 'error'); return; }
        addToast(t('alertTemplates.defaultSet'), 'success');
        await load();
    } catch {
        addToast(t('common.networkError'), 'error');
    } finally {
        busyId.value = null;
    }
};

const remove = async (v) => {
    if (v.is_default) return; // 双保险:UI 已隐藏,后端也会挡
    const ok = await confirmDialog(t('alertTemplates.deleteConfirm', { name: v.name }));
    if (!ok) return;
    busyId.value = v.id;
    try {
        const res = await authFetchT(`${API_BASE}/alert-templates/${v.id}`, { method: 'DELETE' });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
            const key = d.error === 'cannot_delete_default' ? 'deleteDefaultError' : 'deleteLastError';
            addToast(t(`alertTemplates.${key}`), 'error');
            return;
        }
        if (draft.value?.id === v.id) { draft.value = null; resetBaseline(); }
        await load();
    } catch {
        addToast(t('common.networkError'), 'error');
    } finally {
        busyId.value = null;
    }
};

load();
</script>
