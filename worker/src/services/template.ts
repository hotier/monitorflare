// ============================================================
// MonitorFlare — 告警模板:纯渲染层
//
// 这一层不碰 D1 / 不读设置,只负责"模板 + 变量 → 文案",方便单独测试。
// 版本存取在 template-store.ts,告警编排在 alert.ts。
//
// 渲染取舍:
//   1. 模板为空 / 渲染结果为空 → 回落到调用方给的 fallback(保持旧行为),
//      免得用户清空模板后收到一条空消息;
//   2. 已知变量但值为空 → 替换成空串(不留下 {latency} 这种占位符);
//   3. 未知变量 → 原样保留,方便用户发现拼错的变量名。
// ============================================================

/** 模板里可用的变量。前端"可用变量"列表与此保持一致 */
export const ALERT_VARIABLES = [
    '{name}', '{url}', '{status}', '{reason}', '{latency}', '{status_code}',
    '{error_rate}', '{error_rate_window}', '{threshold}', '{days}', '{expiry}', '{time}',
];

import type { AlertTemplatePayload } from '../types';

export type { AlertTemplatePayload };

/** 每种告警取哪个槽位(title_* / footer 单独走 renderBranding) */
export type AlertSlot = 'down' | 'up' | 'error_rate' | 'ssl' | 'domain' | 'latency';

/**
 * 内置文案(英文)。它同时也是 payload 的"结构兜底":
 * parseTemplatePayload 遇到缺失字段时按这份补齐,保证渲染时不会拿到 undefined。
 */
export const DEFAULT_TEMPLATE_PAYLOAD: AlertTemplatePayload = {
    down: 'Error: {reason}',
    up: 'Response time: {latency}ms',
    error_rate: 'Error rate {error_rate}% in last {error_rate_window} minutes (threshold {threshold}%)',
    ssl: 'SSL certificate for {name} expires in {days} days ({expiry})',
    domain: 'Domain {name} expires in {days} days ({expiry})',
    latency: 'Latency {latency}ms exceeded threshold {threshold}ms',
    title_down: '',
    title_up: '',
    footer: '',
};

/** 内置文案(中文)。站点默认语言是 zh,默认版本就该直接给出中文 */
export const DEFAULT_TEMPLATE_PAYLOAD_ZH: AlertTemplatePayload = {
    down: '故障原因:{reason}',
    up: '服务已恢复,响应时间 {latency}ms',
    error_rate: '最近 {error_rate_window} 分钟错误率 {error_rate}%,已超过阈值 {threshold}%',
    ssl: '{name} 的 SSL 证书将在 {days} 天后过期({expiry})',
    domain: '域名 {name} 将在 {days} 天后过期({expiry})',
    latency: '延迟 {latency}ms,已超过阈值 {threshold}ms',
    title_down: '服务故障报警',
    title_up: '服务恢复通知',
    footer: 'MonitorFlare',
};

/** 按站点语言挑一份内置文案:新装默认是中文站,不该丢一份英文模板过去 */
export function defaultTemplatePayload(lang: string | null | undefined): AlertTemplatePayload {
    return String(lang || '').toLowerCase().startsWith('zh')
        ? { ...DEFAULT_TEMPLATE_PAYLOAD_ZH }
        : { ...DEFAULT_TEMPLATE_PAYLOAD };
}

/**
 * 旧版把文案存在 settings 表里(alert_template_* / alert_title_* / alert_footer)。
 * 迁移时按这张表搬进默认版本;之后这些键不再被读取,只是留着兼容。
 */
export const LEGACY_TEMPLATE_MAP: Record<string, keyof AlertTemplatePayload> = {
    alert_template_down: 'down',
    alert_template_up: 'up',
    alert_template_error_rate: 'error_rate',
    alert_template_ssl: 'ssl',
    alert_template_domain: 'domain',
    alert_template_latency: 'latency',
    alert_title_down: 'title_down',
    alert_title_up: 'title_up',
    alert_footer: 'footer',
};

export const LEGACY_TEMPLATE_KEYS = Object.keys(LEGACY_TEMPLATE_MAP);

/** 把 D1 里的 payload 文本安全解析成完整结构(缺字段补默认,坏数据不至于让告警发不出去) */
export function parseTemplatePayload(raw: string | null | undefined): AlertTemplatePayload {
    let parsed: Partial<AlertTemplatePayload> = {};
    if (raw) {
        try { parsed = JSON.parse(raw) as Partial<AlertTemplatePayload>; } catch { parsed = {}; }
    }
    const out = { ...DEFAULT_TEMPLATE_PAYLOAD };
    for (const key of Object.keys(DEFAULT_TEMPLATE_PAYLOAD) as (keyof AlertTemplatePayload)[]) {
        const v = parsed[key];
        if (typeof v === 'string') out[key] = v;
    }
    return out;
}

/** 变量替换:{name} → vars.name。允许花括号内带空格 */
export function renderTemplate(
    template: string,
    vars: Record<string, string | number | null | undefined>,
): string {
    return template.replace(/\{\s*([a-z_][a-z0-9_]*)\s*\}/gi, (whole, key: string) => {
        if (!(key in vars)) return whole;
        const v = vars[key];
        return v === null || v === undefined ? '' : String(v);
    });
}

/** 取某个槽位的详情文案;模板缺失或渲染为空时回落到 fallback */
export function renderDetail(
    payload: AlertTemplatePayload,
    slot: AlertSlot,
    fallback: string,
    vars: Record<string, string | number | null | undefined>,
): string {
    const tpl = (payload[slot] || '').trim();
    if (!tpl) return fallback;
    const rendered = renderTemplate(tpl, vars).trim();
    return rendered || fallback;
}

/** 标题/落款:留空则由调用方用内置多语言文案 */
export function renderBranding(payload: AlertTemplatePayload, isDown: boolean) {
    return {
        title: (isDown ? payload.title_down : payload.title_up).trim(),
        footer: payload.footer.trim(),
    };
}
