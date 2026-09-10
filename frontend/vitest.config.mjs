// ============================================================
// MonitorFlare — 前端测试配置
//
// 刻意与 vite.config.js 分开：那份配置挂了 PWA 插件（构建期才需要），
// 测试里加载它只会拖慢启动并引入无关副作用。
// 文件名用 .mjs 是因为 frontend/package.json 没有 "type": "module"。
// ============================================================
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
  },
});
