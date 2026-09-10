// ============================================================
// MonitorFlare — 告警发送编排
// 原 index.ts 1301-1391 行,纯搬迁。
// ============================================================
import type { Bindings, Monitor, NotificationChannel } from '../types';
import { getSetting } from '../init';
import { buildAlertMessage, isSupportedLang, type Lang } from '../i18n';
import { formatTimeInTz } from '../utils';
import { sendToChannel } from '../channels';
import { MONITOR_COLUMNS } from '../sql';

/** 广播到所有启用的渠道;没有渠道时回退到环境变量里的钉钉 */
export async function sendAlertToAllChannels(env: Bindings, msg: ReturnType<typeof buildAlertMessage>): Promise<boolean> {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM notification_channels WHERE enabled = 1').all<NotificationChannel>();
    if (results && results.length > 0) {
      const tasks = results.map(ch => sendToChannel(ch, msg, env));
      const outcomes = await Promise.allSettled(tasks);
      return outcomes.some(o => o.status === 'fulfilled' && o.value === true);
    }
  } catch (e) { console.error('Failed to read notification channels from DB:', e); }

  if (env.DINGTALK_ACCESS_TOKEN && env.DINGTALK_SECRET) {
    const fallbackChannel: NotificationChannel = {
      id: 0, type: 'dingtalk', name: 'ENV DingTalk', enabled: 1,
      config: JSON.stringify({ access_token: env.DINGTALK_ACCESS_TOKEN, secret: env.DINGTALK_SECRET }),
      created_at: '',
    };
    return sendToChannel(fallbackChannel, msg, env);
  }
  console.warn('No notification channels configured.');
  return false;
}

/** 上下线告警(受 alert_silence_uptime 静默窗口约束) */
export async function sendUptimeAlert(env: Bindings, monitor: Monitor, type: 'DOWN' | 'UP', detail: string, lang: Lang, tz: string) {
  const silenceH = monitor.alert_silence_uptime || 24;
  const lastAlert = monitor.last_alert_uptime ? new Date(monitor.last_alert_uptime).getTime() : 0;
  if (type === 'DOWN' && Date.now() - lastAlert < silenceH * 3_600_000) return;
  const msg = buildAlertMessage({ name: monitor.name, url: monitor.url }, type, detail, formatTimeInTz(new Date(), tz), lang);
  await sendAlertToAllChannels(env, msg);
  await env.DB.prepare('UPDATE monitors SET last_alert_uptime = ? WHERE id = ?')
    .bind(new Date().toISOString(), monitor.id).run();
}

/** 错误率告警(过去 5 分钟) */
export async function checkErrorRate(env: Bindings, monitor: Monitor, lang: Lang, tz: string) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN is_fail=1 THEN 1 ELSE 0 END) as fails
    FROM logs WHERE monitor_id = ? AND created_at >= datetime('now','-5 minutes')
  `).bind(monitor.id).first<{ total: number; fails: number }>();
  const total = row?.total || 0;
  const fails = row?.fails || 0;
  if (total >= 5 && fails / total >= monitor.alert_error_rate / 100) {
    const lastAlert = monitor.last_alert_uptime ? new Date(monitor.last_alert_uptime).getTime() : 0;
    if (Date.now() - lastAlert > 3600_000) { // 错误率告警 1 小时静默
      const detail = `Error rate ${((fails / total) * 100).toFixed(1)}% in last 5 minutes (threshold ${monitor.alert_error_rate}%)`;
      const msg = buildAlertMessage({ name: monitor.name, url: monitor.url }, 'DOWN', detail, formatTimeInTz(new Date(), tz), lang);
      await sendAlertToAllChannels(env, msg);
      await env.DB.prepare('UPDATE monitors SET last_alert_uptime = ? WHERE id = ?')
        .bind(new Date().toISOString(), monitor.id).run();
    }
  }
}

/** 证书 / 域名到期告警(每 2 小时) */
export async function checkExpiryAlerts(env: Bindings) {
  const lang = isSupportedLang(await getSetting(env, 'language'));
  const tz = await getSetting(env, 'timezone') || 'Asia/Shanghai';
  const { results } = await env.DB.prepare(`
    SELECT ${MONITOR_COLUMNS} FROM monitors WHERE paused = 0 AND type = 'http' AND (check_ssl = 1 OR check_domain = 1)
  `).all<Monitor>();
  for (const monitor of results || []) {
    const now = Date.now();
    const dayMs = 86_400_000;
    // SSL
    if (monitor.check_ssl && monitor.cert_expiry) {
      const exp = new Date(monitor.cert_expiry).getTime();
      const daysLeft = Math.floor((exp - now) / dayMs);
      const lastAlert = monitor.last_alert_ssl ? new Date(monitor.last_alert_ssl).getTime() : 0;
      if (daysLeft <= (monitor.alert_silence_ssl || 24) && now - lastAlert > dayMs) {
        const msg = buildAlertMessage({ name: monitor.name, url: monitor.url }, 'DOWN',
          `SSL certificate expires in ${daysLeft} days (${monitor.cert_expiry})`, formatTimeInTz(new Date(), tz), lang);
        await sendAlertToAllChannels(env, msg);
        await env.DB.prepare('UPDATE monitors SET last_alert_ssl = ? WHERE id = ?')
          .bind(new Date().toISOString(), monitor.id).run();
      }
    }
    // Domain
    if (monitor.check_domain && monitor.domain_expiry) {
      const exp = new Date(monitor.domain_expiry).getTime();
      const daysLeft = Math.floor((exp - now) / dayMs);
      const lastAlert = monitor.last_alert_domain ? new Date(monitor.last_alert_domain).getTime() : 0;
      if (daysLeft <= (monitor.alert_silence_domain || 24) && now - lastAlert > dayMs) {
        const msg = buildAlertMessage({ name: monitor.name, url: monitor.url }, 'DOWN',
          `Domain expires in ${daysLeft} days (${monitor.domain_expiry})`, formatTimeInTz(new Date(), tz), lang);
        await sendAlertToAllChannels(env, msg);
        await env.DB.prepare('UPDATE monitors SET last_alert_domain = ? WHERE id = ?')
          .bind(new Date().toISOString(), monitor.id).run();
      }
    }
  }
}
