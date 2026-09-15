// ============================================================
// MonitorFlare — 告警发送编排
//
// 关键变化:消息不再是"渲染一次广播给所有人"。
// 每个渠道可能绑定不同的模板版本,所以这里是"按渠道取版本 → 各自渲染 → 各自发送"。
// 同一个 DOWN 事件,给运维的钉钉可以带排查命令,给管理层的邮件只写影响面。
// ============================================================
import type { AlertTemplatePayload, Bindings, Monitor, NotificationChannel } from '../types';
import { getSetting } from '../init';
import { buildAlertMessage, isSupportedLang, type Lang } from '../i18n';
import { formatTimeInTz } from '../utils';
import { sendToChannel } from '../channels';
import { MONITOR_COLUMNS } from '../sql';
import { applyRuleOverrides, getAlertRules, getDefaultTemplate, getTemplatePayloads } from './template-store';
import { renderBranding, renderDetail, type AlertSlot } from './template';

/** 一次探测能给告警提供的原始素材(模板变量从这里取值) */
export interface AlertContext {
    reason?: string | null;
    latency?: number | null;
    statusCode?: number | null;
}

/** 待分发的一条告警:取哪个槽位 + 用什么变量 + 没模板时的兜底文案 */
interface AlertDispatch {
    slot: AlertSlot;
    /** 决定标题与状态文案(延迟/错误率这类也按"故障"处理) */
    isDown: boolean;
    vars: Record<string, string | number | null | undefined>;
    fallback: string;
}

/**
 * 把一条告警分发到所有启用渠道。
 *
 * 版本解析规则:渠道绑定了版本就用绑定的,没绑定(或被删了)就用默认版本。
 * 渠道为空时退回环境变量里的钉钉,同样按默认版本渲染。
 */
export async function dispatchAlert(
    env: Bindings,
    monitor: { name: string; url: string },
    d: AlertDispatch,
    lang: Lang,
    tz: string,
): Promise<boolean> {
    const time = formatTimeInTz(new Date(), tz);
    const vars = { name: monitor.name, url: monitor.url, time, ...d.vars };

    const render = (payload: AlertTemplatePayload) => {
        const detail = renderDetail(payload, d.slot, d.fallback, vars);
        return buildAlertMessage(monitor, d.isDown ? 'DOWN' : 'UP', detail, time, lang, renderBranding(payload, d.isDown), vars);
    };

    let channels: NotificationChannel[] = [];
    try {
        const { results } = await env.DB.prepare('SELECT * FROM notification_channels WHERE enabled = 1').all<NotificationChannel>();
        channels = results || [];
    } catch (e) {
        console.error('Failed to read notification channels from DB:', e);
    }

    // 没有配置渠道:退回环境变量里的钉钉,语义与"渠道"一致(用默认版本)
    if (channels.length === 0) {
        if (env.DINGTALK_ACCESS_TOKEN && env.DINGTALK_SECRET) {
            const fallbackChannel: NotificationChannel = {
                id: 0, type: 'dingtalk', name: 'ENV DingTalk', enabled: 1,
                config: JSON.stringify({ access_token: env.DINGTALK_ACCESS_TOKEN, secret: env.DINGTALK_SECRET }),
                created_at: '', template_version_id: null,
            };
            return sendToChannel(fallbackChannel, render(await getDefaultTemplate(env)), env);
        }
        console.warn('No notification channels configured.');
        return false;
    }

    // 一次取回所有用到的版本,避免 N 个渠道查 N 次
    const ids = [...new Set(channels.map(c => Number(c.template_version_id) || 0).filter(id => id > 0))];
    const payloads = ids.length ? await getTemplatePayloads(env, ids) : new Map();
    const needDefault = channels.some(c => !(Number(c.template_version_id) > 0) || !payloads.has(Number(c.template_version_id)));
    const defaultPayload = needDefault ? await getDefaultTemplate(env) : null;

    const tasks = channels.map((ch) => {
        const id = Number(ch.template_version_id) || 0;
        const payload = (id > 0 ? payloads.get(id) : null) || defaultPayload;
        return sendToChannel(ch, render(payload!), env);
    });
    const outcomes = await Promise.allSettled(tasks);
    return outcomes.some(o => o.status === 'fulfilled' && o.value === true);
}

/**
 * 上下线告警(受 alert_silence_uptime 静默窗口约束)
 *
 * ctx 里传的是原始探测结果,最终文案由渠道绑定的模板版本决定。
 */
export async function sendUptimeAlert(
    env: Bindings,
    monitor: Monitor,
    type: 'DOWN' | 'UP',
    ctx: AlertContext,
    lang: Lang,
    tz: string,
) {
  const silenceH = monitor.alert_silence_uptime || 24;
  const lastAlert = monitor.last_alert_uptime ? new Date(monitor.last_alert_uptime).getTime() : 0;
  if (type === 'DOWN' && Date.now() - lastAlert < silenceH * 3_600_000) return;

  const isDown = type === 'DOWN';
  await dispatchAlert(env, monitor, {
    slot: isDown ? 'down' : 'up',
    isDown,
    vars: {
      status: type,
      reason: ctx.reason || '',
      latency: ctx.latency ?? '',
      status_code: ctx.statusCode ?? '',
    },
    fallback: ctx.reason || `Response time: ${ctx.latency ?? 0}ms`,
  }, lang, tz);

  await env.DB.prepare('UPDATE monitors SET last_alert_uptime = ? WHERE id = ?')
    .bind(new Date().toISOString(), monitor.id).run();
}

/** 错误率告警:窗口 / 最少采样数 / 静默时长取自站点设置,可被监控级覆盖 */
export async function checkErrorRate(env: Bindings, monitor: Monitor, lang: Lang, tz: string) {
  const rules = applyRuleOverrides(await getAlertRules(env), monitor);
  const { errorRateWindowMin: windowMin, errorRateMinSamples: minSamples, errorRateSilenceMin: silenceMin } = rules;

  const row = await env.DB.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN is_fail=1 THEN 1 ELSE 0 END) as fails
    FROM logs WHERE monitor_id = ? AND created_at >= datetime('now', ?)
  `).bind(monitor.id, `-${windowMin} minutes`).first<{ total: number; fails: number }>();
  const total = row?.total || 0;
  const fails = row?.fails || 0;
  if (total < minSamples || fails / total < monitor.alert_error_rate / 100) return;

  const lastAlert = monitor.last_alert_uptime ? new Date(monitor.last_alert_uptime).getTime() : 0;
  if (Date.now() - lastAlert <= silenceMin * 60_000) return;

  const rate = ((fails / total) * 100).toFixed(1);
  await dispatchAlert(env, monitor, {
    slot: 'error_rate',
    isDown: true,
    vars: {
      status: 'DOWN',
      error_rate: rate,
      error_rate_window: windowMin,
      threshold: monitor.alert_error_rate,
    },
    fallback: `Error rate ${rate}% in last ${windowMin} minutes (threshold ${monitor.alert_error_rate}%)`,
  }, lang, tz);

  await env.DB.prepare('UPDATE monitors SET last_alert_uptime = ? WHERE id = ?')
    .bind(new Date().toISOString(), monitor.id).run();
}

/**
 * 延迟阈值告警
 *
 * 只在探测成功时判定:失败时的耗时没有意义(可能是超时值)。
 * 静默锚点是独立的 last_alert_latency,不与可用性告警共用,避免互相压制。
 */
export async function checkLatencyAlert(env: Bindings, monitor: Monitor, latency: number, lang: Lang, tz: string) {
  const threshold = monitor.alert_latency_ms || 0;
  if (threshold <= 0 || latency <= threshold) return;

  const rules = applyRuleOverrides(await getAlertRules(env), monitor);
  const lastAlert = monitor.last_alert_latency ? new Date(monitor.last_alert_latency).getTime() : 0;
  if (Date.now() - lastAlert <= rules.latencySilenceMin * 60_000) return;

  await dispatchAlert(env, monitor, {
    slot: 'latency',
    isDown: true,
    vars: { status: 'SLOW', latency, threshold },
    fallback: `Latency ${latency}ms exceeded threshold ${threshold}ms`,
  }, lang, tz);

  await env.DB.prepare('UPDATE monitors SET last_alert_latency = ? WHERE id = ?')
    .bind(new Date().toISOString(), monitor.id).run();
}

/**
 * 证书 / 域名到期告警(每日本地 01:00 随结算任务跑一次)
 *
 * 注意 alert_silence_ssl / alert_silence_domain 这两个字段的历史语义就是
 * "提前 N 天提醒",不是"静默 N 小时" —— 名字是遗留的,这里按天使用。
 */
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
      const daysLeft = Math.floor((new Date(monitor.cert_expiry).getTime() - now) / dayMs);
      const lastAlert = monitor.last_alert_ssl ? new Date(monitor.last_alert_ssl).getTime() : 0;
      if (daysLeft <= (monitor.alert_silence_ssl || 24) && now - lastAlert > dayMs) {
        await sendExpiryAlert(env, monitor, 'ssl', 'cert_expiry', daysLeft, 'SSL certificate', lang, tz);
        await env.DB.prepare('UPDATE monitors SET last_alert_ssl = ? WHERE id = ?')
          .bind(new Date().toISOString(), monitor.id).run();
      }
    }
    // Domain
    if (monitor.check_domain && monitor.domain_expiry) {
      const daysLeft = Math.floor((new Date(monitor.domain_expiry).getTime() - now) / dayMs);
      const lastAlert = monitor.last_alert_domain ? new Date(monitor.last_alert_domain).getTime() : 0;
      if (daysLeft <= (monitor.alert_silence_domain || 24) && now - lastAlert > dayMs) {
        await sendExpiryAlert(env, monitor, 'domain', 'domain_expiry', daysLeft, 'Domain', lang, tz);
        await env.DB.prepare('UPDATE monitors SET last_alert_domain = ? WHERE id = ?')
          .bind(new Date().toISOString(), monitor.id).run();
      }
    }
  }
}

async function sendExpiryAlert(
    env: Bindings,
    monitor: Monitor,
    slot: AlertSlot,
    field: 'cert_expiry' | 'domain_expiry',
    daysLeft: number,
    fallbackSubject: string,
    lang: Lang,
    tz: string,
) {
  const expiry = monitor[field] || '';
  await dispatchAlert(env, monitor, {
    slot,
    isDown: true,
    vars: { status: 'DOWN', days: daysLeft, expiry },
    fallback: `${fallbackSubject} expires in ${daysLeft} days (${expiry})`,
  }, lang, tz);
}

/** 测试告警:用样例数据走一遍真实渲染,每个渠道按自己绑定的版本发一条 */
export async function sendTestAlert(env: Bindings, channels?: NotificationChannel[]): Promise<boolean> {
  const lang = isSupportedLang(await getSetting(env, 'language'));
  const tz = await getSetting(env, 'timezone') || 'Asia/Shanghai';
  const rules = await getAlertRules(env);
  if (channels) {
    // 单渠道测试:只发这一个,且必须用该渠道绑定的版本
    const payloads = await getTemplatePayloads(env, [Number(channels[0].template_version_id) || 0].filter(Boolean));
    const id = Number(channels[0].template_version_id) || 0;
    const payload = (id > 0 ? payloads.get(id) : null) || await getDefaultTemplate(env);
    const time = formatTimeInTz(new Date(), tz);
    const vars = {
      name: 'Test Monitor', url: 'https://example.com', status: 'DOWN',
      reason: 'Example reason: connection timeout', latency: 123, status_code: 500,
      error_rate: '12.5', error_rate_window: rules.errorRateWindowMin, threshold: 10,
      days: 7, expiry: '2026-12-31', time,
    };
    const detail = renderDetail(payload, 'down', 'This is a test message to verify your notification channels.', vars);
    const msg = buildAlertMessage({ name: 'Test Monitor', url: 'https://example.com' }, 'DOWN', detail, time, lang,
      renderBranding(payload, true), vars);
    return sendToChannel(channels[0], msg, env);
  }
  return dispatchAlert(env, { name: 'Test Monitor', url: 'https://example.com' }, {
    slot: 'down',
    isDown: true,
    vars: {
      status: 'DOWN',
      reason: 'Example reason: connection timeout', latency: 123, status_code: 500,
      error_rate: '12.5', error_rate_window: rules.errorRateWindowMin, threshold: 10,
      days: 7, expiry: '2026-12-31',
    },
    fallback: 'This is a test message to verify your notification channels.',
  }, lang, tz);
}
