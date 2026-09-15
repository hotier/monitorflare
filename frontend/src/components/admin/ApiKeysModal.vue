<template>
  <transition enter-active-class="transition duration-200" enter-from-class="opacity-0" enter-to-class="opacity-100">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm admin-modal-overlay" @click="emit('close')"></div>

      <section class="relative w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col glass admin-modal rounded-2xl" style="animation:modal-in 0.25s ease-out">
        <header class="px-6 pt-5 pb-4 flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
              <i class="fas fa-key text-emerald-500 dark:text-emerald-400"></i>
            </div>
            <div>
              <h3 class="text-base font-bold text-white">{{ $t('apiKeys.title') }}</h3>
              <p class="text-xs text-slate-500">{{ $t('apiKeys.subtitle') }}</p>
            </div>
          </div>
          <button @click="emit('close')" class="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer" :aria-label="$t('common.close')">
            <i class="fas fa-times"></i>
          </button>
        </header>

        <div class="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-6">
          <!-- 文档引导:建 key 的人下一步就是去调接口,把说明页入口放在最上面。
               整张卡片不可点:误触会离开弹窗,而刚生成的明文密钥只展示一次。
               只有右侧按钮带 target=_blank,跳到新标签页,当前弹窗和密钥都不丢。
               浅色配色沿用本弹窗已验证的组合(bg-slate-800/40 + text-slate-500),
               不用 emerald 文字 —— base.css 没有为 .admin-modal 覆写 emerald,浅底上看不清。 -->
          <div class="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/40 p-3.5">
            <i class="fas fa-book-open text-slate-400 shrink-0"></i>
            <div class="min-w-0 flex-1">
              <p class="text-xs text-slate-500 leading-relaxed">{{ $t('apiKeys.guideDesc') }}</p>
            </div>
            <router-link to="/api-docs" target="_blank" rel="noopener"
              class="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition cursor-pointer dark:bg-emerald-500/20 dark:text-emerald-300 dark:hover:bg-emerald-500/30">
              {{ $t('apiKeys.guideAction') }}
              <i class="fas fa-arrow-up-right-from-square text-[9px]"></i>
            </router-link>
          </div>

          <!-- 创建 key -->
          <section class="space-y-3">
            <h4 class="text-sm font-semibold text-white">{{ $t('apiKeys.createTitle') }}</h4>
            <div class="flex gap-2">
              <input v-model.trim="newKeyName" :placeholder="$t('apiKeys.namePlaceholder')"
                class="flex-1 h-[34px] border border-slate-700 rounded-xl px-3 text-sm bg-slate-800/80 text-white focus:border-emerald-500 outline-none">
              <button @click="createKey" :disabled="creating || !newKeyName"
                class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-transparent bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed">
                <i class="fas" :class="creating ? 'fa-spinner fa-spin' : 'fa-plus'"></i>
                {{ $t('apiKeys.create') }}
              </button>
            </div>

            <!-- 新建 key 明文展示(仅一次)。
                 浅色下必须显式给亮色:base.css 覆写了 green/cyan/blue/purple/orange/rose/red 系,
                 唯独没有 emerald —— 实测 emerald-400 标题 1.8:1、emerald-300 密钥 2.7:1、
                 复制图标 1.4:1,压在浅底上基本看不见(slate-950/50 只有半透明,合成出来是中灰不是近黑)。
                 复制按钮还踩了另一条:类名里出现 bg-*-600 就会被
                 button[class*="bg-"][class*="-600"] 强刷白字,白图标压浅绿底一样看不见,
                 所以浅色改用 bg-emerald-100,并保证整串类名不含 -600 色阶。 -->
            <div v-if="newKey" class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2 dark:border-emerald-500/30 dark:bg-emerald-500/5">
              <p class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{{ $t('apiKeys.keyCreatedOnce') }}</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 font-mono text-sm text-emerald-800 bg-white border border-emerald-200/70 rounded-lg px-3 py-2 break-all dark:bg-slate-950/50 dark:border-slate-800 dark:text-emerald-300">{{ newKey }}</code>
                <button @click="copyNewKey" class="px-3 py-2 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs font-semibold transition cursor-pointer dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 dark:text-emerald-300" :title="$t('apiKeys.copy')">
                  <i class="fas" :class="copied ? 'fa-check' : 'fa-copy'"></i>
                </button>
              </div>
              <p class="text-[11px] text-slate-500">{{ $t('apiKeys.keyCreatedHint') }}</p>
            </div>
          </section>

          <!-- 现有 key 列表 -->
          <section class="space-y-3">
            <h4 class="text-sm font-semibold text-white">{{ $t('apiKeys.listTitle') }}</h4>
            <div v-if="keys.length === 0" class="text-center py-6 text-xs text-slate-500 border border-dashed border-slate-700 rounded-xl">
              {{ $t('apiKeys.noKeys') }}
            </div>
            <div v-else class="space-y-2">
              <div v-for="k in keys" :key="k.id" class="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-semibold text-white truncate">{{ k.name }}</p>
                  <p class="text-[11px] font-mono text-slate-500 mt-0.5">
                    {{ $t('apiKeys.createdAt', { time: formatDate(k.created_at) }) }}
                    <template v-if="k.last_used_at"> · {{ $t('apiKeys.lastUsed', { time: formatDate(k.last_used_at) }) }}</template>
                  </p>
                </div>
                <button @click="deleteKey(k)" :disabled="deletingId === k.id" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 hover:bg-red-500/10 transition cursor-pointer disabled:opacity-60">
                  <i class="fas" :class="deletingId === k.id ? 'fa-spinner fa-spin' : 'fa-trash-alt'"></i>
                  {{ $t('apiKeys.delete') }}
                </button>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { API_BASE, authFetchT } from '../../utils/api';
import { formatDate } from '../../utils/format';
import * as resources from '../../composables/resources';

const { t } = useI18n();
const emit = defineEmits(['close']);
const { addToast } = useToast();
const { confirmDialog } = useConfirm();

// 密钥列表来自模块级资源:弹窗关了再开直接渲染缓存,不再每次重新拉
const keys = computed(() => resources.apiKeys.data.value || []);
const newKeyName = ref('');
const newKey = ref('');
const creating = ref(false);
const deletingId = ref(null);
const copied = ref(false);

/** 手动刷新(增删之后) */
const fetchKeys = () => resources.apiKeys.refresh();
/** 打开弹窗时用:有缓存直接渲染,不重复请求 */
const loadKeys = () => resources.apiKeys.ensure();

const createKey = async () => {
    if (!newKeyName.value || creating.value) return;
    creating.value = true;
    try {
        const r = await authFetchT(`${API_BASE}/api-keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newKeyName.value }),
        });
        if (r.ok) {
            const d = await r.json();
            newKey.value = d.key || '';
            newKeyName.value = '';
            copied.value = false;
            await fetchKeys();
            addToast(t('apiKeys.created'), 'success');
        } else {
            addToast(t('common.actionFailed'), 'error');
        }
    } catch {
        addToast(t('common.networkError'), 'error');
    } finally {
        creating.value = false;
    }
};

const copyNewKey = async () => {
    try {
        await navigator.clipboard.writeText(newKey.value);
        copied.value = true;
        addToast(t('apiKeys.copied'), 'success');
        setTimeout(() => { copied.value = false; }, 2000);
    } catch {
        addToast(t('apiKeys.copyFailed'), 'error');
    }
};

const deleteKey = async (k) => {
    if (deletingId.value) return;
    const ok = await confirmDialog(t('apiKeys.deleteConfirm', { name: k.name }));
    if (!ok) return;
    deletingId.value = k.id;
    try {
        const r = await authFetchT(`${API_BASE}/api-keys/${k.id}`, { method: 'DELETE' });
        if (r.ok) {
            // keys 现在是 computed,不能就地赋值,交给资源重新拉一次
            await fetchKeys();
            addToast(t('apiKeys.deleted'), 'success');
        } else {
            addToast(t('common.actionFailed'), 'error');
        }
    } catch {
        addToast(t('common.networkError'), 'error');
    } finally {
        deletingId.value = null;
    }
};

// ensure 而非 refresh:资源里有缓存就直接渲染,只有首次或超过 ttl 才真的请求
onMounted(loadKeys);
</script>
