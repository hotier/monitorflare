<template>
  <!-- 多层动态背景光晕 -->
  <div class="fixed inset-0 overflow-hidden pointer-events-none -z-10">
    <div class="absolute -top-48 -right-48 w-[800px] h-[800px] bg-emerald-500/[0.015] dark:bg-emerald-500/[0.07] rounded-full blur-[128px]" style="animation: float 25s ease-in-out infinite"></div>
    <div class="absolute top-1/2 -left-64 w-[600px] h-[600px] bg-sky-500/[0.01] dark:bg-cyan-500/[0.04] rounded-full blur-[100px]" style="animation: float 30s ease-in-out infinite reverse"></div>
    <div class="absolute -bottom-32 right-1/4 w-[500px] h-[500px] bg-indigo-500/[0.008] dark:bg-violet-500/[0.03] rounded-full blur-[120px]" style="animation: float 35s ease-in-out infinite 5s"></div>
    <div class="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white dark:from-emerald-950/20 to-transparent"></div>
  </div>

  <!--
    缓存三个主视图:切走时不销毁实例,回来时滚动位置、已选区间、图表选中点、
    搜索与筛选条件都还在。数据本身由 composables/resources.js 在模块级持有。

    两个注意点:
    1. 不要用 :key="route.fullPath" —— 那会让每个 /monitor/:id 各留一个实例且永不回收。
       详情页的路由参数变化由组件内的 watch 处理(见 MonitorDetail.vue)。
    2. DeployPage / MagicLinkHandler 故意不缓存:前者是低频管理工具页,
       后者是登录中转页,缓存只会残留过期状态。

    被缓存的页面必须自己处理 onActivated / onDeactivated(keep-alive 下 onUnmounted
    不会触发),否则定时器和全局键盘监听会在页面不可见时继续跑。
  -->
  <router-view v-slot="{ Component }">
    <keep-alive :include="['StatusPage', 'MonitorDetail', 'AdminPage']">
      <component :is="Component" />
    </keep-alive>
  </router-view>

  <!-- 全局确认弹窗:所有「删除 / 退出」类操作统一走它,见 composables/useConfirm.js -->
  <ConfirmDialog v-if="confirmState.show" :message="confirmState.message" :confirmText="confirmState.confirmText"
    @confirm="resolveConfirm(true)" @cancel="resolveConfirm(false)" />
</template>

<script setup>
// App.vue — 根组件，只负责背景、路由出口和全局确认弹窗
import { useConfirm } from './composables/useConfirm';
import ConfirmDialog from './components/admin/ConfirmDialog.vue';

const { confirmState, resolveConfirm } = useConfirm();
</script>
