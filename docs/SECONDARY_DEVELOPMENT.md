# MonitorFlare 二次开发指南

> 面向基于本仓库做二次开发（加功能、重构）的开发者。
> 本文档描述的是**当前代码的真实状态**，包括已知的坑和后续改造路线。
>
> **本次范围**：功能扩展 + 架构重构 + 工程基线；**不含品牌与 UI 改造**（见 §1.4）。
>
> 最后更新：基于仓库当前 HEAD（`main` 分支）

---

## 目录

- [1. 项目概览](#1-项目概览)
- [2. 目录与职责地图](#2-目录与职责地图)
- [3. 本地开发环境](#3-本地开发环境)
- [4. 关键运行机制（改代码前必读）](#4-关键运行机制改代码前必读)
- [5. 二次开发扩展点（How-to）](#5-二次开发扩展点how-to)
- [6. 改造路线图](#6-改造路线图)
- [7. 风险清单](#7-风险清单)
- [8. 附录](#8-附录)

---

## 1. 项目概览

### 1.1 架构

```
┌──────────────────────────────────────────────┐
│  frontend  (Vue 3 + Vite + vue-i18n + PWA)   │
│  部署目标: Cloudflare Pages                    │
└───────────────────┬──────────────────────────┘
                    │  /api/* 转发
                    │  ├─ 开发: vite server.proxy (rewrite 去掉 /api)
                    │  └─ 生产: public/_worker.js (Advanced Mode)
                    ▼
┌──────────────────────────────────────────────┐
│  worker  (Hono on Cloudflare Workers)        │
│  ├─ D1 (SQLite, 单库)                         │
│  ├─ R2 (可选, 每日备份)                        │
│  └─ cron 每分钟触发 scheduled() 跑检测         │
└──────────────────────────────────────────────┘
```

### 1.2 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 前端框架 | Vue 3 (Composition API, `<script setup>`) | ^3.5.32 |
| 构建 | Vite | ^6.4.2 |
| 路由 | vue-router | ^4.5.0 |
| 国际化 | vue-i18n | ^11.1.9 |
| 样式 | Tailwind CSS（`darkMode: 'class'`） | ^3.4.19 |
| 图标 | Font Awesome Free | ^7.2.0 |
| 时间 | dayjs | ^1.11.13 |
| 拖拽 | sortablejs | ^1.15.7 |
| PWA | vite-plugin-pwa | ^0.21.2 |
| 后端框架 | Hono | ^4.12.23 |
| 运行时 | Cloudflare Workers（wrangler） | ^4.98.0 |
| 语言 | TypeScript（仅 worker） | ^6.0.3 |
| 数据库 | Cloudflare D1 | — |

### 1.3 关键事实（先记住这几条）

1. **后端只有一个巨型文件**：`worker/src/index.ts` 约 1500 行，承载全部路由 + cron 调度 + 状态页 handler。
2. **前端没有 TypeScript**，全部是 `.js` / `.vue`，依赖运行时约定。
3. **没有任何 lint / test 配置**，唯一的静态检查是 `worker` 的 `npm run typecheck`。
4. **浅色模式靠 70 行 `!important` 属性选择器硬覆盖**（详见 §4.7）。只要不动配色就不受影响。
5. **仓库中仍残留上游作者的域名与仓库地址**（`monitorflare.csr.plus`、`github.com/xusteve/MonitorFlare`）。其中 `frontend/index.html:13` 的 `canonical` 指向他人站点，属正确性问题而非审美问题，建议顺手改掉。
6. **品牌信息散落在 5 个层面共约 57 处硬编码**（清单见 §5.1）。**本次二开不动品牌**，该节仅作参考。

### 1.4 本次二开的范围

**做**：

- 功能扩展（新增监控类型 / 通知渠道 / 接口 / 页面）—— §5.3–§5.7
- 架构重构（拆分 `index.ts`）—— §6 阶段 1
- 工程基线（lint / test / CI）—— §6 阶段 0

**不做**：

- 品牌与 UI 改造（换站名、logo、配色、重做视觉）—— §5.1 / §5.2 保留为参考
- 拆除 `base.css` 的 `!important` hack（属 UI 改造前置，暂不触发）
- 多主题能力

> 唯一的例外：`frontend/index.html:13` 的 `canonical` 指向上游作者站点，这是正确性问题而非审美问题，建议在任意阶段顺手改掉。

---

## 2. 目录与职责地图

### 2.1 仓库根

```
MonitorFlare/
├── frontend/            # 前端 (Vue 3 + Vite)
├── worker/              # 后端 (Cloudflare Worker + Hono)
├── deployer/            # 独立的托管版部署器子项目，自托管可忽略
├── .github/workflows/
│   └── deploy.yml       # 唯一的 CI：push main 自动部署 Worker + Pages
├── README.md            # 主 README（含 8 种语言变体 README.<lang>.md）
├── LICENSE
└── docs/
    └── SECONDARY_DEVELOPMENT.md   # 本文档
```

### 2.2 后端 `worker/src/`

| 文件 | 行数 | 职责 |
|---|---|---|
| `index.ts` | ~1500 | **所有路由 + 鉴权中间件 + cron 调度 + 状态页 handler + 工具函数**（重构首选目标） |
| `channels.ts` | ~320 | 9 种通知渠道 + 5 家邮件 provider 的发送实现 |
| `checks.ts` | ~258 | 检测引擎：`checkHTTP` / `checkDNS`(DoH) / `checkPort`(TCP) + 证书域名信息抓取 |
| `auth.ts` | ~230 | API Key / Magic Link / Google / GitHub / CF Access / 状态页密码 六种认证 |
| `init.ts` | ~150 | 建表 + 自动迁移 + `getSetting` / `getSettingsMap` |
| `i18n.ts` | ~117 | **告警消息**多语言（与前端 locales 是两套独立体系） |
| `utils.ts` | ~110 | 加密/编码/脱敏/时间格式化等通用工具 |
| `types.ts` | ~122 | 全部类型定义 + `Bindings` 环境变量契约 |
| `schema.sql` | — | 8 张表的数据模型（仅对全新库生效） |

**`index.ts` 内部分区**（按行号，便于拆分时定位）：

| 行号区间 | 内容 |
|---|---|
| 1–35 | import + Hono 实例 |
| 37–111 | CORS 中间件 + 鉴权中间件（含状态页私密模式锁定） |
| 116–249 | 认证路由（login / magic-link / oauth） |
| 251–622 | 监控 CRUD、批量操作、排序、日志、统计 |
| 624–704 | 事件/维护窗口 CRUD |
| 706–736 | 设置 + health |
| 738–840 | 通知渠道 CRUD + 测试告警 |
| 842–875 | API Keys |
| 879–897 | 脱敏工具（`maskMonitorSensitive` 等） |
| 899–1001 | `/api/v1` 开放 API 子应用（双前缀挂载） |
| 1006–1051 | 备份 / 恢复 |
| 1053–1121 | 状态页 JSON handler + 状态页登录 |
| 1123–1229 | RSS feed / 订阅 / 退订 / webhook |
| 1232–1450 | **调度任务**（`checkSites` / `performMonitorCheck` / 各类告警 / 清理聚合） |
| 1454–1469 | 邮件工具（登录链接与订阅通知共用） |
| 1474–1486 | 工具函数（`escapeXml` / `safeCompare`） |
| 1491–1496 | 导出 `{ fetch, scheduled }` |

### 2.3 前端 `frontend/src/`

```
src/
├── main.js              # 应用入口：i18n / dayjs / 字体 / 全局样式 / 语言时区辅助函数
├── App.vue
├── router/index.js      # 5 条路由
├── views/
│   ├── StatusPage.vue       # 公开状态页（对外门面）
│   ├── MonitorDetail.vue    # 单个监控详情
│   ├── AdminPage.vue        # 管理后台（~401 行）
│   └── DeployPage.vue       # 一键部署引导页
├── components/
│   ├── admin/           # 14 个后台弹窗组件
│   │   ├── AddMonitorModal.vue
│   │   ├── ChannelsModal.vue        # ~445 行
│   │   ├── IncidentsModal.vue       # ~338 行
│   │   ├── SettingsModal.vue        # 站点设置（品牌相关）
│   │   ├── ApiKeysModal.vue
│   │   ├── MagicLinkHandler.vue
│   │   └── ...
│   └── status/          # 状态页展示组件
│       ├── StatusHeader.vue / StatusFooter.vue / StatusLockScreen.vue
│       ├── HeroBanner.vue
│       ├── MonitorCard.vue
│       ├── UptimeBar.vue
│       └── ...
├── composables/         # useAuth / useTheme / useToast
├── locales/             # 2 种语言（中英文）
│   └── en|zh.json
├── styles/base.css      # 全局样式（352 行，含浅色模式 hack）
└── utils/
    ├── api.js           # fetch 封装（超时/重试/Bearer 注入/状态页锁定判断）
    └── format.js        # 日期与格式工具
```

**前端根配置**：

| 文件 | 关键内容 |
|---|---|
| `index.html` | `<title>` / `<meta description>` / `theme-color` / `canonical` **均硬编码** |
| `vite.config.js` | PWA manifest（硬编码）、`/api` 代理、`conditionalScripts` 注入插件 |
| `tailwind.config.js` | `darkMode: 'class'`，仅扩展了字体与两个 `surface` 色 |
| `.env.example` | 前端环境变量样例 |

### 2.4 前端静态资源 `frontend/public/`

| 文件 | 说明 |
|---|---|
| `_worker.js` | **生产环境**的 `/api/*` 反向代理（Pages Advanced Mode），依赖 `WORKER_URL` 环境变量 |
| `logo.svg` / `favicon.svg` | 品牌图标 |
| `pwa-192.png` / `pwa-512.png` | PWA 图标 |

---

## 3. 本地开发环境

### 3.1 前置要求

- Node.js **≥ 22**（`worker` 使用 `wrangler@4`，`frontend` 使用 `vite@6`）
- npm ≥ 10

### 3.2 首次搭建

```powershell
# 1) 安装依赖（两个子项目独立）
npm install --prefix worker
npm install --prefix frontend

# 2) 生成配置文件
Copy-Item worker/wrangler.example.toml worker/wrangler.toml
Copy-Item frontend/.env.example        frontend/.env

# 3) 启动开发服务器（两个终端）
npm run dev --prefix worker      # http://127.0.0.1:8787
npm run dev --prefix frontend    # http://localhost:5173
```

### 3.3 已知坑（实测踩过）

| 现象 | 原因 | 处理 |
|---|---|---|
| `workerd` 启动失败，提示缺少二进制 | npm 11+ 默认拦截 postinstall 脚本 | 手动执行 `node node_modules/workerd/install.js`（在 `worker/` 目录下） |
| `esbuild` 报 "You installed esbuild for another platform" | 同上，`esbuild` 的 postinstall 被拦截 | `npm rebuild esbuild --prefix frontend` |
| 管理后台登录失败 | 示例配置里 `ADMIN_API_KEY = "your-admin-key"` | 用该值登录，或改 `worker/wrangler.toml` 后由 wrangler 热重载 |
| cron 定时任务不执行 | 本地 `wrangler dev` 不会自动触发 cron | 手动触发：`curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled"` |
| 首次请求报错 / 表不存在 | D1 表由 `ensureInitialized()` 在首次请求时自动创建 | 先访问一次任意接口（如 `/health`）完成建表 |

### 3.4 常用命令

| 命令 | 位置 | 说明 |
|---|---|---|
| `npm run dev` | `worker` | 启动 Worker 开发服务器（`wrangler dev --ip 0.0.0.0`） |
| `npm run dev:remote` | `worker` | 使用远端资源调试（真实 D1） |
| `npm run typecheck` | `worker` | `tsc --noEmit`，**目前唯一的静态检查** |
| `npm run deploy` | `worker` | `wrangler deploy` |
| `npm run dev` | `frontend` | Vite 开发服务器 |
| `npm run build` | `frontend` | 生产构建，输出 `dist/` |
| `npm run preview` | `frontend` | 预览构建产物 |

---

## 4. 关键运行机制（改代码前必读）

### 4.1 请求路径与"双前缀"约定

这是最容易踩坑的地方。链路如下：

```
浏览器  /api/monitors
   │
   ├─ 开发: vite proxy  rewrite: /api → ''    ⇒ Worker 收到 /monitors
   └─ 生产: _worker.js   pathname.slice(4)    ⇒ Worker 收到 /monitors
```

**因此：绝大多数路由在 Worker 侧注册的是"去掉 `/api` 之后"的路径**，例如：

```ts
app.get('/monitors', ...)          // 对应前端 /api/monitors
app.get('/monitors/public/details', ...)
app.post('/settings', ...)  // 实为 app.put
```

但有**两类例外**，必须同时注册两个前缀：

1. **需要被直接访问的公开接口**（外部消费者可能绕过 Pages 直连 Worker）：

```1101:1103:worker/src/index.ts
// 双注册:直连 Worker(/api/status)与经 Pages 代理(/status)
app.get('/api/status', statusHandler);
app.get('/status', statusHandler);
```

同类还有 `/api/status/login`、`/api/subscribe`、`/api/unsubscribe`。

2. **`/api/v1` 开放 API 子应用**：

```999:1001:worker/src/index.ts
// 双前缀挂载:直连 Worker(/api/v1)与经 Pages 代理(/v1)
app.route('/api/v1', v1App);
app.route('/v1', v1App);
```

3. **特殊个例**：`/api/auth/oauth/callback/:provider`（`index.ts:194`）带 `/api` 前缀注册，因为 OAuth 服务商的重定向 URI 是固定的，不能依赖代理 rewrite。

> **新增接口时**：默认只注册去前缀路径即可。如果该接口需要被外部系统直连调用，则再补一个 `/api/xxx` 别名。

### 4.2 鉴权模型

统一在 `index.ts:62-111` 的中间件里处理，顺序如下：

```
OPTIONS 预检 ──► 直接放行
   │
   ▼
ensureInitialized()            幂等建表
   │
   ▼
【私密模式检查】                 仅当 status_page_visibility === 'private'
   命中 STATUS_LOCK_PATHS 且无有效 token ⇒ 401 { error: 'status_page_locked' }
   │
   ▼
【公开路由豁免】
   PUBLIC_PATHS 前缀匹配 / GET /incidents / GET /settings / /monitors/public/details
   │
   ▼
【需鉴权路由】PROTECTED_PREFIXES 命中才继续
   │
   ├─ 1) Cf-Access-Jwt-Assertion 头（Cloudflare Access）
   ├─ 2) Bearer = 会话 token（verifySessionToken）
   ├─ 3) Bearer = 管理员凭据（verifyAdminCredential，即 ADMIN_API_KEY / ADMIN_PASSWORD）
   └─ 4) Bearer = 第三方 API Key（verifyApiKey，哈希比对）
```

关键常量：

```49:60:worker/src/index.ts
const PUBLIC_PATHS = [
  '/auth/', '/monitors/public', '/api/status', '/feed.xml', '/api/subscribe', '/api/unsubscribe', '/webhooks/',
];
const PROTECTED_PREFIXES = ['/monitors', '/notification-channels', '/incidents', '/settings', '/test-alert', '/health', '/api-keys', '/backup', '/api/v1', '/v1'];

// 私密模式下需锁定的公开接口(前缀匹配)
const STATUS_LOCK_PATHS = [
  '/monitors/public', '/incidents', '/settings', '/feed.xml', '/api/status', '/status',
  '/api/subscribe', '/api/unsubscribe', '/subscribe', '/unsubscribe',
];
```

> **注意**：`PUBLIC_PATHS` 与 `PROTECTED_PREFIXES` 存在重叠（如 `/monitors/public` 同时出现在两边），靠**先判断 PUBLIC 豁免**来保证公开接口不被拦截。修改这两个数组时要成对考虑。

### 4.3 状态页私密模式

- 开关：`settings` 表的 `status_page_visibility`（`public` / `private`）
- 密码：`settings` 表的 `status_page_password`，存储的是 **SHA-256 哈希**
- 登录：`POST /api/status/login` → 校验哈希 → 返回 `createStatusToken()` 签发的 JWT
- 前端：token 存 `localStorage`，key 为 `monitorflare_status_token`
- 前端判定：`isStatusLocked(res)` 检查 `401 + { error: 'status_page_locked' }`

### 4.4 检测与调度

```1424:1433:worker/src/index.ts
async function runScheduledTasks(env: Bindings) {
  await ensureInitialized(env);
  const tasks: Promise<void>[] = [checkSites(env)];
  const hour = new Date().getUTCHours();
  if (hour === 2) {
    tasks.push(cleanupAndAggregate(env));
    tasks.push(checkExpiryAlerts(env));
  }
  await Promise.all(tasks);
}
```

- **cron 表达式**：`* * * * *`（每分钟），定义在 `wrangler.toml` 的 `[triggers]`
- **每分钟**：遍历所有未暂停监控 → `isTimeToCheck()` 判断是否到点 → `performMonitorCheck()`
- **每天 UTC 02:00**：`cleanupAndAggregate()`（删 90 天前日志 + 聚合 `daily_uptime` + R2 备份）+ `checkExpiryAlerts()`（证书/域名到期告警）
- **状态机**（`performMonitorCheck`）：
  - 失败：`retry_count + 1`；达到 `alert_after_failures` 且当前为 `UP` → 置 `DOWN` 并告警；否则置 `RETRYING`
  - 成功：若此前是 `DOWN`/`RETRYING` → 置 `UP` 并发送恢复告警
  - 另：`alert_error_rate > 0` 时额外跑 5 分钟错误率检查

### 4.5 数据库初始化与迁移

**没有迁移框架**，靠 `init.ts` 手写：

```100:127:worker/src/init.ts
export async function ensureInitialized(env: Bindings): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        // 探测 settings 表是否存在
        const probe = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").first();
        if (!probe) {
          for (const sql of INIT_STATEMENTS) {
            await env.DB.prepare(sql).run();
          }
        }
        // 确保默认设置存在(幂等)
        ...
```

要点：

1. `INIT_STATEMENTS` **仅在 `settings` 表不存在时执行**，所以只对全新库生效。
2. 老库升级靠 `ensureColumn()`（`PRAGMA table_info` + `ALTER TABLE ADD COLUMN`），目前只补了 3 个列。
3. `initPromise` 是**模块级缓存**，每个 Worker isolate 只跑一次；失败时会置回 `null` 允许重试。

> **新增字段的正确做法**：`schema.sql` 和 `init.ts` 的 `INIT_STATEMENTS` 都要加（新库用），**同时**在 `ensureInitialized()` 里追加一行 `await ensureColumn(env, '表名', '列名', 'DDL')`（老库用）。只改 `schema.sql` 会导致线上老库缺列。

### 4.6 两套独立的 i18n

| | 前端 | 后端 |
|---|---|---|
| 文件 | `frontend/src/locales/*.json` | `worker/src/i18n.ts` |
| 语言数 | 2（en/zh） | 2（同） |
| 用途 | 界面文案 | **告警消息**（邮件/IM 推送内容） |
| 入口 | `vue-i18n` 的 `$t()` | `buildAlertMessage(monitor, type, detail, time, lang)` |

**新增面向用户的消息时，两边都要改。** 后端的语言由 `settings.language` 决定，前端由 `localStorage.monitorflare_lang` 决定。

### 4.7 主题与暗色模式

- 切换方式：`useTheme()` composable 切换 `<html>` 上的 `.dark` 类
- Tailwind 配置：`darkMode: 'class'`
- 默认行为：`isDark` 初值为 `true`；若 `localStorage` 无记录，则**跟随系统** `prefers-color-scheme`
- 存储 key：`localStorage.theme`（值为 `'dark'` / `'light'`），状态页与后台共用同一个 key

**核心问题**：`base.css:186-267` 有约 70 行这样的"反向覆盖"：

```209:216:frontend/src/styles/base.css
html:not(.dark) .admin-modal [class*="bg-slate-900"],
html:not(.dark) .admin-modal [class*="bg-slate-800"] {
    background-color: #f8fafc !important;
}
html:not(.dark) .admin-modal [class*="bg-slate-700"],
html:not(.dark) .admin-modal [class*="bg-slate-600"] {
    background-color: #e2e8f0 !important;
}
```

它靠**匹配 Tailwind 生成的 class 名**来把深色组件反转成浅色。这意味着：

- 组件里任何 `bg-slate-*` / `text-*-400` 的改动都会与这层覆盖产生耦合
- 新增颜色类（如 `bg-zinc-900`）不会被覆盖，浅色模式下会显示成深色
- 这是 UI 改造前**必须先拆除**的技术债（思路见 §5.2）。本次不改配色，暂不触发

### 4.8 客户端存储 key 一览

**注意：存在两套不一致的前缀** —— 品牌相关的用 `monitorflare_`，后台登录相关的却仍是上游遗留的 `uptime_admin_`。二次开发做品牌统一时容易漏掉后者。

| key | 存储位置 | 用途 | 定义位置 |
|---|---|---|---|
| `monitorflare_lang` | localStorage | 语言偏好 | `main.js:34,57` |
| `monitorflare_tz` | localStorage | 时区偏好 | `main.js:51,63,68`、`utils/format.js:25` |
| `monitorflare_status_token` | localStorage | 状态页访问令牌 | `utils/api.js:4,56,64` |
| `theme` | localStorage | 暗色模式偏好 | `composables/useTheme.js:7,21` |
| `uptime_admin_token` | **sessionStorage** | 后台登录令牌 | `composables/useAuth.js:4,28`、`views/AdminPage.vue:240,438`、`components/admin/MagicLinkHandler.vue:25` |
| `uptime_admin_password` | **sessionStorage** | 遗留字段，登录时清除 | `composables/useAuth.js:29,41`、`views/AdminPage.vue:241` |

> 另：`fetchT()`（`utils/api.js:9-16`）会自动把 `monitorflare_status_token` 注入 `Authorization: Bearer` 头。后台接口的 token 则是各组件内联拼装的（见 §5.5）。

---

## 5. 二次开发扩展点（How-to）

> **§5.1（换品牌）与 §5.2（换主题色）本次不在范围内**，保留供参考。
> 实际扩展从 §5.3 开始。

### 5.1 换品牌（可选，参考）

品牌信息目前散落在 **5 个层面、约 57 处**。完整清单：

#### A. HTML 静态（`frontend/index.html`）

| 行 | 内容 | 问题 |
|---|---|---|
| 7 | `<title>MonitorFlare — System Status</title>` | 硬编码 |
| 8 | `<meta name="description">` | 硬编码 |
| 9 | `<meta name="theme-color" content="#0f172a">` | 硬编码 |
| 13 | `<link rel="canonical" href="https://uptime.csr.plus/">` | **上游作者域名，必须改** |

#### B. 构建期注入（`frontend/vite.config.js`）

| 行 | 内容 |
|---|---|
| 21–22 | `%VITE_FOOTER_AUTHOR%` / `%VITE_FOOTER_URL%` 占位符替换 |
| 40–51 | PWA manifest：`name` / `short_name` / `description` / `theme_color` / `background_color` 全部硬编码为 `MonitorFlare` 与 `#0f172a` |

#### C. 运行时数据库（`settings` 表）

由 `init.ts:83-96` 的 `DEFAULT_SETTINGS` 初始化，可在后台 `SettingsModal` 修改：

- `site_title`（默认 `MonitorFlare`）
- `site_description`
- `site_logo_url`（默认 `/logo.svg`）

> 注意：`site_title` 只影响**状态页标题**与 `document.title`。后台页头、邮件主题、PWA 名称都**不受其控制**。

#### D. 前端代码常量（31 处）

| 内容 | 位置 |
|---|---|
| 上游域名 `monitorflare.csr.plus` | `components/status/StatusFooter.vue:8`、`views/AdminPage.vue:107`、`views/DeployPage.vue:16,76` |
| 上游仓库 `github.com/xusteve/MonitorFlare` | `components/status/StatusHeader.vue:60`、`components/status/StatusFooter.vue:22`、`views/AdminPage.vue:121` |
| 第三方深检 `csr.plus/check?domain=` | `components/status/MonitorCard.vue:137`、`views/MonitorDetail.vue:296` |
| 默认站名兜底 `\|\| 'MonitorFlare'` | `StatusPage.vue:7,139`、`MonitorDetail.vue:19,256`、`StatusLockScreen.vue:36`、`StatusHeader.vue:11` |
| 硬编码品牌名 | `components/admin/AdminHeader.vue:6,7`、`views/DeployPage.vue:13,75,81` |
| 客户端存储 key 前缀（`monitorflare_` / `uptime_admin_`） | 见 §4.8 |
| 默认部署链接 | `views/DeployPage.vue:94`（`github.com/yourname/monitorflare`） |

#### E. 后端代码常量（26 处）

| 内容 | 位置 |
|---|---|
| UA 标识 `MonitorFlare/1.0` | `checks.ts:12` |
| 告警邮件 footer（9 语言各一处） | `i18n.ts:31,38,45,52,59,66,73,80,87` |
| 默认站名 | `init.ts:84`、`index.ts:1126,1446` |
| 邮件发件人默认值 | `channels.ts:227`（`'MonitorFlare <noreply@resend.dev>'`） |
| 邮件标题 / OAuth UA | `index.ts:142`、`index.ts:231` |
| 备份 JSON 标识 + 文件名 | `index.ts:989,1014,1015` |
| 文件头注释 | `utils.ts:2`、`types.ts:2`、`i18n.ts:2`、`init.ts:2`、`checks.ts:2`、`channels.ts:2`、`auth.ts:2` |

#### 改造建议：引入单一品牌源

新建 `frontend/src/config/brand.js` 与 `worker/src/brand.ts`，值从环境变量读取并带默认值：

```js
// frontend/src/config/brand.js
export const BRAND = {
  name:        import.meta.env.VITE_BRAND_NAME     || 'MonitorFlare',
  shortName:   import.meta.env.VITE_BRAND_SHORT    || 'MonitorFlare',
  description: import.meta.env.VITE_BRAND_DESC     || 'Realtime monitoring & status page',
  themeColor:  import.meta.env.VITE_BRAND_COLOR    || '#0f172a',
  logo:        import.meta.env.VITE_BRAND_LOGO     || '/logo.svg',
  favicon:     import.meta.env.VITE_BRAND_FAVICON  || '/favicon.svg',
  homepage:    import.meta.env.VITE_BRAND_HOMEPAGE || '',
  repo:        import.meta.env.VITE_BRAND_REPO     || '',
  sslCheckUrl: (host) => `https://csr.plus/check?domain=${encodeURIComponent(host)}`,
  storagePrefix: 'mf_',
};
```

然后：

1. `index.html` 移除硬编码，改由 `vite.config.js` 的 `transformIndexHtml`（该插件已存在，扩展即可）注入
2. `vite.config.js` 的 PWA manifest 改读 `env.VITE_BRAND_*`
3. 前端所有 `'MonitorFlare'` 兜底改为 `BRAND.name`
4. 后端新增 `worker/src/brand.ts`，`i18n.ts` 的 9 个 footer 引用它
5. 客户端存储 key 前缀统一（**注意：会清空老用户的语言/时区/主题偏好与登录态，属可接受的一次性成本**）。同时建议把 `uptime_admin_token` 一并归入新前缀，消除 §4.8 的双前缀不一致

### 5.2 换主题色（可选，参考）

当前主色是 **emerald 绿**（`#22c55e` / `#10b981`），散落在 `base.css` 与 25 个 `.vue` 组件的 Tailwind 原子类里，没有语义 token。

**推荐做法**（本次不实施，仅记录思路）：

1. 在 `base.css` 定义 CSS 变量（亮/暗两套）
2. `tailwind.config.js` 的 `theme.extend.colors` 映射到 `rgb(var(--xxx) / <alpha-value>)`
3. 分批把 `bg-emerald-600` → `bg-brand`、`text-slate-400` → `text-muted`
4. 最后拆除 `base.css:186-267` 的 `!important` hack，改用语义类

**快捷做法**（不推荐，但快）：全局搜索替换色值。缺点是 `base.css` 的 70 行 `!important` 覆盖里的颜色也要同步改，容易漏。

需要同步修改的硬编码色值位置：

- `styles/base.css:103-106`（glow 效果）、`160-178`（uptime bar）、`277`（输入框聚焦）、`285-291`（tag chip）、`294`（批量操作栏）
- `vite.config.js:43-44`（PWA `theme_color` / `background_color`）
- `index.html:9`（`<meta name="theme-color">`）
- `worker/src/channels.ts:21,24-25`（邮件 HTML 模板里的状态色）

### 5.3 新增监控类型

以新增 `ping`（ICMP，实际用 TCP 近似）为例：

**Step 1** — `worker/src/types.ts` 扩展联合类型：

```ts
export type MonitorType = 'http' | 'dns' | 'port' | 'ping';
```

**Step 2** — `worker/src/checks.ts` 新增检测函数并接入分发：

```191:198:worker/src/checks.ts
export async function performCheck(monitor: Monitor, _env: Bindings): Promise<CheckResult> {
  switch (monitor.type) {
    case 'dns':  return await checkDNS(monitor);
    case 'port': return await checkPort(monitor);
    case 'http':
    default:     return await checkHTTP(monitor);
  }
}
```

约定：返回 `CheckResult { ok, statusCode, latency, reason, detail? }`，失败时 `reason` 写人类可读原因（会直接进入告警消息）。类型专属参数从 `monitor.config`（JSON 字符串）解析，参考 `DnsConfig` / `PortConfig` 的写法。

**Step 3** — 前端表单 `components/admin/AddMonitorModal.vue` 增加类型选项与参数表单。

**Step 4** — 前端展示：`components/status/MonitorCard.vue` 的类型徽章（`.type-badge`，见 `base.css:352`）与 `MonitorDetail.vue`。

**Step 5**（如需要）— 证书/域名信息抓取逻辑在 `checks.ts` 的 `updateDomainCertInfo()`，目前只对 `type === 'http'` 生效（`index.ts:1260`）。

### 5.4 新增通知渠道

**Step 1** — `worker/src/types.ts` 的 `ChannelType` 加类型：

```51:53:worker/src/types.ts
export type ChannelType =
  | 'dingtalk' | 'wecom' | 'feishu' | 'telegram'
  | 'webhook' | 'email' | 'slack' | 'discord' | 'ntfy';
```

**Step 2** — `worker/src/channels.ts`：

1. `CHANNEL_TYPES` 数组加新类型（`channels.ts:9`）
2. 实现 `async function sendXxx(cfg: Cfg, msg: AlertMessage): Promise<boolean>`
3. 在 `sendToChannel()` 的 `switch` 中加分支（`channels.ts:307-317`）

可复用的消息构造器：`buildMarkdown(msg)`（纯文本/Markdown 渠道）与 `buildEmailHtml(msg)`（富文本）。

**Step 3** — 前端 `components/admin/ChannelsModal.vue` 增加表单与字段校验。

**Step 4** — 后端敏感字段脱敏：`worker/src/utils.ts` 的 `maskChannelConfig()` 会掩码含 `secret`/`token`/`key` 等关键字的字段，新渠道的敏感字段命名要符合该规则，否则会在 API 响应里明文返回。

**Step 5** — 后端告警文案如需新增变量，改 `worker/src/i18n.ts` 的 `buildAlertMessage()`（同时同步前端 9 个 locale 文件）。

### 5.5 新增后端接口

在 `worker/src/index.ts` 对应分区追加，注意：

1. **路径**：默认注册去 `/api` 前缀的路径（见 §4.1）。需要外部直连再加 `/api/xxx` 别名。
2. **鉴权**：新路径若需保护，要加进 `PROTECTED_PREFIXES`；若需公开，加进 `PUBLIC_PATHS`。
3. **路由顺序**：Hono 按注册顺序匹配，**通配/参数路由必须放在具体路由之后**。例如 `/monitors/public/details`（272 行）必须在 `/monitors/public/:id`（346 行）之前，`/monitors/batch`（588 行）必须在 `/monitors/:id` 之前。
4. **错误处理**：统一 `try/catch` + `c.json({ error: ... }, 500)`，参考现有写法。
5. **前端调用**：用 `utils/api.js` 的 `fetchT`（自动超时 + 注入状态页 token）。
   后台接口需要管理员令牌，目前**没有统一的 `authFetch` 工具**，各组件自己内联拼装，例如：

   ```js
   // components/admin/SettingsModal.vue:241
   const authFetch = async (url, opts = {}) =>
     fetchT(url, { ...opts, headers: { ...opts.headers, 'Authorization': `Bearer ${storedToken.value}` } });
   ```

   `storedToken` 来自 `useAuth()`（读 `sessionStorage.uptime_admin_token`）。新增后台接口时按此模式复制，或考虑抽成公共工具（阶段 0 可一并处理）。

### 5.6 新增数据表 / 字段

**新增表**：

1. `worker/schema.sql` 加 `CREATE TABLE`（新库）
2. `worker/src/init.ts` 的 `INIT_STATEMENTS` 加同样的语句（自动建库）
3. 如需索引，同样两处都加

**新增字段到已有表**：

1. `worker/schema.sql` 的建表语句里加列
2. `worker/src/init.ts` 的 `INIT_STATEMENTS` 里同步
3. **关键**：在 `ensureInitialized()` 里追加 `await ensureColumn(env, '表名', '列名', 'DDL')`，否则老库不会自动升级

> `ensureColumn` 基于 `PRAGMA table_info` + `ALTER TABLE ADD COLUMN`，只支持加列，不支持改类型/删列。

### 5.7 新增前端页面

1. 在 `frontend/src/views/` 新建 `.vue`
2. 在 `frontend/src/router/index.js` 注册路由（当前 5 条，全部懒加载）
3. 文案加到 `frontend/src/locales/*.json`，**en/zh 两个文件都要加**
4. 如果页面需要新 API，按 §5.5 在后端加接口

> 生产环境是 SPA，`public/_worker.js:63-66` 已实现 404 fallback 到 `index.html`，新路由无需额外配置。

---

## 6. 改造路线图

面向"架构重构 + 按需功能扩展"两个目标，建议按以下阶段推进。**每个阶段独立提交，可独立回滚。**

> 品牌与 UI 改造不在本次范围内（见 §1.4），因此原方案中的"品牌集中化"与"主题 token 化"已移出路线图，相关参考材料保留在 §5.1 / §5.2。

### 阶段 0：工程基线（✅ 已完成）

> 没有这层保护，后面拆 1500 行的 `index.ts` 就是盲改。

| 动作 | 落地位置 |
|---|---|
| ESLint 9（flat config） | `eslint.config.mjs`（`eslint-plugin-vue` + `typescript-eslint`），`npm run lint` |
| Prettier | `.prettierrc.json` + `.prettierignore`，`npm run format` |
| Worker 测试 | `worker/vitest.config.mts` + `worker/test/`，跑在 workerd + 真实 D1 上（`@cloudflare/vitest-pool-workers`） |
| Frontend 测试 | `frontend/vitest.config.mjs` + `frontend/test/`，jsdom + `@vue/test-utils` |
| CI 门禁 | `.github/workflows/deploy.yml` 新增 `verify` job，`deploy-worker` / `deploy-pages` 均 `needs: verify` |

当前规模：worker 93 例、frontend 64 例，全量约 9 秒。

**过程中确认的行为（不是缺陷，但容易误解）：**

1. 私密模式下 `/api/status` 等状态页接口只接受「状态页 token」与「后台会话 token」，**不接受裸 `ADMIN_API_KEY`**；同一把 Key 访问 `/monitors` 则正常。见 `worker/test/app.test.ts`。
2. `escapeXml` / `safeCompare` 是 `index.ts` 内的私有函数，无法直接单测，目前通过 `/feed.xml` 端到端覆盖；阶段 1 拆分后会自然变成可测单元。
3. 各 admin modal 的 `<transition>` 子元素没有 `v-if`/`v-show`（父组件用 `v-if` 控制挂载），**进入/离开动画实际从未触发**。修它属于 UI 行为变更，本次未动，已在 `eslint.config.mjs` 中记录。

**顺带清理**：9 处未使用的 import/变量、`vite.config.js` 中 1 处多余转义，行为零变化。

> ⚠️ 新增了根目录 `package.json` / `package-lock.json`，提交时不能漏，否则 CI 的 `npm ci` 会直接失败。

### 阶段 1：拆分 `index.ts`（中风险，纯搬迁）

**原则：只搬不改，行为零变化。**

目标结构：

```
worker/src/
├── index.ts              # 仅剩 app 组装 + fetch/scheduled 导出
├── middleware/auth.ts    # CORS + 鉴权 + 状态页锁定        (原 37-111)
├── routes/auth.ts        # 登录相关                        (原 116-249)
├── routes/monitors.ts    # 监控 CRUD                       (原 251-622)
├── routes/incidents.ts   # 事件/维护                       (原 624-704)
├── routes/settings.ts    # 设置 + health                   (原 706-736)
├── routes/channels.ts    # 通知渠道                        (原 738-840)
├── routes/apiKeys.ts     # API Keys                        (原 842-875)
├── routes/backup.ts      # 备份/恢复                       (原 1006-1051)
├── routes/status.ts      # 状态页 handler + 登录            (原 1053-1121)
├── routes/public.ts      # feed / 订阅 / webhook            (原 1123-1229)
├── routes/v1.ts          # /api/v1 子应用                   (原 899-1001)
├── services/alert.ts     # 告警发送编排                     (原 1301-1391)
├── services/email.ts     # 邮件工具                        (原 1454-1469)
├── scheduler.ts          # 调度任务                        (原 1232-1450)
└── utils/http.ts         # escapeXml / safeCompare / 脱敏    (原 879-897, 1474-1486)
```

每个 `routes/*.ts` 导出 `registerXxxRoutes(app: Hono<{ Bindings: Bindings }>)`。

**三个必须注意的点**：

1. **Hono 路由顺序敏感**，拆分后注册顺序必须与现在完全一致
2. **双前缀注册**（`/api/status` + `/status`、`/api/v1` + `/v1`）不能漏
3. **`safeCompare` 是安全相关**（常量时间比较），搬迁时不要"顺手优化"

**验证方式**（纯搬迁的最大优势）：拆分前用 `curl` 打一组接口存为基线，拆分后重打一遍做 diff。建议覆盖：`/health`、`/monitors/public/details`、`/api/status`、`/status`、`/feed.xml`、`/monitors`、`/backup`。

**影响面**：1 个文件变 16 个，无逻辑变更。

### 阶段 2：按需功能扩展（依赖阶段 1）

拆分完成后，新增功能只需改对应的小文件 + 一个 `registerXxxRoutes`，不再需要动 1500 行的 `index.ts`。具体做法见 §5.3–§5.7。

这一步没有固定清单，按业务需要排期即可。

### 执行顺序

```
阶段 0（工程基线）
   └─► 阶段 1（index.ts 拆分，纯搬迁）
            └─► 阶段 2（按需功能扩展）
```

> 阶段 0 → 阶段 1 是硬依赖（先有测试与 CI 再动结构）。阶段 1 与阶段 2 可以交错，但建议先把结构拆完再加功能，否则新功能会继续堆进 `index.ts`。

---

## 7. 风险清单

| # | 风险 | 影响 | 缓解措施 |
|---|---|---|---|
| 1 | **无测试、无 lint** | 改 1500 行的 `index.ts` 极易失控 | 先做阶段 0 |
| 2 | **路由顺序敏感** | 调整注册顺序可能导致 404 或错误匹配 | 拆分时严格保持原顺序；`/monitors/public/details` 与 `/monitors/:id` 类冲突要特别小心 |
| 3 | **双前缀注册遗漏** | 线上 404（本地正常） | 新增/搬迁路由后逐一核对 §4.1 的三类例外 |
| 4 | **DB 迁移只改 `schema.sql`** | 线上老库缺列，运行时报错 | 必须同时改 `init.ts` 的 `INIT_STATEMENTS` 和 `ensureColumn()` |
| 5 | **浅色模式 `!important` hack** | 改任何组件配色都可能破坏浅色模式 | 本次不改配色，风险不触发；如后续要改，先按 §5.2 做 token 化再拆 hack |
| 6 | **双 i18n 体系** | 只改一边导致告警消息或界面文案缺失 | 新增文案时同步 `locales/*.json`（en/zh 两个）与 `i18n.ts` |
| 7 | **`ADMIN_API_KEY` 写在 `wrangler.toml`** | 敏感信息进版本库 | 部署时改用 `wrangler secret put ADMIN_API_KEY` |
| 8 | **上游域名残留** | 品牌不一致；`index.html` 的 canonical 指向他人站点（SEO / 正确性问题） | 本次只改 `canonical` 一处；完整清理清单见 §5.1 |
| 9 | **客户端存储 key 前缀变更** | 老用户语言/时区/主题偏好与登录态重置 | 一次性成本，可接受；如需兼容可在启动时做一次迁移读取 |
| 10 | **`PUBLIC_PATHS` 与 `PROTECTED_PREFIXES` 重叠** | 误改导致鉴权绕过或公开接口被拦 | 修改时成对考虑，先 PUBLIC 后 PROTECTED |

---

## 8. 附录

### 8.1 环境变量清单

#### Worker（`worker/wrangler.toml` 的 `[vars]` 或 secrets）

| 变量 | 必需 | 说明 |
|---|---|---|
| `DB` | ✅ | D1 数据库绑定 |
| `R2` | ❌ | R2 桶绑定，配置后每日自动备份 |
| `ADMIN_API_KEY` | ⚠️ | 管理员 API Key（与 `ADMIN_PASSWORD` 二选一，**此优先**） |
| `ADMIN_PASSWORD` | ⚠️ | 管理员密码（兼容上游） |
| `MAGIC_LINK_SECRET` | ⚠️ | Magic Link 签名密钥，也是 `getAuthSecret()` 的取值来源之一 |
| `ALLOWED_ORIGIN` | ❌ | CORS 白名单，逗号分隔；留空则仅允许 localhost |
| `SESSION_TTL_HOURS` | ❌ | 会话有效期（小时） |
| `BASE_URL` | ❌ | 站点根 URL（邮件链接、OAuth 回调拼接用） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ❌ | Google OAuth |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | ❌ | GitHub OAuth |
| `CF_ACCESS_AUD` | ❌ | Cloudflare Access 的 Audience 校验值 |
| `DINGTALK_ACCESS_TOKEN` / `DINGTALK_SECRET` | ❌ | 钉钉（旧版全局配置，现推荐走通知渠道表） |

#### Frontend（`frontend/.env`）

| 变量 | 说明 |
|---|---|
| `VITE_CF_ANALYTICS_TOKEN` | Cloudflare Web Analytics token，留空则不注入统计脚本 |
| `VITE_FOOTER_AUTHOR` | 页脚作者名 |
| `VITE_FOOTER_URL` | 页脚作者链接 |
| `VITE_WORKER_URL` | 本地开发时后端地址（默认 `http://127.0.0.1:8787`） |
| `VITE_DEPLOY_GITHUB_URL` | 部署页的一键部署链接（默认指向 `github.com/yourname/monitorflare`） |

#### Cloudflare Pages 环境变量

| 变量 | 说明 |
|---|---|
| `WORKER_URL` | **必需**。`public/_worker.js` 用它做 `/api/*` 反向代理 |
| `ALLOWED_ORIGIN` | CORS 白名单（`_worker.js:74`） |

#### GitHub Actions Secrets / Vars（`.github/workflows/deploy.yml`）

| 名称 | 类型 | 说明 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | 部署凭据 |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | 账号 ID |
| `D1_DATABASE_ID` | Secret | D1 数据库 ID |
| `ADMIN_API_KEY` | Secret | 注入到 `wrangler.toml` |
| `MAGIC_LINK_SECRET` | Secret | 注入到 `wrangler.toml` |
| `VITE_CF_ANALYTICS_TOKEN` | Secret | 构建期注入前端 |
| `ALLOWED_ORIGIN` / `SESSION_TTL_HOURS` / `BASE_URL` | Var | 注入到 `wrangler.toml` |
| `VITE_FOOTER_AUTHOR` / `VITE_FOOTER_URL` | Var | 构建期注入前端 |

### 8.2 数据模型（8 张表）

| 表 | 用途 | 关键字段 |
|---|---|---|
| `monitors` | 监控项 | `type`(http/dns/port)、`config`(JSON)、`status`(UP/DOWN/RETRYING/PAUSED)、`interval`、各类 `alert_*` 阈值、`sort_order` |
| `logs` | 检测日志（保留 90 天） | `monitor_id`、`status_code`、`latency`、`is_fail`、`reason` |
| `daily_uptime` | 每日聚合 | 主键 `(monitor_id, date)`，`total_checks` / `successful_checks` / `avg_latency` |
| `incidents` | 事件与维护窗口 | `severity`、`status`、`type`(incident/maintenance)、`scheduled_start/end` |
| `notification_channels` | 通知渠道 | `type`、`enabled`、`config`(JSON) |
| `settings` | 键值配置 | `key`(主键)、`value` |
| `subscriptions` | 邮件订阅 | `email`(唯一)、`token` |
| `api_keys` | 第三方 API 密钥 | `key_hash`、`last_used_at` |

### 8.3 后端 API 一览

> 下表路径均为 **Worker 侧注册路径**（即去掉 `/api` 前缀之后）。

**认证**

| 方法 | 路径 | 鉴权 |
|---|---|---|
| POST | `/auth/login` | 公开 |
| POST | `/auth/magic-link` | 公开 |
| GET | `/auth/magic-link/verify` | 公开 |
| GET | `/auth/oauth/:provider` | 公开 |
| GET | `/api/auth/oauth/callback/:provider` | 公开（注意带 `/api` 前缀） |

**监控**

| 方法 | 路径 | 鉴权 |
|---|---|---|
| GET | `/monitors` | 需鉴权 |
| GET | `/monitors/public` | 公开 |
| GET | `/monitors/public/details` | 公开 |
| GET | `/monitors/public/:id` | 公开 |
| POST | `/monitors` | 需鉴权 |
| DELETE | `/monitors/:id` | 需鉴权 |
| PATCH | `/monitors/:id/config` | 需鉴权 |
| POST | `/monitors/:id/check` | 需鉴权 |
| PATCH | `/monitors/:id/pause` | 需鉴权 |
| GET | `/monitors/:id/logs` | 需鉴权 |
| GET | `/monitors/:id/stats` | 需鉴权 |
| POST | `/monitors/batch` | 需鉴权 |
| PUT | `/monitors/reorder` | 需鉴权 |

**事件 / 设置 / 渠道 / 密钥**

| 方法 | 路径 | 鉴权 |
|---|---|---|
| GET | `/incidents` | 公开（中间件特判） |
| GET | `/incidents/all` | 需鉴权 |
| POST | `/incidents` | 需鉴权 |
| PATCH | `/incidents/:id` | 需鉴权 |
| DELETE | `/incidents/:id` | 需鉴权 |
| GET | `/settings` | 公开（中间件特判） |
| PUT | `/settings` | 需鉴权 |
| GET | `/health` | 需鉴权 |
| GET | `/notification-channels` | 需鉴权 |
| POST | `/notification-channels` | 需鉴权 |
| PATCH | `/notification-channels/:id` | 需鉴权 |
| DELETE | `/notification-channels/:id` | 需鉴权 |
| POST | `/notification-channels/:id/test` | 需鉴权 |
| POST | `/test-alert` | 需鉴权 |
| GET | `/api-keys` | 需鉴权 |
| POST | `/api-keys` | 需鉴权 |
| DELETE | `/api-keys/:id` | 需鉴权 |

**开放 API（`/api/v1` 与 `/v1` 双挂载）**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/monitors` | 监控列表（敏感头已脱敏） |
| GET | `/logs` | 日志分页查询（`monitor_id`/`since`/`until`/`limit`/`offset`） |
| GET | `/incidents` | 事件列表 |
| GET | `/uptime` | 可用率汇总（`days`） |
| GET | `/export` | 全量导出（排除敏感配置） |

**备份 / 状态页 / 公开**

| 方法 | 路径 | 鉴权 |
|---|---|---|
| GET | `/backup` | 需鉴权 |
| POST | `/backup/restore` | 需鉴权 |
| GET | `/api/status` + `/status` | 公开（私密模式下锁定） |
| POST | `/api/status/login` + `/status/login` | 公开 |
| GET | `/feed.xml` | 公开（私密模式下锁定） |
| POST | `/api/subscribe` + `/subscribe` | 公开 |
| POST | `/api/unsubscribe` + `/unsubscribe` | 公开 |
| POST | `/webhooks/:token` | 公开 |

### 8.4 扩展落点速查

| 想做的事 | 改动位置 |
|---|---|
| ~~换品牌~~（本次不做） | §5.1（`brand.js` / `brand.ts` + 57 处硬编码清单） |
| ~~换主题色~~（本次不做） | §5.2（`base.css` 变量 + `tailwind.config.js` + 组件类名） |
| 新增监控类型 | `types.ts` → `checks.ts`（`performCheck` 分发）→ `AddMonitorModal.vue` → `MonitorCard.vue` |
| 新增通知渠道 | `types.ts` → `channels.ts`（`CHANNEL_TYPES` + `sendToChannel`）→ `ChannelsModal.vue` → `utils.ts` 脱敏规则 |
| 新增后端接口 | `index.ts` 对应分区（注意路径前缀、鉴权数组、路由顺序）→ `utils/api.js` |
| 新增数据表/字段 | `schema.sql` + `init.ts`（`INIT_STATEMENTS` + `ensureColumn`） |
| 新增前端页面 | `views/` 新建 → `router/index.js` 注册 → 9 个 locale 文件加文案 |
| 新增告警文案 | `worker/src/i18n.ts` 的 `buildAlertMessage()` + 前端 locales |
| 改检测频率 | 监控项的 `interval` 字段（秒）；cron 本身固定每分钟 |
| 改日志保留期 | `index.ts` 的 `cleanupAndAggregate()`（当前 90 天） |

---

## 附：本文档的维护约定

- 修改架构（新增文件、调整目录、变更路由约定）时，请同步更新 §2 与 §4
- 完成路线图中任一阶段后，请把该阶段从 §6 移到"已完成"并注明提交范围
- §8.3 的 API 清单可用以下命令快速核对：

```powershell
# 列出 index.ts 中所有路由注册
Select-String -Path worker/src/index.ts -Pattern "app\.(get|post|put|patch|delete|all)\("
```
