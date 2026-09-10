<template>
  <transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100">
    <div class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm admin-modal-overlay">
      <!-- 标题靠左、警示图标靠右上:按"先读结论、再看提示"的顺序排,长文案换行也不会把标题挤歪 -->
      <div class="glass admin-modal w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
        role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
        <div class="flex items-start justify-between gap-3 px-6 pt-6 pb-2">
          <h3 id="confirm-dialog-title" class="text-lg font-bold text-white pt-1.5">{{ $t('confirmDialog.title') }}</h3>
          <div class="w-10 h-10 shrink-0 bg-red-500/15 rounded-full flex items-center justify-center">
            <i class="fas fa-exclamation-triangle text-red-500" aria-hidden="true"></i>
          </div>
        </div>
        <p id="confirm-dialog-message" class="px-6 pb-6 text-sm text-slate-400 break-words">{{ message }}</p>
        <div class="px-6 pb-6 flex gap-3">
          <!-- 取消:实心中性色按钮。原先只有 border-slate-600 + hover:bg-white/5,
               而 base.css 会把 border-slate-600 改写成 #cbd5e1 —— 浅色下等于"白底浅边框无悬停反馈",
               看着不像按钮;改成浅色 slate-200 / 深色 white-10 的实心底,两种主题都有明确形态 -->
          <button type="button" @click="$emit('cancel')" class="flex-1 py-2.5 rounded-xl bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/20 transition font-medium text-sm cursor-pointer">{{ $t('confirmDialog.cancel') }}</button>
          <button type="button" @click="$emit('confirm')" class="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium text-sm transition shadow-sm cursor-pointer">{{ confirmText || $t('confirmDialog.confirmDelete') }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue';

// confirmText 可选:删除用默认的「确认删除」,退出等操作传自己的按钮文案
defineProps({ message: String, confirmText: { type: String, default: '' } });
const emit = defineEmits(['confirm', 'cancel']);

// 弹窗内没有可聚焦元素,所以 Esc 只能挂在 window 上。
// 组件由 v-if 控制挂载,关闭即注销,不会常驻监听;后台页也有自己的全局 Esc 处理,
// 两处都走 resolveConfirm,重复触发是幂等的(第二次 resolve 已经是 null)。
const onKeydown = (e) => { if (e.key === 'Escape') emit('cancel'); };
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>
