// ============================================================
// MonitorFlare — 自动初始化
// Worker 首次访问时自动创建 D1 表结构 + 默认设置
// 使一键部署无需手动执行 schema.sql
// ============================================================
import type { Bindings } from './types';
import { DEFAULT_TZ, tzModifier } from './datetime';
import { defaultTemplatePayload, LEGACY_TEMPLATE_KEYS, LEGACY_TEMPLATE_MAP } from './services/template';

const INIT_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, url TEXT NOT NULL,
    type TEXT DEFAULT 'http', config TEXT,
    method TEXT DEFAULT 'GET',
    request_headers TEXT, request_body TEXT,
    interval INTEGER DEFAULT 300,
    status TEXT DEFAULT 'UP',
    retry_count INTEGER DEFAULT 0,
    last_check DATETIME, keyword TEXT, user_agent TEXT, tags TEXT,
    domain_expiry TEXT, cert_expiry TEXT, check_info_status TEXT,
    paused INTEGER DEFAULT 0,
    check_ssl INTEGER DEFAULT 1, check_domain INTEGER DEFAULT 1,
    alert_silence_uptime INTEGER DEFAULT 24,
    alert_silence_ssl INTEGER DEFAULT 24,
    alert_silence_domain INTEGER DEFAULT 24,
    alert_error_rate INTEGER DEFAULT 0,
    alert_after_failures INTEGER DEFAULT 1,
    alert_latency_ms INTEGER DEFAULT 0,
    last_alert_uptime TEXT, last_alert_ssl TEXT, last_alert_domain TEXT, last_alert_latency TEXT,
    -- 告警判定口径的监控级覆盖,NULL = 跟随 settings 里的全局规则
    alert_error_rate_window INTEGER, alert_error_rate_min_samples INTEGER,
    alert_error_rate_silence INTEGER, alert_latency_silence INTEGER,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER, status_code INTEGER, latency INTEGER,
    is_fail INTEGER DEFAULT 0, reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_logs_monitor_created ON logs(monitor_id, created_at DESC)`,
  // 注意:不要再给 logs 建全局索引。D1 按"读/写行数"计费,每个二级索引都会让
  // 每次探测的 INSERT 多写一行 —— 而这两个索引的查询场景已全部改走
  // (monitor_id, created_at) 与 monitor_hourly,见 docs/D1-OPTIMIZATION.md。
  `CREATE TABLE IF NOT EXISTS notification_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    config TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, description TEXT,
    severity TEXT DEFAULT 'info', status TEXT DEFAULT 'active',
    type TEXT DEFAULT 'incident',
    scheduled_start DATETIME, scheduled_end DATETIME,
    affected_monitors TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
  )`,
  // 告警模板版本。一条记录 = 一份完整文案集(6 类模板 + 标题 + 落款),
  // is_default=1 的那条是"默认版本",渠道未指定版本时用它。
  `CREATE TABLE IF NOT EXISTS alert_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    note TEXT,
    is_default INTEGER DEFAULT 0,
    payload TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  // 不建 is_default 索引:这张表通常只有个位数行,索引区分度接近 0,
  // 却会让每次保存模板多写一行(D1 按行数计费)。
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS daily_uptime (
    monitor_id INTEGER NOT NULL, date TEXT NOT NULL,
    total_checks INTEGER DEFAULT 0, successful_checks INTEGER DEFAULT 0,
    avg_latency INTEGER DEFAULT 0,
    PRIMARY KEY (monitor_id, date)
  )`,
  // 小时桶:探测时增量 upsert,服务"滚动 24h 可用率""今日可用率""延迟曲线"。
  // hour 是本地时区的 'YYYY-MM-DDTHH',字典序即时间序,可以直接做范围比较。
  `CREATE TABLE IF NOT EXISTS monitor_hourly (
    monitor_id INTEGER NOT NULL, hour TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0, fails INTEGER NOT NULL DEFAULT 0,
    latency_sum INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (monitor_id, hour)
  )`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE, token TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, key_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME
  )`,
  `CREATE INDEX IF NOT EXISTS idx_monitors_paused ON monitors(paused, id)`,
  `CREATE INDEX IF NOT EXISTS idx_incidents_active ON incidents(type, status, scheduled_start, scheduled_end)`,
];

/**
 * 默认设置。
 *
 * 注意:这张表同时是 `PUT /settings` 的写入白名单
 * —— 新增设置键必须登记在这里,否则前端的保存会被静默丢弃。
 */
export const DEFAULT_SETTINGS: Record<string, string> = {
  site_title: 'MonitorFlare',
  site_description: 'Realtime monitoring & status page',
  site_logo_url: '/logo.svg',
  language: 'zh',
  timezone: DEFAULT_TZ,
  theme: 'dark',
  status_page_feed: '1',
  status_page_visibility: 'public',
  status_page_password: '',
  // 告警文案(模板 / 标题 / 落款)不在这里 —— 它们在 alert_templates 表里按版本管理,
  // 并可按渠道绑定。这里只留与文案无关的判定口径。
  // 错误率告警口径:统计窗口(分钟)、窗口内最少采样数、告警静默(分钟)
  alert_error_rate_window: '5',
  alert_error_rate_min_samples: '5',
  alert_error_rate_silence: '60',
  // 延迟告警静默(分钟)
  alert_latency_silence: '60',
};

let initPromise: Promise<boolean> | null = null;

export async function ensureInitialized(env: Bindings): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        // 逐条补建缺失的表/索引(已存在则跳过)
        await ensureTables(env);
        // 确保默认设置存在(幂等)
        const stmt = env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
        await env.DB.batch(Object.entries(DEFAULT_SETTINGS).map(([k, v]) => stmt.bind(k, v)));
        // 兼容旧库:补列
        await ensureColumn(env, 'monitors', 'type', "TEXT DEFAULT 'http'");
        await ensureColumn(env, 'monitors', 'config', 'TEXT');
        await ensureColumn(env, 'monitors', 'alert_after_failures', 'INTEGER DEFAULT 1');
        await ensureColumn(env, 'monitors', 'cert_expiry', 'TEXT');
        await ensureColumn(env, 'monitors', 'domain_expiry', 'TEXT');
        await ensureColumn(env, 'monitors', 'check_info_status', 'TEXT');
        // 最近一次探测的延迟。和 last_check 写在同一条 UPDATE 里,不额外增加写行数,
        // 但能让列表/状态页不必为了拿一个延迟值去翻 logs。
        await ensureColumn(env, 'monitors', 'last_latency', 'INTEGER');
        // 延迟阈值告警:0 = 关闭;last_alert_latency 是它的静默锚点
        await ensureColumn(env, 'monitors', 'alert_latency_ms', 'INTEGER DEFAULT 0');
        await ensureColumn(env, 'monitors', 'last_alert_latency', 'TEXT');
        // 告警判定口径的监控级覆盖:NULL = 跟随站点设置,填了只对该监控生效
        await ensureColumn(env, 'monitors', 'alert_error_rate_window', 'INTEGER');
        await ensureColumn(env, 'monitors', 'alert_error_rate_min_samples', 'INTEGER');
        await ensureColumn(env, 'monitors', 'alert_error_rate_silence', 'INTEGER');
        await ensureColumn(env, 'monitors', 'alert_latency_silence', 'INTEGER');
        // 渠道绑定告警模板版本:NULL = 跟随默认版本
        await ensureColumn(env, 'notification_channels', 'template_version_id', 'INTEGER');
        // 一次性迁移:告警文案从 settings 搬到"模板版本"。
        // 老库里已经配好的 alert_template_* 会被搬进默认版本,不会丢。
        if ((await getSetting(env, 'alert_templates_v1')) !== '1') {
          const cnt = await env.DB.prepare('SELECT COUNT(*) as c FROM alert_templates').first<{ c: number }>();
          if (!cnt || Number(cnt.c) === 0) {
            const legacy = await getSettings(env, LEGACY_TEMPLATE_KEYS);
            // 内置文案跟站点语言走:中文站默认给中文模板,免得新装第一眼是英文
            const lang = await getSetting(env, 'language');
            const isZh = String(lang || '').toLowerCase().startsWith('zh');
            const payload = defaultTemplatePayload(lang);
            for (const [k, v] of Object.entries(LEGACY_TEMPLATE_MAP)) {
              const raw = (legacy[k] || '').trim();
              if (raw) payload[v] = raw;
            }
            await env.DB.prepare(
              'INSERT INTO alert_templates (name, note, is_default, payload) VALUES (?, ?, 1, ?)'
            ).bind(
              isZh ? '默认版本' : 'Default',
              isZh ? '从站点设置迁移' : 'Migrated from site settings',
              JSON.stringify(payload),
            ).run();
          }
          await setSetting(env, 'alert_templates_v1', '1');
        }
        // 一次性迁移:移除 logs 上两个全局索引。它们只服务"今日统计"和定期清理,
        // 这两个场景已改走 (monitor_id, created_at) 与小时桶;留着就是每次探测白写两行。
        if ((await getSetting(env, 'logs_index_v1')) !== '1') {
          await env.DB.prepare('DROP INDEX IF EXISTS idx_logs_created').run();
          await env.DB.prepare('DROP INDEX IF EXISTS idx_logs_fail_created').run();
          await setSetting(env, 'logs_index_v1', '1');
        }
        // 一次性迁移:小时桶上线前的数据要从 logs 回填,否则可用率窗口会空着,
        // 一直要等新探测数据攒够 24 小时才好看。
        if ((await getSetting(env, 'hourly_backfill_v1')) !== '1') {
          const tzMod = tzModifier(await getTimezone(env));
          await env.DB.prepare(`
            INSERT OR IGNORE INTO monitor_hourly (monitor_id, hour, total, fails, latency_sum)
            SELECT monitor_id, strftime('%Y-%m-%dT%H', created_at, ?), COUNT(*),
                   SUM(CASE WHEN is_fail = 1 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN is_fail = 0 THEN latency ELSE 0 END)
            FROM logs
            WHERE created_at >= datetime('now','-31 days')
            GROUP BY monitor_id, strftime('%Y-%m-%dT%H', created_at, ?)
          `).bind(tzMod, tzMod).run();
          await setSetting(env, 'hourly_backfill_v1', '1');
        }
        // 一次性迁移:每日聚合口径由 UTC 改为"设置时区"后,旧的分桶键不再对得上
        // (例如上海 11 号凌晨的检查曾被记成 10 号)。daily_uptime 是可由 logs 重建的
        // 派生缓存,直接清空,交给公开接口的兜底回填按新口径重新生成。
        if ((await getSetting(env, 'daily_uptime_tz_v1')) !== '1') {
          await env.DB.prepare('DELETE FROM daily_uptime').run();
          await setSetting(env, 'daily_uptime_tz_v1', '1');
        }
        // 一次性迁移:日聚合现在只由"已结束的自然日"组成(当天数据走小时桶),
        // 而它每晚才结算一次。新装/清空后不能干等到 01:00 才有历史柱状图,
        // 所以这里先从小时桶回填一次 —— 读的是聚合表,比直接扫 logs 便宜两个数量级。
        if ((await getSetting(env, 'daily_uptime_init_v1')) !== '1') {
          const cnt = await env.DB.prepare('SELECT COUNT(*) as c FROM daily_uptime').first<{ c: number }>();
          if (!cnt || Number(cnt.c) === 0) {
            await env.DB.prepare(`
              INSERT OR IGNORE INTO daily_uptime (monitor_id, date, total_checks, successful_checks, avg_latency)
              SELECT monitor_id, substr(hour, 1, 10), SUM(total), SUM(total - fails),
                     COALESCE(CAST(AVG(CASE WHEN total > fails THEN latency_sum / (total - fails) END) AS INTEGER), 0)
              FROM monitor_hourly GROUP BY monitor_id, substr(hour, 1, 10)
            `).run();
          }
          await setSetting(env, 'daily_uptime_init_v1', '1');
        }
        return true;
      } catch (e) {
        console.error('Init failed:', e);
        initPromise = null; // 允许重试
        return false;
      }
    })();
  }
  return initPromise;
}

/**
 * 建表:每张表/索引单独确认存在性,缺哪个补哪个。
 *
 * 不能只探测 settings —— 在 monitor_hourly / daily_uptime 上线之前建的库里
 * settings 已存在,整段 INIT_STATEMENTS 会被跳过,新表永远补不上,读侧随即报
 * "no such table"。全新库这里 existing 为空,行为等价于跑一遍 schema.sql。
 */
async function ensureTables(env: Bindings): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table','index')"
  ).all<{ name: string }>();
  const existing = new Set((results || []).map((r) => r.name));
  for (const sql of INIT_STATEMENTS) {
    const m = /^CREATE\s+(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\s+["'`]?(\w+)/i.exec(sql);
    if (m && existing.has(m[1])) continue;
    await env.DB.prepare(sql).run();
  }
}

async function ensureColumn(env: Bindings, table: string, column: string, ddl: string): Promise<void> {
  try {
    const cols = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    if (!cols.results.some(c => c.name === column)) {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`).run();
    }
  } catch (e) {
    console.error(`ensureColumn ${table}.${column} failed:`, e);
  }
}

// ── settings 读写 ──
//
// 这里刻意不做内存缓存:settings 单次读取只有一行(主键命中),省不出什么额度,
// 但 `status_page_visibility` 是安全开关 —— 一旦缓存,在其它 isolate 上最多会有
// 几十秒仍然按旧值放行私密站点。省几行读不值得拿访问控制换。

/** 写设置(不存在则插入,存在则覆盖) */
export async function setSetting(env: Bindings, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, value).run();
}

export async function getSetting(env: Bindings, key: string): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? '';
}

/** 取设置里的时区(缺失/非法时回退默认值),全站"按天"口径以它为准 */
export async function getTimezone(env: Bindings): Promise<string> {
  return (await getSetting(env, 'timezone')) || DEFAULT_TZ;
}

/**
 * 批量取若干设置键。告警链路一次要读十来个键,
 * 逐个 getSetting 会打十几次 D1 —— 这里合成一条 IN 查询。
 */
export async function getSettings(env: Bindings, keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const placeholders = keys.map(() => '?').join(',');
  const { results } = await env.DB
    .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();
  const map: Record<string, string> = {};
  for (const r of results || []) map[r.key] = r.value;
  return map;
}

export async function getSettingsMap(env: Bindings): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const map: Record<string, string> = {};
  for (const r of results || []) map[r.key] = r.value;
  return map;
}
