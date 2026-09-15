import { describe, it, expect } from 'vitest';
import {
    renderTemplate, renderDetail, renderBranding, parseTemplatePayload,
    DEFAULT_TEMPLATE_PAYLOAD, DEFAULT_TEMPLATE_PAYLOAD_ZH, defaultTemplatePayload, type AlertSlot,
} from '../src/services/template';
import { normalizePayload } from '../src/services/template-store';
import { buildAlertMessage } from '../src/i18n';

const payload = (over: Partial<typeof DEFAULT_TEMPLATE_PAYLOAD> = {}) => ({ ...DEFAULT_TEMPLATE_PAYLOAD, ...over });

describe('renderTemplate', () => {
    it('替换已知变量', () => {
        expect(renderTemplate('{name} is {status}', { name: 'api', status: 'DOWN' })).toBe('api is DOWN');
    });

    it('已知变量但值为空 → 替换为空串,不留下占位符', () => {
        expect(renderTemplate('reason: [{reason}]', { reason: '' })).toBe('reason: []');
        expect(renderTemplate('latency: {latency}ms', { latency: null })).toBe('latency: ms');
    });

    it('未知变量原样保留,便于发现拼写错误', () => {
        expect(renderTemplate('{name} {nmae}', { name: 'api' })).toBe('api {nmae}');
    });

    it('允许花括号内带空格', () => {
        expect(renderTemplate('{ name }', { name: 'api' })).toBe('api');
    });

    it('不误伤 JSON 之类的花括号文本', () => {
        expect(renderTemplate('config: {"a":1}', {})).toBe('config: {"a":1}');
    });
});

describe('renderDetail', () => {
    it('模板为空 → 用 fallback', () => {
        // 默认 payload 的 down 有内置文案,这里显式清空才是"用户没填"的场景
        expect(renderDetail(payload({ down: '' }), 'down', 'fallback', { name: 'a' })).toBe('fallback');
    });

    it('模板渲染结果为空 → 用 fallback', () => {
        expect(renderDetail(payload({ down: '{reason}' }), 'down', 'fallback', { reason: '' })).toBe('fallback');
    });

    it('模板可用时按模板渲染', () => {
        expect(renderDetail(payload({ ssl: 'SSL {days}d {expiry}' }), 'ssl', 'fallback', { days: 7, expiry: '2026-01-01' }))
            .toBe('SSL 7d 2026-01-01');
    });

    it('六个槽位都能取到各自的文案', () => {
        const slots: AlertSlot[] = ['down', 'up', 'error_rate', 'ssl', 'domain', 'latency'];
        for (const slot of slots) {
            expect(renderDetail(payload({ [slot]: `tpl:${slot}` }), slot, 'fallback', {})).toBe(`tpl:${slot}`);
        }
    });
});

describe('renderBranding', () => {
    it('按上下线取不同标题', () => {
        const p = payload({ title_down: '故障', title_up: '恢复', footer: 'SRE' });
        expect(renderBranding(p, true)).toEqual({ title: '故障', footer: 'SRE' });
        expect(renderBranding(p, false)).toEqual({ title: '恢复', footer: 'SRE' });
    });

    it('未配置时返回空串,由调用方回落到内置文案', () => {
        expect(renderBranding(payload(), true).title).toBe('');
    });
});

describe('payload 解析与归一化', () => {
    it('坏 JSON 不会让告警发不出去', () => {
        expect(parseTemplatePayload('{ not json')).toEqual(DEFAULT_TEMPLATE_PAYLOAD);
        expect(parseTemplatePayload(null)).toEqual(DEFAULT_TEMPLATE_PAYLOAD);
    });

    it('缺字段补默认值', () => {
        const parsed = parseTemplatePayload(JSON.stringify({ down: 'D' }));
        expect(parsed.down).toBe('D');
        expect(parsed.up).toBe(DEFAULT_TEMPLATE_PAYLOAD.up);
    });

    it('归一化时丢弃非字符串与未知字段', () => {
        const out = normalizePayload({ down: 'x', up: 123 as unknown as string, extra: 'y' } as never);
        expect(out.down).toBe('x');
        expect(out.up).toBe(DEFAULT_TEMPLATE_PAYLOAD.up);
        expect('extra' in out).toBe(false);
    });
});

describe('defaultTemplatePayload', () => {
    it('中文站给中文默认文案', () => {
        expect(defaultTemplatePayload('zh').down).toBe(DEFAULT_TEMPLATE_PAYLOAD_ZH.down);
        expect(defaultTemplatePayload('zh-CN').title_down).toBe('服务故障报警');
    });

    it('非中文站给英文默认文案', () => {
        expect(defaultTemplatePayload('en').down).toBe(DEFAULT_TEMPLATE_PAYLOAD.down);
        expect(defaultTemplatePayload(null).down).toBe(DEFAULT_TEMPLATE_PAYLOAD.down);
    });
});

describe('buildAlertMessage 的标题与落款', () => {
    const monitor = { name: 'api', url: 'https://api.example.com' };

    it('标题/落款支持变量替换', () => {
        const msg = buildAlertMessage(monitor, 'DOWN', 'detail', '2026-01-01 10:00', 'zh',
            { title: '{name} 挂了', footer: '{url}' }, { status: 'DOWN' });
        expect(msg.title).toBe('api 挂了');
        expect(msg.footer).toBe('https://api.example.com');
    });

    it('未配置标题/落款 → 回落到内置文案', () => {
        const msg = buildAlertMessage(monitor, 'DOWN', 'detail', '2026-01-01 10:00', 'zh');
        expect(msg.title).not.toContain('{');
        expect(msg.footer).toBeTruthy();
    });
});
