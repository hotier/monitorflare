import { describe, it, expect, vi, afterEach } from 'vitest';
import { performCheck } from '../src/checks';
import type { Bindings, Monitor, MonitorType } from '../src/types';

const env = {} as Bindings;

const monitor = (over: Partial<Monitor> = {}): Monitor => ({
  id: 1,
  name: 'test',
  url: 'https://example.com',
  type: 'http',
  config: null,
  method: 'GET',
  request_headers: null,
  request_body: null,
  interval: 300,
  status: 'UP',
  retry_count: 0,
  last_check: null,
  keyword: null,
  user_agent: null,
  tags: null,
  domain_expiry: null,
  cert_expiry: null,
  check_info_status: null,
  paused: 0,
  check_ssl: 1,
  check_domain: 1,
  alert_silence_uptime: 24,
  alert_silence_ssl: 24,
  alert_silence_domain: 24,
  alert_error_rate: 0,
  alert_after_failures: 1,
  last_alert_uptime: null,
  last_alert_ssl: null,
  last_alert_domain: null,
  sort_order: 0,
  created_at: '2024-01-01 00:00:00',
  ...over,
});

/** 安装一个可控的 fetch 替身 */
const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('performCheck — 类型分发', () => {
  it('http 走 HTTP 检查', async () => {
    const f = stubFetch(async () => new Response('ok', { status: 200 }));
    const r = await performCheck(monitor({ type: 'http' }), env);
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('未知类型回退到 HTTP 检查', async () => {
    const f = stubFetch(async () => new Response('ok', { status: 200 }));
    const r = await performCheck(monitor({ type: 'weird' as MonitorType }), env);
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('dns 走 DoH 检查而非直接请求目标地址', async () => {
    const f = stubFetch(async () =>
      new Response(JSON.stringify({ Status: 0, Answer: [{ name: 'example.com.', type: 1, data: '1.2.3.4' }] }), {
        status: 200,
      })
    );
    await performCheck(monitor({ type: 'dns' }), env);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain('cloudflare-dns.com');
  });

  it('port 走 TCP 检查而非 HTTP 请求', async () => {
    const f = stubFetch(async () => new Response('ok', { status: 200 }));
    const r = await performCheck(
      monitor({ type: 'port', url: 'https://127.0.0.1', config: JSON.stringify({ port: 1, timeout: 300 }) }),
      env
    );
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('HTTP 检查', () => {
  it('2xx 视为成功并记录状态码', async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    const r = await performCheck(monitor(), env);
    expect(r.ok).toBe(true);
    expect(r.statusCode).toBe(204);
    expect(r.reason).toBe('');
  });

  it('非 2xx 视为失败并带 HTTP 状态码', async () => {
    stubFetch(async () => new Response('', { status: 500 }));
    const r = await performCheck(monitor(), env);
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(500);
    expect(r.reason).toBe('HTTP 500');
  });

  it('关键字命中则成功', async () => {
    stubFetch(async () => new Response('hello world', { status: 200 }));
    const r = await performCheck(monitor({ keyword: 'world' }), env);
    expect(r.ok).toBe(true);
  });

  it('关键字未命中则失败', async () => {
    stubFetch(async () => new Response('hello world', { status: 200 }));
    const r = await performCheck(monitor({ keyword: 'absent' }), env);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Keyword "absent" not found');
  });

  it('默认使用 GET 且带 User-Agent', async () => {
    const f = stubFetch(async () => new Response('', { status: 200 }));
    await performCheck(monitor(), env);
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('MonitorFlare/1.0');
  });

  it('自定义 user_agent 生效', async () => {
    const f = stubFetch(async () => new Response('', { status: 200 }));
    await performCheck(monitor({ user_agent: 'MyBot/9' }), env);
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('MyBot/9');
  });

  it('POST 带 body 时自动补 Content-Type', async () => {
    const f = stubFetch(async () => new Response('', { status: 200 }));
    await performCheck(monitor({ method: 'POST', request_body: '{"a":1}' }), env);
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('GET 不携带 body', async () => {
    const f = stubFetch(async () => new Response('', { status: 200 }));
    await performCheck(monitor({ request_body: '{"a":1}' }), env);
    expect((f.mock.calls[0][1] as RequestInit).body).toBeUndefined();
  });

  it('合并自定义请求头', async () => {
    const f = stubFetch(async () => new Response('', { status: 200 }));
    await performCheck(monitor({ request_headers: '{"X-Trace":"abc"}' }), env);
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Trace']).toBe('abc');
  });

  it('request_headers 非法 JSON 时忽略而不是抛错', async () => {
    const f = stubFetch(async () => new Response('', { status: 200 }));
    const r = await performCheck(monitor({ request_headers: '{broken' }), env);
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('网络异常映射为 DNS resolution failed', async () => {
    stubFetch(async () => {
      throw new Error('fetch failed');
    });
    const r = await performCheck(monitor(), env);
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(0);
    expect(r.reason).toBe('DNS resolution failed');
  });

  it('超时异常映射为 Timeout', async () => {
    stubFetch(async () => {
      throw new Error('The operation was aborted due to timeout');
    });
    const r = await performCheck(monitor(), env);
    expect(r.reason).toBe('Timeout');
  });

  it('TLS 异常映射为 SSL Error', async () => {
    stubFetch(async () => {
      throw new Error('TLS handshake failed');
    });
    const r = await performCheck(monitor(), env);
    expect(r.reason).toBe('SSL Error: TLS handshake failed');
  });
});

describe('DNS 检查', () => {
  const doh = (body: unknown, status = 200) =>
    stubFetch(async () => new Response(JSON.stringify(body), { status }));

  it('期望值命中则成功并记录 detail', async () => {
    doh({ Status: 0, Answer: [{ name: 'example.com.', type: 1, data: '1.2.3.4' }] });
    const r = await performCheck(
      monitor({ type: 'dns', config: JSON.stringify({ record_type: 'A', expected: '1.2.3.4' }) }),
      env
    );
    expect(r.ok).toBe(true);
    expect(r.detail).toBe('A: 1.2.3.4');
  });

  it('记录值的大小写与末尾点被归一化', async () => {
    doh({ Status: 0, Answer: [{ name: 'example.com.', type: 5, data: 'Target.Example.COM.' }] });
    const r = await performCheck(
      monitor({ type: 'dns', config: JSON.stringify({ record_type: 'CNAME', expected: 'target.example.com' }) }),
      env
    );
    expect(r.ok).toBe(true);
  });

  it('期望值不匹配则失败并给出实际值', async () => {
    doh({ Status: 0, Answer: [{ name: 'example.com.', type: 1, data: '1.2.3.4' }] });
    const r = await performCheck(
      monitor({ type: 'dns', config: JSON.stringify({ record_type: 'A', expected: '9.9.9.9' }) }),
      env
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Expected [9.9.9.9] got [1.2.3.4]');
  });

  it('多个期望值任一命中即成功', async () => {
    doh({ Status: 0, Answer: [{ name: 'example.com.', type: 1, data: '1.2.3.4' }] });
    const r = await performCheck(
      monitor({ type: 'dns', config: JSON.stringify({ expected: '9.9.9.9, 1.2.3.4' }) }),
      env
    );
    expect(r.ok).toBe(true);
  });

  it('留空 expected 时仅校验记录存在', async () => {
    doh({ Status: 0, Answer: [{ name: 'example.com.', type: 1, data: '1.2.3.4' }] });
    const r = await performCheck(monitor({ type: 'dns', config: JSON.stringify({ record_type: 'A' }) }), env);
    expect(r.ok).toBe(true);
  });

  it('DNS 状态码非 0 视为失败', async () => {
    doh({ Status: 2, Comment: 'SERVFAIL' });
    const r = await performCheck(monitor({ type: 'dns' }), env);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('DNS status 2');
  });

  it('无任何记录视为失败', async () => {
    doh({ Status: 0, Answer: [] });
    const r = await performCheck(monitor({ type: 'dns' }), env);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('No A record found');
  });

  it('resolver=google 时改用 dns.google', async () => {
    const f = doh({ Status: 0, Answer: [{ name: 'example.com.', type: 1, data: '1.2.3.4' }] });
    await performCheck(monitor({ type: 'dns', config: JSON.stringify({ resolver: 'google' }) }), env);
    expect(String(f.mock.calls[0][0])).toContain('dns.google');
  });

  it('请求头声明接受 DNS-JSON', async () => {
    const f = doh({ Status: 0, Answer: [{ name: 'example.com.', type: 1, data: '1.2.3.4' }] });
    await performCheck(monitor({ type: 'dns' }), env);
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Accept']).toBe('application/dns-json');
  });

  it('DoH 请求失败时返回 DoH 状态码', async () => {
    doh({}, 503);
    const r = await performCheck(monitor({ type: 'dns' }), env);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('DoH 503');
  });

  it('config 非法 JSON 时按默认配置继续', async () => {
    doh({ Status: 0, Answer: [{ name: 'example.com.', type: 1, data: '1.2.3.4' }] });
    const r = await performCheck(monitor({ type: 'dns', config: '{broken' }), env);
    expect(r.ok).toBe(true);
    expect(r.detail).toBe('A: 1.2.3.4');
  });
});
