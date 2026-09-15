// ============================================================
// MonitorFlare — 告警模板版本:存取层
//
// 一条记录 = 一份完整文案集。渠道可以绑定不同版本,于是同一条告警
// 能给不同渠道渲染出不同措辞。渲染逻辑本身在 template.ts,这里只管读写。
// ============================================================
import type { Bindings, Monitor, AlertTemplatePayload, AlertTemplateVersion } from '../types';
import { getSettings } from '../init';
import { DEFAULT_TEMPLATE_PAYLOAD, parseTemplatePayload } from './template';

/** 告警判定口径仍然放在站点设置里(它们不是文案,是所有版本共享的规则),监控级只做覆盖 */
const RULE_KEYS = [
    'alert_error_rate_window', 'alert_error_rate_min_samples',
    'alert_error_rate_silence', 'alert_latency_silence',
];

export interface AlertRules {
    /** 错误率统计窗口(分钟) */
    errorRateWindowMin: number;
    /** 窗口内最少采样数,样本不够不下结论 */
    errorRateMinSamples: number;
    /** 错误率告警静默(分钟) */
    errorRateSilenceMin: number;
    /** 延迟告警静默(分钟) */
    latencySilenceMin: number;
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(Math.round(n), max);
}

export async function getAlertRules(env: Bindings): Promise<AlertRules> {
    const map = await getSettings(env, RULE_KEYS);
    return {
        errorRateWindowMin: positiveInt(map.alert_error_rate_window, 5, 1440),
        errorRateMinSamples: positiveInt(map.alert_error_rate_min_samples, 5, 1000),
        errorRateSilenceMin: positiveInt(map.alert_error_rate_silence, 60, 10080),
        latencySilenceMin: positiveInt(map.alert_latency_silence, 60, 10080),
    };
}

/** 与 settings 里同名键的取值上限保持一致,监控级覆盖也按这个范围夹 */
const RULE_MAX = { window: 1440, samples: 1000, silence: 10080 } as const;

/** 非法 / 未填都返回 null,由调用方决定回落 */
function overrideInt(raw: unknown, max: number): number | null {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(Math.round(n), max);
}

/**
 * 站点级规则 + 监控级覆盖。
 *
 * 口径的"默认值"仍然只有一份(站点设置),监控级只覆盖填了的项 ——
 * 这样改全局规则时,没单独配置的监控会一起跟着变,不会出现
 * "改了全局却只对一部分监控生效"的困惑。
 */
export function applyRuleOverrides(
    base: AlertRules,
    monitor?: Pick<Monitor, 'alert_error_rate_window' | 'alert_error_rate_min_samples'
        | 'alert_error_rate_silence' | 'alert_latency_silence'> | null,
): AlertRules {
    if (!monitor) return base;
    return {
        errorRateWindowMin: overrideInt(monitor.alert_error_rate_window, RULE_MAX.window) ?? base.errorRateWindowMin,
        errorRateMinSamples: overrideInt(monitor.alert_error_rate_min_samples, RULE_MAX.samples) ?? base.errorRateMinSamples,
        errorRateSilenceMin: overrideInt(monitor.alert_error_rate_silence, RULE_MAX.silence) ?? base.errorRateSilenceMin,
        latencySilenceMin: overrideInt(monitor.alert_latency_silence, RULE_MAX.silence) ?? base.latencySilenceMin,
    };
}

// ── 读取缓存 ──────────────────────────────────────────────
// 告警是高频路径(每个监控每次探测都可能触发),模板却极少改动。
// 用 60s 内存缓存把"每次告警查一次模板表"降下来。
// 代价:改动后最多 60s 才在所有实例生效 —— 对文案来说完全可以接受。
const CACHE_TTL_MS = 60_000;
let cache = new Map<string, { payload: AlertTemplatePayload; at: number }>();

export function invalidateTemplateCache(): void {
    cache = new Map();
}

function fromCache(key: string): AlertTemplatePayload | null {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
    return hit.payload;
}

function toCache(key: string, payload: AlertTemplatePayload): AlertTemplatePayload {
    cache.set(key, { payload, at: Date.now() });
    return payload;
}

export async function listTemplateVersions(env: Bindings): Promise<AlertTemplateVersion[]> {
    const { results } = await env.DB.prepare(
        'SELECT * FROM alert_templates ORDER BY is_default DESC, id ASC'
    ).all<AlertTemplateVersion>();
    return results || [];
}

/** 默认版本:渠道没指定版本时用它。没有任何版本时回落到内置文案 */
export async function getDefaultTemplate(env: Bindings): Promise<AlertTemplatePayload> {
    const cached = fromCache('default');
    if (cached) return cached;

    const row = await env.DB.prepare(
        'SELECT payload FROM alert_templates WHERE is_default = 1 ORDER BY id ASC LIMIT 1'
    ).first<{ payload: string }>();
    if (row) return toCache('default', parseTemplatePayload(row.payload));

    const first = await env.DB.prepare(
        'SELECT payload FROM alert_templates ORDER BY id ASC LIMIT 1'
    ).first<{ payload: string }>();
    return toCache('default', first ? parseTemplatePayload(first.payload) : { ...DEFAULT_TEMPLATE_PAYLOAD });
}

/** 批量取若干个版本的 payload(一次 SQL),返回 id → payload */
export async function getTemplatePayloads(
    env: Bindings,
    ids: number[],
): Promise<Map<number, AlertTemplatePayload>> {
    const out = new Map<number, AlertTemplatePayload>();
    const missing = ids.filter((id) => {
        const hit = fromCache(String(id));
        if (hit) { out.set(id, hit); return false; }
        return true;
    });
    if (missing.length === 0) return out;

    const placeholders = missing.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
        `SELECT id, payload FROM alert_templates WHERE id IN (${placeholders})`
    ).bind(...missing).all<{ id: number; payload: string }>();
    for (const r of results || []) out.set(r.id, toCache(String(r.id), parseTemplatePayload(r.payload)));
    return out;
}

export interface VersionInput {
    name: string;
    note?: string | null;
    payload: Partial<AlertTemplatePayload>;
    isDefault?: boolean;
}

/** 只保留已知槽位,避免前端把整个表单对象塞进来污染 payload */
export function normalizePayload(input: Partial<AlertTemplatePayload> | null | undefined): AlertTemplatePayload {
    const out = { ...DEFAULT_TEMPLATE_PAYLOAD };
    if (!input) return out;
    for (const key of Object.keys(out) as (keyof AlertTemplatePayload)[]) {
        const v = input[key];
        if (typeof v === 'string') out[key] = v;
    }
    return out;
}

export async function createTemplateVersion(env: Bindings, input: VersionInput): Promise<number> {
    const payload = normalizePayload(input.payload);
    const res = await env.DB.prepare(
        'INSERT INTO alert_templates (name, note, is_default, payload) VALUES (?, ?, 0, ?)'
    ).bind(input.name.trim() || 'Untitled', input.note?.trim() || null, JSON.stringify(payload)).run();
    const id = Number(res.meta?.last_row_id);
    if (input.isDefault) await setDefaultVersion(env, id);
    invalidateTemplateCache();
    return id;
}

export async function updateTemplateVersion(env: Bindings, id: number, input: VersionInput): Promise<void> {
    const payload = normalizePayload(input.payload);
    await env.DB.prepare(
        'UPDATE alert_templates SET name = ?, note = ?, payload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(input.name.trim() || 'Untitled', input.note?.trim() || null, JSON.stringify(payload), id).run();
    if (input.isDefault) await setDefaultVersion(env, id);
    invalidateTemplateCache();
}

/** 把默认标记移到指定版本(全表只有一个 is_default=1) */
export async function setDefaultVersion(env: Bindings, id: number): Promise<void> {
    await env.DB.batch([
        env.DB.prepare('UPDATE alert_templates SET is_default = 0 WHERE is_default = 1'),
        env.DB.prepare('UPDATE alert_templates SET is_default = 1 WHERE id = ?').bind(id),
    ]);
    invalidateTemplateCache();
}

/** 复制一份为新版本(用于"基于当前版本改一版") */
export async function duplicateTemplateVersion(env: Bindings, id: number): Promise<number | null> {
    const row = await env.DB.prepare('SELECT name, note, payload FROM alert_templates WHERE id = ?')
        .bind(id).first<{ name: string; note: string | null; payload: string }>();
    if (!row) return null;
    const newId = await createTemplateVersion(env, {
        name: `${row.name} (copy)`,
        note: row.note,
        payload: parseTemplatePayload(row.payload),
    });
    return newId;
}

/**
 * 删除版本。
 * 删掉的是默认版本时把默认转给剩下最老的一条 —— 否则会留下"没有默认版本"
 * 的悬空状态,所有未绑定的渠道都拿不到文案。渠道上的引用同步置空(回落到默认)。
 */
export async function deleteTemplateVersion(env: Bindings, id: number): Promise<void> {
    const row = await env.DB.prepare('SELECT is_default FROM alert_templates WHERE id = ?')
        .bind(id).first<{ is_default: number }>();
    await env.DB.prepare('DELETE FROM alert_templates WHERE id = ?').bind(id).run();
    await env.DB.prepare('UPDATE notification_channels SET template_version_id = NULL WHERE template_version_id = ?')
        .bind(id).run();
    if (Number(row?.is_default) === 1) {
        await env.DB.prepare(
            'UPDATE alert_templates SET is_default = 1 WHERE id = (SELECT id FROM alert_templates ORDER BY id ASC LIMIT 1)'
        ).run();
    }
    invalidateTemplateCache();
}
