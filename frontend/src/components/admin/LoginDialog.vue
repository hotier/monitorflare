<template>
  <transition enter-active-class="transition duration-500 ease-out" enter-from-class="opacity-0 lg:scale-95 translate-y-4" enter-to-class="opacity-100 scale-100 translate-y-0">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 admin-modal-overlay"></div>
      
      <div class="relative w-full max-w-md rounded-2xl overflow-hidden glass" style="animation:modal-in 0.28s cubic-bezier(0.16, 1, 0.3, 1)">
        
        <div class="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent dark:via-emerald-400/25"></div>

        <div class="p-7 relative z-10">
          <div class="flex items-start gap-4 mb-7">
            <div class="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center shrink-0">
              <i class="fas fa-lock text-lg text-emerald-600 dark:text-emerald-400"></i>
            </div>
            <div class="min-w-0 flex-1">
              <h2 class="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{{ $t('login.title') }}</h2>
            </div>
            <!-- 语言切换 -->
            <div class="relative shrink-0" ref="langRef">
              <button @click="langOpen = !langOpen" class="flex items-center gap-1 h-8 px-2 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-all cursor-pointer" :title="$t('languages.' + locale)">
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
          </div>

          <div class="relative group mb-6">
            <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <i class="fas fa-key text-slate-400 dark:text-slate-500 group-focus-within:text-emerald-500 dark:group-focus-within:text-emerald-400 transition-colors duration-300 text-sm"></i>
            </div>
            <input type="password" v-model="inputPassword" @keyup.enter="doLogin"
              class="block w-full pl-12 pr-4 py-3.5 bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 text-sm font-medium outline-none focus:border-emerald-500/60 dark:focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 focus:bg-white dark:focus:bg-slate-900/80 transition-all duration-300 shadow-inner"
              :placeholder="$t('login.passwordPlaceholder')" autocomplete="current-password">
            <p v-if="loginError" class="mt-2 text-xs text-red-500 dark:text-red-400 text-left">{{ $t(loginError) }}</p>
          </div>

          <button @click="doLogin" :disabled="loggingIn"
            class="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl transition-all duration-200 shadow-[0_0_18px_rgba(16,185,129,0.22)] active:translate-y-0 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
            <i v-if="loggingIn" class="fas fa-circle-notch fa-spin"></i>
            {{ loggingIn ? $t('login.verifying') : $t('login.enter') }}
          </button>
        </div>

        <div class="bg-slate-50 dark:bg-slate-950/30 border-t border-slate-200 dark:border-white/5 px-8 py-4 flex justify-between items-center text-xs text-slate-500 font-medium relative z-10">
          <span class="flex items-center gap-1.5">
            <i class="fas fa-server text-slate-500 text-sm"></i>
            {{ $t('login.brand') }}
          </span>
          <router-link to="/" class="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors duration-300 flex items-center gap-1 group">
            {{ $t('login.backToStatus') }}
            <i class="fas fa-chevron-right text-[10px] group-hover:translate-x-0.5 transition-transform"></i>
          </router-link>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { setAppLanguage } from '../../main';
import { useAuth } from '../../composables/useAuth';
const emit = defineEmits(['login']);
const { inputPassword, loginError, loggingIn, login } = useAuth();
const doLogin = () => login(() => emit('login'));

const { locale } = useI18n();
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

<style scoped>
@keyframes modal-in {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
