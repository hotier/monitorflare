<template>
  <header class="sticky top-0 z-40 border-b border-slate-200 dark:border-white/5"
    :style="isDark ? 'background:rgba(15,23,42,0.85);backdrop-filter:blur(16px)' : 'background:rgba(255,255,255,0.85);backdrop-filter:blur(16px)'">
    <div class="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
      <router-link to="/" class="flex items-center gap-2 sm:gap-3 group min-w-0">
        <div class="relative shrink-0">
          <img v-if="siteSettings.site_logo_url" :src="siteSettings.site_logo_url" alt="Logo" class="w-8 h-8 rounded-lg object-contain transition-opacity group-hover:opacity-80" @error="siteSettings.site_logo_url = '/logo.svg'">
          <img v-else src="/logo.svg" alt="Logo" class="w-8 h-8 rounded-lg object-contain transition-opacity group-hover:opacity-80">
        </div>
        <div class="min-w-0">
          <span class="font-bold text-slate-900 dark:text-white tracking-tight text-[15px] group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors truncate block">{{ siteSettings.site_title || 'MonitorFlare' }}</span>
          <p class="hidden sm:block text-[11px] text-slate-400 dark:text-slate-500 font-mono -mt-0.5 tracking-wider truncate max-w-[200px]">{{ siteSettings.site_description || $t('statusHeader.statusPage') }}</p>
        </div>
      </router-link>
      <div class="flex items-center gap-1.5">
        <!-- 语言切换 -->
        <div class="relative" ref="langRef">
          <button @click="langOpen = !langOpen" class="flex items-center gap-1 h-8 px-2 rounded-lg text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-all cursor-pointer" :title="$t('languages.' + locale)">
            <i class="fas fa-globe text-[11px]"></i>
            <span class="hidden sm:inline">{{ shortLang }}</span>
            <i class="fas fa-chevron-down text-[8px]"></i>
          </button>
          <div v-if="langOpen" class="absolute right-0 mt-1.5 w-24 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl overflow-hidden z-50">
            <button v-for="l in langList" :key="l" @click="changeLang(l)"
              class="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] cursor-pointer"
              :class="{ 'font-bold text-green-600 dark:text-emerald-400': l === locale }">
              {{ $t('languages.' + l) }}
              <i v-if="l === locale" class="fas fa-check text-[9px]"></i>
            </button>
          </div>
        </div>
        <button @click="$emit('toggle-theme')" class="p-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-500/10 transition-colors text-sm cursor-pointer">
          <i :class="isDark ? 'fas fa-sun' : 'fas fa-moon'"></i>
        </button>
        <div class="h-4 w-px bg-slate-200 dark:bg-white/10 mx-0.5"></div>
        <button @click="confirmLogout" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer">
          <i class="fas fa-sign-out-alt"></i>
          <span class="hidden sm:inline">{{ $t('adminHeader.logout') }}</span>
        </button>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { setAppLanguage } from '../../main';
import { useConfirm } from '../../composables/useConfirm';

defineProps({ isDark: Boolean, siteSettings: { type: Object, default: () => ({}) } });
const emit = defineEmits(['toggle-theme', 'logout']);

const { locale, t } = useI18n();
const { confirmDialog } = useConfirm();

// 「退出」一点就走,先确认再通知父组件(弹窗统一渲染在 App.vue)
const confirmLogout = async () => {
    const ok = await confirmDialog(t('common.logoutConfirm'), { confirmText: t('adminHeader.logout') });
    if (ok) emit('logout');
};
const langOpen = ref(false);
const langRef = ref(null);
const langList = ['en', 'zh'];
const shortLang = computed(() => (locale.value === 'zh' ? '中文' : 'EN'));

const changeLang = (l) => {
    setAppLanguage(l);
    locale.value = l;
    langOpen.value = false;
};

const onClickOutside = (e) => {
    if (langOpen.value && langRef.value && !langRef.value.contains(e.target)) langOpen.value = false;
};
onMounted(() => document.addEventListener('click', onClickOutside));
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside));
</script>
