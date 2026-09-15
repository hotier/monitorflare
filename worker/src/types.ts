// ============================================================
// MonitorFlare — 类型定义
// ============================================================

export type MonitorType = 'http' | 'dns' | 'port';

export interface Monitor {
  id: number;
  name: string;
  url: string;
  type: MonitorType;
  config: string | null;
  method: string;
  request_headers: string | null;
  request_body: string | null;
  interval: number;
  status: 'UP' | 'DOWN' | 'RETRYING' | 'PAUSED';
  retry_count: number;
  last_check: string | null;
  /** 最近一次探测的响应耗时(ms)。随 last_check 一起写,列表/状态页直接读它 */
  last_latency: number | null;
  keyword: string | null;
  user_agent: string | null;
  tags: string | null;
  domain_expiry: string | null;
  cert_expiry: string | null;
  check_info_status: string | null;
  paused: number;
  check_ssl: number;
  check_domain: number;
  alert_silence_uptime: number;
  alert_silence_ssl: number;
  alert_silence_domain: number;
  alert_error_rate: number;
  alert_after_failures: number;
  /** 延迟阈值告警(ms),0 = 关闭 */
  alert_latency_ms: number;
  last_alert_uptime: string | null;
  last_alert_ssl: string | null;
  last_alert_domain: string | null;
  last_alert_latency: string | null;
  /**
   * 告警判定口径的监控级覆盖,与 settings 表里的同名键一一对应。
   * NULL = 跟随站点设置里的全局规则;填了值就只对这个监控生效。
   */
  alert_error_rate_window?: number | null;
  alert_error_rate_min_samples?: number | null;
  alert_error_rate_silence?: number | null;
  alert_latency_silence?: number | null;
  sort_order: number;
  created_at: string;
}

export interface Log {
  id: number;
  monitor_id: number;
  status_code: number;
  latency: number;
  is_fail: number;
  reason: string | null;
  created_at: string;
}

export type ChannelType =
  | 'dingtalk' | 'wecom' | 'feishu' | 'telegram'
  | 'webhook' | 'email' | 'slack' | 'discord' | 'ntfy';

export type EmailProvider = 'resend' | 'sendgrid' | 'mailgun' | 'postmark' | 'ses';

export interface NotificationChannel {
  id: number;
  type: ChannelType;
  name: string;
  enabled: number;
  config: string;
  created_at: string;
  /** 绑定的告警模板版本;NULL/0 = 跟随默认版本 */
  template_version_id?: number | null;
}

/**
 * 一个"模板版本"承载的完整文案集。
 *
 * 版本是整份一起管理的:改一条文案会落到所选版本上,渠道可以按版本挑选,
 * 于是同一个告警能对不同渠道发出不同措辞(例如给运维的钉钉带排查命令,
 * 给管理层的邮件只写影响面)。
 */
export interface AlertTemplatePayload {
  down: string;
  up: string;
  error_rate: string;
  ssl: string;
  domain: string;
  latency: string;
  title_down: string;
  title_up: string;
  footer: string;
}

export interface AlertTemplateVersion {
  id: number;
  name: string;
  note: string | null;
  is_default: number;
  /** AlertTemplatePayload 的 JSON 串 */
  payload: string;
  created_at: string;
  updated_at: string;
}

export interface Incident {
  id: number;
  title: string;
  description: string | null;
  severity: 'info' | 'warning' | 'critical';
  status: 'active' | 'resolved';
  type: 'incident' | 'maintenance';
  scheduled_start: string | null;
  scheduled_end: string | null;
  affected_monitors: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface Subscription {
  id: number;
  email: string;
  token: string;
  created_at: string;
}

export interface ApiKey {
  id: number;
  name: string;
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
}

export type Bindings = {
  DB: D1Database;
  R2?: R2Bucket;
  DINGTALK_ACCESS_TOKEN: string;
  DINGTALK_SECRET: string;
  ADMIN_PASSWORD?: string;
  ADMIN_API_KEY?: string;
  MAGIC_LINK_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  CF_ACCESS_AUD?: string;
  ALLOWED_ORIGIN?: string;
  SESSION_TTL_HOURS?: string;
  BASE_URL?: string;
};

// 检查结果
export interface CheckResult {
  ok: boolean;
  statusCode: number;   // HTTP 状态码;DNS/Port 用 0/1 语义
  latency: number;      // 毫秒
  reason: string;       // 失败原因(空串表示成功)
  detail?: string;      // 附加信息(如 DNS 记录值)
}
