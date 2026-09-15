# 前端切页与首屏加载体验优化 — 设计说明

日期：2026-09-11
状态：待审查

## 1. 问题

用户在状态页、监控详情页、管理后台之间切换时，每次都会看到骨架屏并重新等待数据；管理后台打开任意弹窗（日志 / 通知渠道 / 事件 / 设置 / API 密钥）同样会重新加载。此外冷启动（首次打开或整页刷新）也要完整等待一次网络往返。

## 2. 现状证据

| 现象 | 位置 | 说明 |
| --- | --- | --- |
| 路由无实例缓存 | `frontend/src/App.vue:10` | 只有裸 `<router-view />`，无 `<keep-alive>` |
| 页面全部懒加载 | `frontend/src/router/index.js:3-29` | 5 个路由均为 `() => import(...)` |
| 状态页每次都拉 3 个接口 | `frontend/src/views/StatusPage.vue:261-266` | `/monitors/public/details`、`/incidents`、`/settings` |
| 详情页每次都拉 2 个接口 | `frontend/src/views/MonitorDetail.vue:582-586` | 且 `loading` 初值为 `true`（`MonitorDetail.vue:276`） |
| 管理页每次都拉 4 个接口 | `frontend/src/views/AdminPage.vue:464-473` | `/monitors`、`/monitors/public/details`、`/health`、`/settings` |
| 骨架屏判据依赖组件内数据 | `StatusPage.vue:16`、`MonitorDetail.vue:22`、`AdminPage.vue:69` | 组件销毁即 `length === 0`，骨架屏必然出现 |
| 缓存生命周期绑在组件上 | `MonitorDetail.vue:283`（`seriesCache`）、`AdminPage.vue:169` | 离开页面即丢失 |
| `/settings` 被重复拉取 | `StatusPage.vue:204`、`MonitorDetail.vue:563`、`AdminPage.vue:288`、`SettingsModal.vue:335` | 同一份公开配置，4 处各拉一遍 |
| 弹窗每次挂载都取数 | `ChannelsModal.vue:497`、`IncidentsModal.vue:378`、`SettingsModal.vue:335`、`ApiKeysModal.vue:221` | 顶层直接调用 fetch，无缓存 |
| 定时器/监听器未纳管 | `AdminPage.vue:473-480` | `setInterval` 未保存句柄，`keydown` 未解绑；`StatusPage.vue:267`、`MonitorDetail.vue:587` 只在 `onUnmounted` 清理 |

补充结论：PWA 的 `workbox.globPatterns` 已预缓存全部 js/css，**第二次切页不存在 chunk 重新下载**；`runtimeCaching` 中 `/api/status` 与 `/monitors/public` 用的是 `NetworkFirst`，在线时不加速。因此白屏时间主要来自 API 往返，优化重点在数据层。

## 3. 目标与非目标

**目标**

1. 已访问过的页面之间来回切换，不再出现骨架屏（数据瞬时可用）
2. 页面内状态（滚动位置、已选区间、图表选中点、搜索结果、弹窗开关）在返回时保持
3. 冷启动时先渲染上一次的数据快照，再后台刷新
4. 去掉重复请求：`/settings` 全局只保留一份

**非目标**

- 不修改 Worker 端的 HTTP 缓存头（私密模式下的缓存正确性需要单独设计）
- 不调整 Service Worker 的运行时缓存策略（理由见 §5.8）
- 不引入 Pinia 等状态管理库
- 不改变任何接口的响应结构

## 4. 设计总览

三层，各司其职：

```
数据层  composables/useResource.js  通用缓存资源（机制）
        composables/resources.js    资源声明（配置）
组件层  App.vue <keep-alive>        保住页面实例
界面层  views/*.vue                 骨架屏条件改为"仅无数据时显示"
```

数据层的资源是**模块级单例**，生命周期与模块一致，不随组件挂载/卸载变化——这是解决"切页即丢失"的关键。

## 5. 详细设计

### 5.1 `composables/useResource.js` — 通用缓存资源机制

对外只暴露一个工厂函数：

```js
defineResource(key, { fetcher, ttl = 0, persist = null })
```

同一 `key` 在进程内只创建一次条目，重复调用返回同一实例。返回值：

| 成员 | 类型 | 语义 |
| --- | --- | --- |
| `data` | `Ref` | 数据。使用**深响应式** `ref`，与现有 `monitors = ref([])` 一致 |
| `loading` | `Ref<bool>` | **仅在"无数据且请求进行中"为 `true`** —— 骨架屏的唯一判据 |
| `refreshing` | `Ref<bool>` | 有数据时的后台刷新中，供刷新按钮转圈 |
| `error` | `Ref` | 最近一次失败原因，成功时清空 |
| `updatedAt` | `Ref<number>` | 最近一次成功的时间戳（快照恢复时为 `0`，即视为过期） |
| `ensure(opts)` | `async` | 见下 |
| `refresh()` | `async` | 等价于 `ensure({ force: true })` |
| `invalidate()` | `void` | 清空数据、时间戳与持久化快照 |

`data` 必须是深响应式，不能图省事用 `shallowRef`：现有代码大量依赖就地修改数组元素（`MonitorList.vue:91-92` 读 `m._checking`、`ChannelsModal.vue:474` 写 `ch.enabled`），浅响应式会让这些既有交互静默失效。

`ensure({ force = false })` 的决策顺序：

1. 已有 `inflight` 请求 → 直接返回同一个 Promise（并发去重）
2. 未 `force` 且 `data != null` 且 `Date.now() - updatedAt < ttl` → 直接返回，不发请求
3. 否则发起请求：
   - `data == null` → `loading = true`（首次加载，显示骨架屏）
   - `data != null` → `refreshing = true`（后台刷新，**不显示骨架屏**）
   - 成功 → 替换 `data`、更新 `updatedAt`、清 `error`、写快照
   - 失败 → 记录 `error`，**保留旧数据**（与现有 `catch {}` 行为一致）
   - 最终清 `inflight` 与两个标志

`ensure` **不向外抛异常**。现有代码到处是 `try {} catch {}`，让调用方统一通过 `error` 判断更不易漏掉，也避免产生未处理的 Promise 拒绝。

请求统一用 `utils/api.js` 的 `fetchT` + `withRetry` 包装，保持现有的超时与重试语义。

### 5.2 `composables/resources.js` — 资源声明

统一以命名空间方式导入，避免与视图内的同名 computed 撞名：

```js
import * as resources from '../composables/resources';
// 使用：resources.publicMonitors.data.value
```

| 导出名 | 端点 | 鉴权 | ttl | 持久化 |
| --- | --- | --- | --- | --- |
| `siteSettings` | `GET /settings` | 公开 | 5 分钟 | 是 |
| `publicMonitors` | `GET /monitors/public/details` | 公开 | 15 秒 | 是 |
| `publicIncidents` | `GET /incidents` | 公开 | 30 秒 | 否 |
| `adminMonitors` | `GET /monitors` | Bearer | 15 秒 | 否 |
| `health` | `GET /health` | Bearer | 30 秒 | 否 |
| `notificationChannels` | `GET /notification-channels` | Bearer | 60 秒 | 否 |
| `allIncidents` | `GET /incidents?status=all` | Bearer | 30 秒 | 否 |
| `apiKeys` | `GET /api-keys` | Bearer | 60 秒 | 否 |

注意 `publicIncidents`（`GET /incidents`，只返回 `status = 'active'`）与 `allIncidents`（`GET /incidents?status=all`，管理员全量）是同一端点的两种口径、不同用途的资源，缓存 key 必须分开（原为 `/incidents` 与 `/incidents/all` 两个端点，合并后靠 `?status=` 区分）。

**ttl 取值理由**：状态数据 15 秒（页面已有 30 秒轮询，ttl 只需覆盖"切走再切回"的间隔）；站点配置 5 分钟（几乎不变）；通知渠道与 API 密钥 60 秒（低频变更）。

**鉴权请求统一走 `utils/api.js` 新增的 `authFetchT(url, opts)`**：自动附加 `Authorization: Bearer <storedToken>`，并在收到 401 时清空 `sessionStorage` 的 `uptime_admin_token` / `uptime_admin_password` 后 `location.reload()`。

这是把 `AdminPage.vue:212-221` 的 `authFetch` 提取为共享实现。必要性：现在只有 `AdminPage` 的请求带 401 重登逻辑，`ChannelsModal` / `IncidentsModal` / `ApiKeysModal` 各自的 `authFetch` 在 401 时只是静默失败。资源层统一后，若沿用后者的行为，`AdminPage` 原有的 401 处理会丢失——这是必须避免的回归。统一后所有管理端请求行为一致，token 失效时一律回到登录态。

令牌从 `useAuth()` 的模块级 `storedToken` 读取，因此登出（`useAuth.logout` 与 401 分支均为整页跳转/刷新）会自动重置模块状态，无需额外的缓存清理逻辑。

**响应结构不变**：`siteSettings` 存 `/settings` 的原始键值对象，`publicMonitors` 存 `{ monitors: [...] }` 原始响应，其余资源同理。资源层不做字段裁剪，视图侧自行取用。

### 5.3 首屏快照（持久化）

`persist` 参数形如：

```js
persist: {
  key: 'monitorflare_snapshot_public_monitors',
  version: 1,
  maxAge: 24 * 3600_000,
  pick: (data) => data,           // 返回 null 表示不写入
}
```

- **写入**：每次拉取成功后 `localStorage.setItem(key, JSON.stringify({ v, at, data }))`，用 `try/catch` 包住（可能超配额）
- **跳过**：`JSON.stringify` 后超过 **512 KB** 则跳过并删除旧快照
- **读取**：模块初始化时**同步 hydrate**，`version` 不匹配或超过 `maxAge` 则丢弃
- **恢复后**：`data` 有值、`updatedAt = 0` → 首次 `ensure()` 判定为过期 → `refreshing` 而非 `loading`，即**立刻渲染快照、后台静默刷新**

`siteSettings` 的 `pick` 必须过滤敏感字段：

```js
pick: (d) => (d && d.status_page_password ? null : d)
```

理由：`GET /settings` 在私密模式下经鉴权后返回 settings 表的全部键值，包含 `status_page_password` 哈希（见 `worker/src/init.ts:162-167` 与 `worker/src/index.ts:826-829`，无字段过滤）。该哈希被写入 localStorage 会在共享设备上长期留存。**检测到该字段即整体放弃持久化**，不做快照。

`publicMonitors` 不含任何敏感字段（`worker/src/index.ts:285-287` 的 SELECT 列表），可安全持久化。

### 5.4 `App.vue` — keep-alive

```vue
<router-view v-slot="{ Component }">
  <keep-alive :include="['StatusPage', 'MonitorDetail', 'AdminPage']">
    <component :is="Component" />
  </keep-alive>
</router-view>
```

三个视图用 `defineOptions({ name: ... })` 显式声明组件名（Vue 3.5 支持），不依赖文件名推断。

`DeployPage` 与 `MagicLinkHandler` **不缓存**：前者是低频的管理工具页，后者是登录中转页，缓存只会带来状态残留。

**不在 `<component>` 上使用 `:key="route.fullPath"`**：那会让每个 `/monitor/:id` 各自保留一个实例且永不回收。详情页的路由参数变化改由组件内 `watch` 处理（见 §5.6）。

### 5.5 页面生命周期改造

keep-alive 下 `onUnmounted` **不会触发**，现有清理逻辑会失效。三个被缓存页面统一改为：

```js
let _timer = null;
const tick = () => resources.publicMonitors.ensure();   // 各页面的取数逻辑
const startPolling = () => {
  if (_timer) return;                    // 幂等：mounted 与 activated 可能连续触发
  _timer = setInterval(tick, 30_000);
};
const stopPolling = () => {
  if (_timer) { clearInterval(_timer); _timer = null; }
};

onMounted(startPolling);
onActivated(startPolling);
onDeactivated(stopPolling);
onUnmounted(stopPolling);
```

`AdminPage` 额外处理：

- `AdminPage.vue:473` 的 `setInterval(fetchMonitors, 30000)` 目前**连句柄都没保存**，必须改为受 `startPolling`/`stopPolling` 管理
- `AdminPage.vue:474-480` 的 `keydown` 监听提取为具名函数 `onKeydown`，同样纳入 `startPolling`/`stopPolling`。否则停在状态页时按 `r` 会触发后台页刷新、按 `/` 会去聚焦后台页的搜索框
- OAuth hash 解析（`AdminPage.vue:465-472`）留在 `onMounted`，只需执行一次

`MonitorDetail` 是例外：它没有对应的模块级资源（见 §5.6），`monitor` / `logs` / `latencySeries` 仍是组件内的局部状态，因此 §5.9 的"绑定资源 `loading`"对它不适用。它只需把 `loading` 初值从 `ref(true)` 改为 `ref(false)`，避免首屏出现一次空骨架屏。

### 5.6 详情页路由参数变化

`MonitorDetail` 被缓存后，实例会在不同 `:id` 之间复用，必须显式处理：

```js
const loadedId = ref('');
watch(monitorId, (id) => { if (id !== loadedId.value) resetFor(id); });
```

`resetFor(id)` 的动作：清空 `monitor`、`logs`、`incidents`、`latencySeries`、`seriesCache`、`hoverIdx`、`pinIdx`、`range` 复位为 `'24h'`，然后拉取新数据。清空是必要的——否则会先闪现上一个监控的数据配当前 URL，这是缓存复用最典型的脏数据 bug。

**有意不做 per-id 的模块级详情缓存**：常态路径是"列表 → 详情 → 返回 → 再进同一个详情"，keep-alive 的单实例已能覆盖（`route.params.id` 未变，`watch` 不触发，数据原样保留）。为"看过的其他监控"再建一层 LRU 缓存的收益不足以抵消复杂度。

`onActivated` 中若 `Date.now() - lastFetchAt > 30s` 则后台刷新，保证长时间停留后返回能看到新数据。

### 5.7 弹窗数据缓存

弹窗由父级 `v-if` 控制挂载，实例不保留，因此数据必须提到模块级资源：

| 弹窗 | 现状 | 改为 |
| --- | --- | --- |
| `ChannelsModal.vue:497` | 顶层 `fetchChannels()` | `notificationChannels` 资源，打开时 `ensure()` 并直接渲染缓存 |
| `IncidentsModal.vue:378` | 顶层 `fetchIncidents()` | `allIncidents` 资源 |
| `SettingsModal.vue:335` | 顶层 `fetchSettings()` | **复用 `siteSettings` 资源**（同一端点） |
| `ApiKeysModal.vue:221` | `onMounted(fetchKeys)` | `apiKeys` 资源 |
| `LogsModal`（由 `AdminPage.viewLogs` 驱动） | 每次清空并重拉 | `AdminPage` 内维护 `Map<monitorId, { data, offset, hasMore, at }>`，命中且未超 30 秒则直接渲染 |

各弹窗的骨架屏判据同步改为 `loading && list.length === 0`，即只在真正无数据时显示。

写操作（新增/编辑/删除/启停）成功后调用对应资源的 `refresh()`，保证下一次打开看到的是新数据。

`SettingsModal` 保存成功后：`siteSettings.refresh()` 替代 `AdminPage.vue:126` 的 `@saved="fetchSiteSettings"`，使状态页的品牌信息同步更新。`fetchSiteSettings` 随后可删除。

`LogsModal` 的 `viewLogs` 在命中缓存时仍需允许"加载更多"，因此缓存条目要一并保存 `logOffset` 与 `hasMoreLogs`。

### 5.8 Service Worker：保持现状（决策记录）

原方案包含"把 `/monitors/public` 的 `NetworkFirst` 改为 `StaleWhileRevalidate`"，评审后**取消**，理由：

1. **收益重叠**：应用层（§5.1 + §5.3）已经实现"先渲染旧数据、后台刷新"，SW 再加一层 SWR 只是在同一件事上叠第二层。
2. **私密模式下无法在 SW 层安全判定**：`statusLogout()` 是 `StatusPage.vue:226-233` / `MonitorDetail.vue:553-561` 的退出入口，它清掉 token 后 `locked = true`，但 SW 会抢先返回上一次鉴权成功时缓存的 200 响应——用户会看到已退出的内容。SW 无法知道当前是否处于私密模式（`status_page_visibility` 只在 `/settings` 的响应体里），要做对必须让 Worker 在响应头打标记，属于跨端改造。
3. 风险与收益不成比例，违背"只做低风险项"的既定范围。

`vite.config.js` 的 `runtimeCaching` 保持 `NetworkFirst` 不变。

### 5.9 视图侧约定

资源层返回的 `data` 在首次加载前是 `null`，直接写进模板会导致空值访问。视图侧统一用 computed 提供带默认值的视图模型，**模板里不出现裸的 `.data`**：

```js
// StatusPage
const monitors = computed(() => resources.publicMonitors.data.value?.monitors || []);
const incidents = computed(() => resources.publicIncidents.data.value || []);
const siteSettings = computed(() => resources.siteSettings.data.value || {
  site_title: 'MonitorFlare', site_description: '', site_logo_url: '',
});
```

现有 `StatusPage.vue:131-137`、`MonitorDetail.vue:272-281`、`AdminPage.vue:169-173` 里的 `ref([...])` / `ref({})` 声明与手动赋值全部由这类 computed 取代。凡是读取（而非写入）这些数据的地方都无需再改，`loading` / `refreshing` 则直接绑定对应资源的同名成员。

**`document.title` 与 meta description 的副作用归属**：现有三处都会在拿到 `/settings` 后改写标题（`StatusPage.vue:211-213`、`MonitorDetail.vue:570`、`AdminPage.vue:293-295`）。改为各页面 `watch` 自己的视图模型后在组件内执行，不进资源层——标题文案因页面而异（详情页要拼监控名），放进共享 fetcher 会产生页面间的互相覆盖。

**`AdminPage` 列表合并**：`AdminPage` 需要的列表是 `/monitors`（含配置，鉴权）与 `/monitors/public/details`（含 `latency` / `recent_latencies`）的并集：

```js
const monitors = computed(() => {
  const pub = new Map((resources.publicMonitors.data.value?.monitors || []).map(m => [m.id, m]));
  return (resources.adminMonitors.data.value || []).map(m => {
    const p = pub.get(m.id);
    return { ...m, _latency: p?.latency ?? null, _sparkData: p?.recent_latencies ?? null };
  });
});
```

原实现是就地给 `adminData` 的元素挂 `_latency` / `_sparkData`（`AdminPage.vue:269`），改为返回新对象的 computed 后，**不要再往元素上挂临时标记**——`computed` 每次重算都会重建对象，挂上去的标记随时会丢。

具体受影响的 `_checking`（`AdminPage.vue:343-345` 写入，`MonitorList.vue:91-92` 读取，用于手动检测期间禁用按钮、防止重复点击）：改为组件内的 `const checkingIds = ref(new Set())`，传给 `MonitorList` 或在模板里判断，不再写在监控对象上。

## 6. 边界与安全

| 场景 | 处理 |
| --- | --- |
| `localStorage` 不可用 / 超配额 | 快照写入整体 `try/catch`，失败即降级为纯内存缓存，不影响功能 |
| 快照体积过大 | 序列化后 > 512 KB 则放弃该次写入并删除旧快照 |
| 快照版本升级 | `version` 字段不匹配直接丢弃，避免旧结构被新代码消费 |
| 快照含敏感字段 | `siteSettings` 检测到 `status_page_password` 时整体不持久化 |
| 私密模式锁定 | 现有 `isStatusLocked` 分支保持，命中时清空数据并 `invalidate()` 对应资源与快照 |
| 管理端登出 / 401 | 统一走 §5.2 的 `authFetchT`：401 时清 sessionStorage 并 `location.reload()`；登出本身也是整页跳转，模块状态随之重置，无需额外清理 |
| keep-alive 与 `v-if` 弹窗 | 弹窗位于视图模板内，页面被 deactivate 时随组件一同隐藏，无状态泄漏 |

## 7. 验收标准

1. 状态页 → 详情页 → 返回状态页：**返回时不出现骨架屏**，且列表滚动位置保持
2. 状态页 ↔ 管理页来回切换：切换后**不出现骨架屏**，页面内筛选/搜索/已选中的监控保持
3. 详情页在 7d/30d 区间与图表选中点之间切换后返回列表再进入，状态保持
4. 依次打开通知渠道、事件、设置、API 密钥弹窗并关闭，再打开任意一个：**不出现骨架屏**
5. 冷启动（清空内存后整页刷新）：先看到上次的数据，随后被新数据替换，全程不出现整屏骨架屏
6. 停在状态页时按 `r` / `/`：**不触发后台页的刷新与搜索聚焦**
7. 在状态页停留超过 30 秒后切到管理页再切回：数据已更新
8. 网络断开时打开应用：渲染快照数据，不白屏
9. `frontend` 的 `npm run test` 全绿；`worker` 测试不受影响

## 8. 测试策略

单元测试（`frontend/test/`，vitest + jsdom，与现有 `.test.js` 同风格）：

- `useResource.test.js`
  - 同一 key 重复调用返回同一实例
  - 无数据时首次 `ensure()` 使 `loading` 为 `true`；有数据时仅 `refreshing`
  - ttl 内重复 `ensure()` 不触发 fetcher；`force` 会触发
  - 并发 `ensure()` 只发一次请求
  - fetcher 失败时保留旧数据且不抛出
  - `persist` 的写入 / 读取 / `version` 不匹配丢弃 / 超 `maxAge` 丢弃 / `pick` 返回 `null` 时不写入
  - hydrate 后 `updatedAt === 0`，首次 `ensure()` 走 `refreshing` 分支

组件级测试需要覆盖的部分（`StatusPage` / `AdminPage` 已有较重依赖，优先靠手工验收清单，不强行铺开）：

- `AdminPage` 的 `onActivated` / `onDeactivated` 启停定时器：可用假定时器断言 `clearInterval` 被调用

手工验收：按 §7 逐条走一遍。

## 9. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| keep-alive 引入定时器/监听器泄漏 | §5.5 的幂等 start/stop 模式 + §6 的"停在其他页按 r 无效"验收项 |
| 详情页复用实例导致数据显示错乱 | §5.6 的 `resetFor` 清空 + 验收项 3 |
| 快照展示过期数据误导用户 | 状态页已有 `lastUpdated` 展示；ttl 默认 15 秒，切回即刷新 |
| 改动面较大，难以定位回归 | 按"数据层 → keep-alive → 生命周期 → 弹窗"四步递交，每步可独立编译与验证 |

回滚粒度：数据层（新增两个文件 + 各页替换调用）、组件层（`App.vue` 一行）、生命周期（各页脚本段）、弹窗（各组件脚本段）互不耦合，可分别还原。

## 10. 待确认事项（超出本次范围，仅记录）

`GET /settings` 在私密模式经鉴权后会把 `status_page_password` 哈希原样返回（`worker/src/index.ts:826-829` 无条件 `getSettingsMap`）。状态页的 token 由该哈希派生，因此持有该 token 的访客可获取哈希并据此伪造身份。本次仅将其排除出持久化快照，未改动接口行为，建议后续单独评估。

## 11. 实现注意点

落地过程中实际踩到或差点踩到的坑，后续维护这几个文件时值得先看一眼。

| # | 现象 | 原因与处理 |
| --- | --- | --- |
| 1 | 页面状态莫名不对，**不报错也不警告** | 给只读 `computed` 赋值，生产构建下静默失败。`StatusPage.subscribe()` 与 `MonitorDetail` 里原本各有若干处 `locked.value = true`。已改为 `forceLocked` ref + `locked = computed(() => forceLocked.value \|\| 各资源的 locked)`。排查手法：全仓扫 `\b(monitors\|channels\|incidents\|keys\|siteSettings\|health\|error\|loading)\.value\s*=[^=]` |
| 2 | 无持久化的资源调用 `invalidate()` 直接抛错 | `store.clear?.()` 写成对 `null` 取属性，应为 `store?.clear()`。被单测抓到 |
| 3 | 构建报 `Unexpected token`，行号指向下一个函数 | 替换函数体时没收干净残留的 `};`。语法问题只有构建期能暴露，改完函数务必构建一次 |
| 4 | 列表按钮的 loading 状态闪一下就没 | `computed` 每次重算都重建数组，挂在监控对象上的 `m._checking` 随之丢失。已改为组件内 `reactive(new Set())` 并透传给 `MonitorList` |
| 5 | 定时器/键盘监听重复注册或不释放 | keep-alive 下 `onUnmounted` 不触发，清理必须挂 `onDeactivated`；且首次进入时 `onMounted` 与 `onActivated` 会连续触发，start 必须幂等。详情页还有一层：两个钩子都会调 `loadDetail`，用 30 秒时间戳闸门去重 |
| 6 | 详情页闪出"上一个监控的内容 + 当前 URL" | 实例被复用但数据没换。切 `:id` 时必须走 `resetFor()`，其中 `seriesCache` 尤其不能漏（按区间存，内容却属于上一个监控） |
| 7 | 缓存忽然不再跨页共享 | 模块级单例的前提是打包器只保留一份。已验证 `monitorflare_snapshot_monitors` 在 `dist` 里只出现于一个共享 chunk。若将来把这几个模块手工拆进异步 chunk，方案即失效 |
| 8 | 事件列表内容不对 | `/incidents`（公开，只返回 active）与 `/incidents?status=all`（管理端全量）口径不同，必须是两个资源（同一端点、两种 query） |
| 9 | 用户刚输入的设置被冲掉 | `SettingsModal` 先用缓存填表再 `ensure()`，之后只有 `updatedAt` 变了才重新填表，避免后台刷新覆盖用户输入 |
| 10 | 私密模式下仍能看到缓存内容 | 被 `locked` 挡下时顺手 `data = null` + `store.clear()`，否则站点从公开切成私密后，老访客冷加载会先渲染出缓存的公开内容、等 401 回来才切锁屏 |

**已知残留风险**：第 10 项只能覆盖"第一次 401 之后"。站点从公开切换为私密后的**第一次**冷加载仍可能有短暂闪现（缓存里存的是切换前合法的公开数据）。彻底消除需要服务端在响应头标记可见性、由 SW 决定是否命中缓存，属于独立议题，本次未处理。
