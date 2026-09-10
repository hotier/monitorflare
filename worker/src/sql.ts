// ============================================================
// MonitorFlare — SQL 片段
// monitors 的列清单在多处复用(CRUD / v1 / 调度 / 到期检查),
// 集中一处避免各写一份导致漂移。
// ============================================================

export const MONITOR_COLUMNS = `
  id, name, url, type, config, method, request_headers, request_body, interval, status,
  retry_count, last_check, keyword, user_agent, tags, domain_expiry, cert_expiry,
  check_info_status, paused, check_ssl, check_domain, alert_silence_uptime,
  alert_silence_ssl, alert_silence_domain, alert_error_rate, alert_after_failures,
  last_alert_uptime, last_alert_ssl, last_alert_domain, sort_order, created_at
`;
