// ============================================================
// MonitorFlare — Worker 测试配置
//
// 用 Cloudflare 官方测试池在 workerd 中跑测试，因此可以直接拿到
// 真实的 D1 绑定、crypto.subtle、cloudflare:sockets。
//
// 注意两点：
//   1. 文件名用 .mts —— worker/package.json 没有 "type": "module"，
//      用 .ts 会被当成 CJS 加载，而测试池是 ESM-only 包。
//   2. 刻意不读取 wrangler.toml —— 该文件在 .gitignore 中，CI 上是
//      部署时才生成的。测试所需的绑定全部在此显式声明。
// ============================================================
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      miniflare: {
        compatibilityDate: '2024-02-08',
        // 与 wrangler.toml 的 [[d1_databases]] binding = "DB" 对齐
        d1Databases: ['DB'],
        bindings: {
          ADMIN_API_KEY: 'test-admin-key',
          // 留空 => CORS 只放行 localhost
          ALLOWED_ORIGIN: '',
          SESSION_TTL_HOURS: '12',
          BASE_URL: 'https://status.example.com',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
