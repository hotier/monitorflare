import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env as poolEnv, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import type { Bindings } from '../src/types';

const env = poolEnv as unknown as Bindings;

/** 通过真实的 fetch handler 发请求，走完整的中间件链 */
const call = async (path: string, init?: RequestInit): Promise<Response> => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://status.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
};

const bearer = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } });

const setSetting = (key: string, value: string) =>
  env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();

beforeAll(async () => {
  // 触发 ensureInitialized 建表。init.ts 对 initPromise 做了模块级缓存，
  // 因此整个文件只需触发一次；测试池的隔离存储不会回滚 beforeAll 的写入。
  const res = await call('/api/status');
  expect(res.status).toBe(200);
});

describe('CORS', () => {
  it('OPTIONS 预检直接放行，不触发鉴权', async () => {
    const res = await call('/monitors', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    expect(res.status).not.toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('未配置 ALLOWED_ORIGIN 时只放行本地来源', async () => {
    const res = await call('/api/status', { headers: { Origin: 'https://evil.example.com' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example.com');
  });
});

describe('公开接口免鉴权', () => {
  it('GET /api/status 无需鉴权', async () => {
    const res = await call('/api/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('monitors');
    expect(body).toHaveProperty('incidents');
    expect(body).toHaveProperty('generated_at');
  });

  it('GET /status 与 /api/status 等价(双注册)', async () => {
    const res = await call('/status');
    expect(res.status).toBe(200);
  });

  it('GET /monitors/public 无需鉴权', async () => {
    const res = await call('/monitors/public');
    expect(res.status).toBe(200);
  });

  it('GET /monitors/public/details 无需鉴权', async () => {
    const res = await call('/monitors/public/details');
    expect(res.status).toBe(200);
  });

  it('GET /incidents 无需鉴权', async () => {
    const res = await call('/incidents');
    expect(res.status).toBe(200);
  });

  it('GET /feed.xml 无需鉴权且返回 RSS', async () => {
    const res = await call('/feed.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/rss+xml');
    expect(await res.text()).toContain('<rss version="2.0">');
  });
});

describe('受保护接口鉴权', () => {
  it('缺少 Authorization 头返回 401', async () => {
    const res = await call('/monitors');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('错误凭据返回 401', async () => {
    const res = await call('/monitors', bearer('wrong-token'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: Invalid credentials' });
  });

  it('ADMIN_API_KEY 可访问受保护接口', async () => {
    const res = await call('/monitors', bearer('test-admin-key'));
    expect(res.status).toBe(200);
  });

  it('/health 同样受保护', async () => {
    expect((await call('/health')).status).toBe(401);

    const ok = await call('/health', bearer('test-admin-key'));
    expect(ok.status).toBe(200);
    const body = await ok.json() as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'ok', db: true, ok: true });
    // 系统状态栏用到的字段都必须存在(取值正确性见 '/health 系统状态指标')
    for (const key of ['logs', 'enabled_channels', 'latest_daily_uptime', 'latest_log_at']) {
      expect(body).toHaveProperty(key);
    }
  });

  it('/notification-channels 受保护', async () => {
    expect((await call('/notification-channels')).status).toBe(401);
    expect((await call('/notification-channels', bearer('test-admin-key'))).status).toBe(200);
  });

  it('未知路径返回 404', async () => {
    const res = await call('/definitely-not-a-route', bearer('test-admin-key'));
    expect(res.status).toBe(404);
  });
});

describe('私密模式锁定状态页', () => {
  beforeEach(() => setSetting('status_page_visibility', 'private'));
  afterEach(() => setSetting('status_page_visibility', 'public'));

  it('锁定 /api/status', async () => {
    const res = await call('/api/status');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'status_page_locked' });
  });

  it('锁定 /monitors/public 与 /feed.xml', async () => {
    expect((await call('/monitors/public')).status).toBe(401);
    expect((await call('/feed.xml')).status).toBe(401);
  });

  it('登录接口保持放行(未配置密码时返回 503)', async () => {
    const res = await call('/api/status/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'whatever' }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'status_page_not_configured' });
  });

  // 记录一个容易误解的行为：私密模式的锁定分支只校验「状态页 token」
  // 与「后台会话 token」，并不走 verifyAdminCredential。
  // 因此裸的 ADMIN_API_KEY 无法查看被锁定的状态页，必须先用状态页密码
  // 换 token，或在后台登录后带会话 token。
  it('管理员 API Key 不能绕过状态页锁定', async () => {
    const res = await call('/api/status', bearer('test-admin-key'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'status_page_locked' });
  });

  it('同一把 Key 仍然可以访问管理接口', async () => {
    const res = await call('/monitors', bearer('test-admin-key'));
    expect(res.status).toBe(200);
  });
});

describe('RSS 输出转义', () => {
  it('incident 标题与描述中的 XML 特殊字符被转义', async () => {
    const raw = `A <b>&"quoted"</b>'s`;
    await env.DB.prepare(
      "INSERT INTO incidents (title, description, severity, status, type) VALUES (?, ?, 'info', 'active', 'incident')"
    )
      .bind(raw, raw)
      .run();

    const xml = await (await call('/feed.xml')).text();

    expect(xml).toContain('A &lt;b&gt;&amp;&quot;quoted&quot;&lt;/b&gt;&apos;s');
    expect(xml).not.toContain('<b>');
    expect(xml).not.toContain('&"quoted"');
  });
});

describe('邮件订阅', () => {
  it('非法邮箱返回 400', async () => {
    const res = await call('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Valid email is required' });
  });

  it('合法邮箱写入订阅表', async () => {
    const res = await call('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'subscriber@example.com' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const row = await env.DB.prepare('SELECT email FROM subscriptions WHERE email = ?')
      .bind('subscriber@example.com')
      .first<{ email: string }>();
    expect(row?.email).toBe('subscriber@example.com');
  });

  it('重复订阅更新 token 而不是报错', async () => {
    const body = JSON.stringify({ email: 'repeat@example.com' });
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
    expect((await call('/api/subscribe', init)).status).toBe(200);
    expect((await call('/api/subscribe', init)).status).toBe(200);

    const row = await env.DB.prepare('SELECT COUNT(*) as n FROM subscriptions WHERE email = ?')
      .bind('repeat@example.com')
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});

describe('批量操作', () => {
  const batch = (payload: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
    body: JSON.stringify(payload),
  });

  it('ids 为空返回 400', async () => {
    const res = await call('/monitors/batch', batch({ action: 'check', ids: [] }));
    expect(res.status).toBe(400);
  });

  it('未知 action 返回 400', async () => {
    const res = await call('/monitors/batch', batch({ action: 'nope', ids: [1] }));
    expect(res.status).toBe(400);
  });

  it('action=check 返回实际命中数量', async () => {
    const res = await call('/monitors/batch', batch({ action: 'check', ids: [999999] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, affected: 0 });
  });

  it('批量暂停/恢复/删除生效', async () => {
    const inserted = await env.DB.prepare(
      "INSERT INTO monitors (name, url, type, status, paused, sort_order) VALUES ('batch-monitor', 'https://example.com', 'http', 'UP', 0, 0)"
    ).run();
    const id = Number(inserted.meta.last_row_id);

    await call('/monitors/batch', batch({ action: 'pause', ids: [id] }));
    expect((await env.DB.prepare('SELECT paused FROM monitors WHERE id = ?').bind(id).first<{ paused: number }>())?.paused).toBe(1);

    await call('/monitors/batch', batch({ action: 'resume', ids: [id] }));
    expect((await env.DB.prepare('SELECT paused FROM monitors WHERE id = ?').bind(id).first<{ paused: number }>())?.paused).toBe(0);

    await call('/monitors/batch', batch({ action: 'delete', ids: [id] }));
    expect(await env.DB.prepare('SELECT id FROM monitors WHERE id = ?').bind(id).first()).toBeNull();
  });
});

describe('创建监控时立即执行首次探测', () => {
  const create = (payload: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
    body: JSON.stringify(payload),
  });

  afterEach(() => vi.unstubAllGlobals());

  it('创建成功后写入探测日志并刷新 last_check', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const res = await call('/monitors', create({ name: 'first-check', url: 'https://example.com' }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };

    const log = await env.DB.prepare('SELECT status_code, is_fail FROM logs WHERE monitor_id = ?')
      .bind(id)
      .first<{ status_code: number; is_fail: number }>();
    expect(log).not.toBeNull();
    expect(log?.is_fail).toBe(0);
    expect(log?.status_code).toBe(200);

    const row = await env.DB.prepare('SELECT last_check FROM monitors WHERE id = ?')
      .bind(id)
      .first<{ last_check: string | null }>();
    expect(row?.last_check).not.toBeNull();
  });

  it('首次探测失败时同样落库且不抛出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const res = await call('/monitors', create({ name: 'first-check-fail', url: 'https://example.com' }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };

    const log = await env.DB.prepare('SELECT is_fail FROM logs WHERE monitor_id = ?')
      .bind(id)
      .first<{ is_fail: number }>();
    expect(log?.is_fail).toBe(1);
  });

  it('缺少 url 返回 400 且不创建监控', async () => {
    const res = await call('/monitors', create({ name: 'no-url' }));
    expect(res.status).toBe(400);
  });
});

describe('/health 系统状态指标', () => {
  // 用不会与真实数据冲突的假 monitor_id 与远期日期,断言不依赖其他用例留下的数据
  const TMP_MONITOR = 999999;

  afterEach(async () => {
    await env.DB.prepare('DELETE FROM logs WHERE monitor_id = ?').bind(TMP_MONITOR).run();
    await env.DB.prepare('DELETE FROM daily_uptime WHERE monitor_id = ?').bind(TMP_MONITOR).run();
    await env.DB.prepare("DELETE FROM notification_channels WHERE name LIKE '健康检查测试%'").run();
  });

  it('返回日志量 / 启用渠道数 / 最近聚合日 / 最近检测时间', async () => {
    // 取基线再比较增量,避免破坏其他用例写入的数据
    const chBase = await env.DB.prepare('SELECT COUNT(*) as c FROM notification_channels WHERE enabled = 1').first<{ c: number }>();
    const logBase = await env.DB.prepare('SELECT COUNT(*) as c FROM logs').first<{ c: number }>();

    await env.DB.batch([
      env.DB.prepare("INSERT INTO notification_channels (type, name, enabled, config) VALUES ('webhook', '健康检查测试-启用', 1, '{}')"),
      env.DB.prepare("INSERT INTO notification_channels (type, name, enabled, config) VALUES ('webhook', '健康检查测试-停用', 0, '{}')"),
      env.DB.prepare('INSERT INTO logs (monitor_id, status_code, latency, is_fail, created_at) VALUES (?, 200, 12, 0, ?)')
        .bind(TMP_MONITOR, '2099-01-01 03:00:00'),
      env.DB.prepare('INSERT INTO logs (monitor_id, status_code, latency, is_fail, created_at) VALUES (?, 500, 30, 1, ?)')
        .bind(TMP_MONITOR, '2099-01-01 04:00:00'),
      env.DB.prepare('INSERT OR REPLACE INTO daily_uptime (monitor_id, date, total_checks, successful_checks, avg_latency) VALUES (?, ?, 10, 10, 20)')
        .bind(TMP_MONITOR, '2099-01-01'),
    ]);

    const res = await call('/health', bearer('test-admin-key'));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      status: string; ok: boolean; db: boolean;
      logs: number; enabled_channels: number;
      latest_daily_uptime: string | null; latest_log_at: string | null;
    };
    expect(body.status).toBe('ok');
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
    expect(body.logs).toBe((logBase?.c ?? 0) + 2);
    // 只统计 enabled = 1 的渠道
    expect(body.enabled_channels).toBe((chBase?.c ?? 0) + 1);
    expect(body.latest_daily_uptime).toBe('2099-01-01');
    expect(body.latest_log_at).toBe('2099-01-01 04:00:00');
  });
});
