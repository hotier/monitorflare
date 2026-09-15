<template>
  <div class="min-h-screen flex items-center justify-center text-slate-500 dark:text-slate-500">
    <div class="text-center">
      <i class="fas fa-circle-notch fa-spin text-2xl text-emerald-500 mb-4 block"></i>
      <p class="text-sm">{{ $t('login.verifying') }}</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchT, ADMIN_TOKEN_KEY } from '../../utils/api';
import { EP } from '../../utils/endpoints';

const router = useRouter();

onMounted(async () => {
  const token = new URLSearchParams(window.location.hash.split('?')[1] || '').get('token') || '';
  if (!token) { router.replace('/admin'); return; }
  try {
    const res = await fetchT(EP.magicLinkVerify(token));
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      }
    }
  } catch { /* fall through */ }
  router.replace('/admin');
});
</script>
