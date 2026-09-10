<template>
  <footer class="border-t border-black/[0.06] dark:border-white/[0.04] py-3 mt-4">
    <div class="max-w-5xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 items-center gap-4 text-xs text-slate-500 dark:text-slate-500">
      <div class="hidden md:block"></div>
      <div class="flex items-center justify-center gap-2">
        <div class="w-1 h-1 rounded-full bg-emerald-500/40"></div>
        <p>&copy; {{ new Date().getFullYear() }} <a :href="footerUrl" target="_blank" class="hover:text-slate-700 dark:hover:text-slate-400 transition-colors">{{ footerAuthor }}</a>. {{ $t('footer.allRightsReserved') }}</p>
      </div>
      <div v-if="canLogout" class="flex items-center justify-center md:justify-self-end gap-5">
        <button @click="$emit('logout')" class="flex items-center gap-1.5 text-slate-500 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors cursor-pointer" :title="$t('statusLock.logout')">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/></svg>
          {{ $t('statusLock.logout') }}
        </button>
      </div>
    </div>
  </footer>
</template>

<script setup>
defineProps({
    loading: Boolean,
    refreshing: Boolean,
    canLogout: Boolean,
});
defineEmits(['refresh', 'logout']);

// 从 Vite 环境变量读取，回退默认值
const footerAuthor = import.meta.env.VITE_FOOTER_AUTHOR || 'MonitorFlare';
const footerUrl = import.meta.env.VITE_FOOTER_URL || '#';
</script>
