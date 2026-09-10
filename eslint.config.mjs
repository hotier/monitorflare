// ============================================================
// MonitorFlare — 仓库级 ESLint 配置（ESLint 9 flat config）
//
// 设计原则：阶段 0 只做"能跑起来 + 抓真 bug"，不做风格强制。
//   - 风格统一交给 Prettier（见 .prettierrc.json）
//   - Vue 只启用 essential 档，避免与既有代码产生大量噪音
//   - 后续要收紧时，把 pluginVue 的 flat/recommended 打开即可
// ============================================================
import js from '@eslint/js';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.wrangler/**',
      // 前端静态资源与 PWA 产物（_worker.js 是构建期注入的 Pages Functions）
      'frontend/public/**',
      // wrangler 自动生成的类型声明
      '**/worker-configuration.d.ts',
    ],
  },

  // ---------- 基础规则：JS + TS ----------
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------- 默认环境：Node + Cloudflare Workers ----------
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.worker },
    },
  },

  // ---------- 前端：浏览器全局 + Vue ----------
  {
    files: ['frontend/**/*.{js,mjs,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  ...pluginVue.configs['flat/essential'],
  {
    files: ['frontend/**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },

  // ---------- 规则调优 ----------
  {
    rules: {
      // 代码里大量使用 `catch {}` 做 best-effort 降级（解析失败保留原值等），
      // 这是有意为之，不视为错误。真正空的控制流块仍会报错。
      'no-empty': ['error', { allowEmptyCatch: true }],

      // 约定：以下划线开头的参数/变量表示"签名需要但有意不用"
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      // ── 以下两条是"已知债务"，阶段 0 不修，避免改动业务行为 ──
      //
      // 1) 所有 admin modal 都是父组件用 v-if 控制挂载，`<transition>` 的
      //    子元素因此没有 v-if/v-show，进入/离开动画实际从未触发。
      //    修复方式（二选一）属于 UI 行为变更，留到后续单独处理：
      //      a. 删掉无用的 <transition> 包裹；或
      //      b. 改为常驻 + v-if 控制，让过渡真正生效。
      'vue/require-toggle-inside-transition': 'off',
      //
      // 2) AddMonitorModal / ConfigModal 等直接修改 props 上的对象（约 35 处），
      //    是当前的表单数据流设计。修正需要改成 emit 事件或本地副本，
      //    属于结构性重构，不在阶段 0 范围内。
      'vue/no-mutating-props': 'off',
    },
  },

  // ---------- 必须放最后：关掉与 Prettier 冲突的格式规则 ----------
  prettier,
);
