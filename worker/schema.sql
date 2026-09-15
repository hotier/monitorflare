-- ============================================================
-- MonitorFlare Schema
-- 全新数据库使用此完整 SQL;已有数据库请使用文件末尾的迁移语句
-- ============================================================

CREATE TABLE IF NOT EXISTS monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT DEFAULT 'http',              -- http / dns / port
  config TEXT,                           -- 类型专属 JSON 配置
  method TEXT DEFAULT 'GET',
  request_headers TEXT,                  -- JSON 格式自定义请求头
  request_body TEXT,                     -- POST 请求体
  interval INTEGER DEFAULT 300,
  status TEXT DEFAULT 'UP',              -- UP / DOWN / RETRYING / PAUSED
  retry_count INTEGER DEFAULT 0,
  last_check DATETIME,
  last_latency INTEGER,                  -- 最近一次探测耗时(ms),随 last_check 一起写
  keyword TEXT,
  user_agent TEXT,
  tags TEXT,                             -- 逗号分隔标签
  domain_expiry TEXT,
  cert_expiry TEXT,
  check_info_status TEXT,
  paused INTEGER DEFAULT 0,
  check_ssl INTEGER DEFAULT 1,
  check_domain INTEGER DEFAULT 1,
  alert_silence_uptime INTEGER DEFAULT 24,-- 可用性告警静默(小时)
  alert_silence_ssl INTEGER DEFAULT 24,   -- 证书到期提前告警(天,字段名是历史遗留)
  alert_silence_domain INTEGER DEFAULT 24,-- 域名到期提前告警(天,同上)
  alert_error_rate INTEGER DEFAULT 0,    -- 错误率阈值告警(百分比,0=关闭)
  alert_after_failures INTEGER DEFAULT 1,-- 连续失败 N 次才告警
  alert_latency_ms INTEGER DEFAULT 0,    -- 延迟阈值告警(ms,0=关闭)
  last_alert_uptime TEXT,
  last_alert_ssl TEXT,
  last_alert_domain TEXT,
  last_alert_latency TEXT,               -- 延迟告警的静默锚点
  -- 告警判定口径的监控级覆盖,NULL = 跟随站点设置里的全局规则(见 settings 表同名键)
  alert_error_rate_window INTEGER,
  alert_error_rate_min_samples INTEGER,
  alert_error_rate_silence INTEGER,
  alert_latency_silence INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER,
  status_code INTEGER,
  latency INTEGER,
  is_fail INTEGER DEFAULT 0,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- logs 上只保留这一个索引。D1 按行数计费,每多一个二级索引,每次探测的 INSERT
-- 就多写一行;而按时间做全局扫描的场景已全部改走 monitor_hourly / daily_uptime。
CREATE INDEX IF NOT EXISTS idx_logs_monitor_created ON logs(monitor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                    -- dingtalk / wecom / feishu / telegram / webhook / email / slack / discord / ntfy
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  config TEXT NOT NULL DEFAULT '{}',     -- JSON 配置
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT DEFAULT 'info',          -- info / warning / critical
  status TEXT DEFAULT 'active',          -- active / resolved
  type TEXT DEFAULT 'incident',          -- incident / maintenance
  scheduled_start DATETIME,
  scheduled_end DATETIME,
  affected_monitors TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 已结束自然日(按设置时区)的聚合。当天的数据不进这张表,由 monitor_hourly 实时提供
CREATE TABLE IF NOT EXISTS daily_uptime (
  monitor_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  total_checks INTEGER DEFAULT 0,
  successful_checks INTEGER DEFAULT 0,
  avg_latency INTEGER DEFAULT 0,
  PRIMARY KEY (monitor_id, date)
);

-- 小时桶:探测时增量 upsert,服务滚动 24h 可用率 / 今日可用率 / 延迟曲线。
-- hour 是本地时区的 'YYYY-MM-DDTHH',字典序即时间序,可直接做范围比较。
CREATE TABLE IF NOT EXISTS monitor_hourly (
  monitor_id INTEGER NOT NULL,
  hour TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  fails INTEGER NOT NULL DEFAULT 0,
  latency_sum INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, hour)
);

-- 告警模板版本:一条记录 = 一整套告警文案(6 类模板 + 标题 + 落款)。
-- 渠道可绑定不同版本,于是同一条告警能给不同渠道发出不同措辞。
-- is_default=1 的那条是默认版本;首次启动时若表为空,会自动从旧的
-- settings.alert_template_* 迁移出一份(见 init.ts)。
CREATE TABLE IF NOT EXISTS alert_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT,
  is_default INTEGER DEFAULT 0,
  payload TEXT NOT NULL,                 -- JSON:AlertTemplatePayload
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 订阅者(状态页邮件订阅)
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,                   -- 退订 token
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 第三方 API 密钥
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_monitors_paused ON monitors(paused, id);
CREATE INDEX IF NOT EXISTS idx_incidents_active ON incidents(type, status, scheduled_start, scheduled_end);

-- 预置默认配置
INSERT OR IGNORE INTO settings (key, value) VALUES ('site_title', 'MonitorFlare');
INSERT OR IGNORE INTO settings (key, value) VALUES ('site_description', 'Realtime monitoring & status page');
INSERT OR IGNORE INTO settings (key, value) VALUES ('site_logo_url', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('language', 'en');
INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', 'Asia/Shanghai');
INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'dark');
INSERT OR IGNORE INTO settings (key, value) VALUES ('status_page_feed', '1');
-- 告警文案(模板/标题/落款)不在 settings 里:见 alert_templates 表(版本化管理)
INSERT OR IGNORE INTO settings (key, value) VALUES ('alert_error_rate_window', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('alert_error_rate_min_samples', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('alert_error_rate_silence', '60');
INSERT OR IGNORE INTO settings (key, value) VALUES ('alert_latency_silence', '60');

-- ============================================================
-- 迁移语句(已有 uptime-monitor 数据库升级)
-- ============================================================
-- ALTER TABLE monitors ADD COLUMN type TEXT DEFAULT 'http';
-- ALTER TABLE monitors ADD COLUMN config TEXT;
-- ALTER TABLE monitors ADD COLUMN alert_after_failures INTEGER DEFAULT 1;
-- ALTER TABLE monitors ADD COLUMN alert_error_rate_window INTEGER;
-- ALTER TABLE monitors ADD COLUMN alert_error_rate_min_samples INTEGER;
-- ALTER TABLE monitors ADD COLUMN alert_error_rate_silence INTEGER;
-- ALTER TABLE monitors ADD COLUMN alert_latency_silence INTEGER;
-- CREATE TABLE IF NOT EXISTS subscriptions (...);
-- CREATE TABLE IF NOT EXISTS api_keys (...);
-- INSERT OR IGNORE INTO settings (key, value) VALUES ('language', 'en');
-- INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', 'UTC');
