# D1 用量治理方案

> 目标：把 Cloudflare D1 的每日行数读写从"几分钟耗尽"降到"占免费额度个位数百分比"。
> 适用范围：`worker/`（Cloudflare Worker + D1），前端 `frontend/` 只做轮询频率配合。

---

## 1. 问题定性

**不是技术选型问题，是读写方式问题。** 同样的数据模型换成 Postgres / MySQL 也会出现慢查询与资源打满，只是症状不同。

三个真实错误：

1. **计算位置放错**：把 `O(历史数据总量)` 的聚合放在了 `O(请求次数)` 的热路径上（每次请求实时扫 30 天日志）。
2. **缓存层缺失**：读多写少、允许秒级延迟的公开数据，却没有任何 CDN / 内存 / ETag 缓存，前端 30 秒轮询直接穿透到数据库。
3. **索引与查询写法不匹配**：对索引列套函数 `date(created_at, tz)` 导致索引失效，全表扫描。

---

## 2. 基线（10 个监控 / interval=300s / 日志保留 90 天）

| 指标 | 优化前 |
|---|---|
| logs 表规模 | 25.9 万行 |
| `GET /monitors/public/details` 单次读 | ≈ 34.6 万行（30 天聚合 8.6 万 + `date()` 全表扫 25.9 万） |
| 状态页常开（30s 轮询） | ≈ 10 亿行/天 |
| 单次探测写 | 5 行（logs 1 行 + 3 个索引 + monitors 1 行） |
| 每日 R2 备份 | logs 全表 25.9 万行 |

---

## 3. 设计原则

```
┌─ L3 边缘缓存     公开接口 s-maxage，访客再多也只回源 1 次/30s
├─ L2 内存 TTL 缓存 Worker isolate 内合并并发轮询
├─ L1 查询口径      读路径只查聚合表 + 可命中索引的边界条件
└─ L0 写入侧        精简索引、合并写、增量维护聚合
```

核心：**把"读取时全量重算"改成"写入时增量维护"**，再用缓存把回源频率压到远低于轮询频率。

---

## 4. 具体改造

### 4.1 新增小时聚合表 `monitor_hourly`（写入侧增量）

```sql
CREATE TABLE IF NOT EXISTS monitor_hourly (
  monitor_id INTEGER NOT NULL,
  hour       TEXT NOT NULL,   -- 本地时区 'YYYY-MM-DDTHH'
  total      INTEGER NOT NULL DEFAULT 0,
  fails      INTEGER NOT NULL DEFAULT 0,
  latency_sum INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, hour)
);
```

- 每次探测随日志一起 upsert（同一小时内反复更新同一行）。
- 服务 24 小时滚动可用率、延迟曲线（7d/30d）、当日可用率。
- 保留 31 天，超出由每日任务清理。
- 首次上线从 logs 回填最近 31 天（一次性，由 `hourly_backfill_v1` 标志位保证只跑一次）。

不变式：
- `monitor_hourly` = 最近 31 天的小时桶（含今天，实时增量）
- `daily_uptime` = **只含已结束的自然日**（本地时区），由每日 01:00 任务从小时桶汇总
- `logs` = 原始点，只服务于"最近 N 条日志"与 24h 原始延迟曲线

### 4.2 写入路径合并与索引精简

`performMonitorCheck` 由 3 条独立 SQL 改为一次 `DB.batch`：

1. `INSERT INTO logs`
2. `UPDATE monitors SET last_check=?, status=?, retry_count=?, last_latency=?`
3. `UPSERT monitor_hourly`

同时删除两个冗余索引（每次 INSERT 少写 2 行）：

- `idx_logs_created`：仅被"今日统计"和清理用到，两者已改走索引友好写法
- `idx_logs_fail_created`：`is_fail` 选择性极低，5 分钟错误率查询已被 `(monitor_id, created_at)` 覆盖

| | 优化前 | 优化后 |
|---|---|---|
| 单次探测写行数 | 5 | 4（logs 1 + logs 索引 1 + monitors 1 + hourly 1）|

新增 `monitors.last_latency` 列：与 `last_check` 在同一条 UPDATE 里写入，**不增加写行数**，供列表页直接读延迟。

### 4.3 读路径改造

| 接口 | 优化前 | 优化后 |
|---|---|---|
| `/monitors/public/details` | 扫 30 天 logs + 全表扫 | monitors(N) + 小时桶(≤25N) + 日聚合(90N，内存缓存 10min) |
| `/monitors/public/:id` | 30 天 logs 聚合 + 全表扫 | monitor(1) + 小时桶(25) + 日聚合(90) + 日志 50 条 |
| `/api/status` | 30 天 logs 聚合 | monitors(N) + 小时桶(≤25N) |
| `/health` | `COUNT(*) FROM logs` 全索引扫 | `MAX(id)`（O(1)）+ `ORDER BY id DESC LIMIT 1` |
| `/monitors?include=stats` | 30 天 logs 聚合 | 日聚合 + 小时桶 |

关键写法改动：**所有 `date(created_at, 'tz')` 改为预先算好的边界常量比较**，确保命中 `idx_logs_monitor_created` / `PRIMARY KEY(monitor_id, hour|date)`。

### 4.4 缓存层

- **CDN / 浏览器**：公开只读接口加 `Cache-Control: public, max-age=10, s-maxage=30, stale-while-revalidate=60`。私密模式（`status_page_visibility=private`）自动降级为 `private, no-store`，不落任何共享缓存。
- **Worker 内存**（`worker/src/cache.ts`）：
  - 公开接口响应 TTL 30s
  - 90 天日聚合桶 TTL 10min（跨请求复用，避免每 30 秒重扫 900 行）
- **失效时机**：监控增删改 / 暂停恢复 / 排序、事件增删改、设置保存后统一 `invalidate('public')`。写路径主动失效，才能让 30s TTL 只承担"兜底"而不是"可见性上限"。

**settings 刻意不做缓存。** 它单次只读一行（主键命中），省不出额度，但 `status_page_visibility` 是访问控制开关 —— 一旦缓存，其它 isolate 上最多会有几十秒仍按旧值放行私密站点。省几行读不值得拿访问控制换。

### 4.5 其他

- `verifyApiKey` 的 `last_used_at` 更新改为 1 小时节流。
- 每日清理按 monitor 分批删除日志（走索引），避免全表扫。
- R2 备份移除 logs 全表 dump，改为备份 `monitor_hourly` + `daily_uptime`（体积缩小约 100 倍）。
- `/v1/logs` 与备份导出：无 `monitor_id` 过滤时改按 `id` 排序/计数，避免整表排序与整表 `COUNT(*)`。
- 删除监控时级联清理 `monitor_hourly` / `daily_uptime`，不留孤儿行。

> `/health` 里的日志量改用 `MAX(id)` 近似：精确 `COUNT(*)` 要扫完整张 logs，而这个接口每 60 秒就被打一次。语义上变成"累计探测次数"，不再随日志清理回落。

### 4.6 前端配合

- 状态页 / 详情页 / 管理页轮询 30s → 60s。
- `document.hidden` 时暂停轮询，重新可见立即刷新。
- 管理页把最重的 `publicMonitors` 降频到 120s（其余资源仍 60s）。

---

## 5. 预期收益（10 个监控）

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 公开详情单次读 | 346,000 行 | ≈ 1,200 行（日聚合桶命中内存缓存时 ≈ 300 行）|
| 全天读（状态页常开） | ≈ 10 亿行 | ≈ 80~150 万行 |
| 单次探测写 | 5 行 | 4 行 |
| 全天写 | ≈ 1.44 万行 | ≈ 1.6 万行（可支撑约 80+ 个监控）|

---

## 6. 验证方法

两种核对手段：

1. `wrangler d1 execute <DB> --remote --command "<SQL>"` 的返回 meta 里带 `rows_read` / `rows_written`。把改造前后的同一条查询各跑一次即可量化差异；**本地 miniflare 的 meta 不准，必须 `--remote`**。
2. Cloudflare 控制台 → D1 → 该库的 "Reads / Writes" 曲线：部署后看 24 小时总量是否回到免费额度的个位数百分比。

验收标准（10 个监控）：

- 打开状态页 5 分钟，D1 读行数增长 < 2 万行
- 每日 01:00 任务执行后 `daily_uptime` 覆盖到昨天
- `monitor_hourly` 当前小时桶随探测递增

---

## 7. 后续可选（本期未做）

- 90 天柱状图预计算落表（`monitor_summary`），可把公开详情再降到 ≈ 300 行/次
- 日志保留期可配置（默认 90 天 → 30 天），进一步压缩表规模
- `monitors.next_check_at` 列 + 索引，让每分钟调度只捞到期监控
