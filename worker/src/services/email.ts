// ============================================================
// MonitorFlare — 邮件工具(登录链接 / 订阅通知共用)
// 原 index.ts 1438-1449、1454-1469 行,纯搬迁。
// ============================================================
import type { Bindings, NotificationChannel, Subscription } from '../types';
import { getSetting } from '../init';
import { buildAlertMessage } from '../i18n';
import { sendToChannel } from '../channels';
import { escapeXml } from '../utils/http';

/** 取第一个启用的 email 渠道作为发信配置 */
export async function getEmailConfigForLogin(env: Bindings): Promise<{ channel: NotificationChannel } | null> {
  const { results } = await env.DB.prepare("SELECT * FROM notification_channels WHERE type = 'email' AND enabled = 1 ORDER BY created_at DESC LIMIT 1").all<NotificationChannel>();
  if (!results || results.length === 0) return null;
  return { channel: results[0] };
}

export async function sendLoginEmail(env: Bindings, cfg: { channel: NotificationChannel }, to: string, subject: string, html: string): Promise<boolean> {
  const msg = buildAlertMessage({ name: '', url: '' }, 'UP', '', new Date().toISOString(), 'en');
  const channel = cfg.channel;
  const config = (() => { try { return JSON.parse(channel.config) as Record<string, string>; } catch { return {}; } })();
  // 构造一个自定义消息来复用 sendToChannel
  const customMsg = { ...msg, title: subject, detail: html, statusText: '', monitorName: '', monitorUrl: '' };
  const cfgWithTo = { ...config, to_email: to };
  const fakeChannel: NotificationChannel = { ...channel, config: JSON.stringify(cfgWithTo) };
  return sendToChannel(fakeChannel, customMsg, env);
}

/** 事件创建后通知所有订阅者 */
export async function notifySubscribers(env: Bindings, title: string, description: string, _source: string) {
  try {
    const { results } = await env.DB.prepare('SELECT email FROM subscriptions').all<Subscription>();
    if (!results || results.length === 0) return;
    const emailCfg = await getEmailConfigForLogin(env);
    if (!emailCfg) return;
    const html = `<p><strong>${escapeXml(title)}</strong></p><p>${escapeXml(description)}</p>`;
    for (const sub of results) {
      await sendLoginEmail(env, emailCfg, sub.email, `[${(await getSetting(env, 'site_title')) || 'MonitorFlare'}] ${title}`, html).catch(console.error);
    }
  } catch (e) { console.error('notifySubscribers failed:', e); }
}
