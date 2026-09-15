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

describe('公开接口的 ?id= / ?ids= 过滤', () => {
  const A = 777001;
  const B = 777002;

  const clean = () => env.DB.batch([
    env.DB.prepare('DELETE FROM monitors WHERE id IN (?, ?)').bind(A, B),
  ]);

  const insert = () => env.DB.batch([
    env.DB.prepare("INSERT INTO monitors (id, name, url, type, status, sort_order) VALUES (?, '过滤A', 'https://a.test', 'http', 'UP', 90)").bind(A),
    env.DB.prepare("INSERT INTO monitors (id, name, url, type, status, sort_order) VALUES (?, '过滤B', 'https://b.test', 'http', 'UP', 91)").bind(B),
  ]);

  beforeEach(async () => {
    await clean();
    await insert();
  });
  afterEach(clean);

  it('不传参数时返回全部(老调用方行为不变)', async () => {
    const res = await call('/monitors/public');
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number }[];
    expect(body.map(m => m.id)).toEqual(expect.arrayContaining([A, B]));
  });

  it('?id= 只返回指定的那一个', async () => {
    const res = await call(`/monitors/public?id=${B}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number }[];
    expect(body.map(m => m.id)).toEqual([B]);
  });

  it('?ids= 支持多个且去重,顺序与全量一致', async () => {
    const body = await (await call(`/monitors/public?ids=${B},${A},${B}`)).json() as { id: number }[];
    // sort_order A(90) < B(91),重复 id 只出现一次
    expect(body.map(m => m.id)).toEqual([A, B]);
  });

  it('id 与 ids 同时传入时合并', async () => {
    const body = await (await call(`/monitors/public?id=${A}&ids=${B}`)).json() as { id: number }[];
    expect(body.map(m => m.id)).toEqual([A, B]);
  });

  it('非法 id 返回 400 而不是静默返回全量', async () => {
    expect((await call('/monitors/public?id=abc')).status).toBe(400);
    expect((await call('/monitors/public?id=0')).status).toBe(400);
    expect((await call('/monitors/public?id=-1')).status).toBe(400);
  });

  it('details 接口的过滤互不影响(不同 id 组合各自缓存)', async () => {
    const only = await (await call(`/monitors/public/details?id=${A}`)).json() as { monitors: { id: number }[] };
    expect(only.monitors.map(m => m.id)).toEqual([A]);

    const two = await (await call(`/monitors/public/details?ids=${A},${B}`)).json() as { monitors: { id: number }[] };
    expect(two.monitors.map(m => m.id)).toEqual([A, B]);
  });

  it('?detail=1 附带可用率与每日统计,不带时保持精简字段', async () => {
    const slim = await (await call(`/monitors/public?id=${A}`)).json() as { uptime_24h?: number }[];
    expect(slim).toHaveLength(1);
    expect(slim[0].uptime_24h).toBeUndefined();

    const full = await (await call(`/monitors/public?id=${A}&detail=1`)).json() as {
      monitors: { id: number; uptime_24h: number | null; daily_stats: unknown[] }[];
    };
    expect(full.monitors.map(m => m.id)).toEqual([A]);
    expect(full.monitors[0]).toHaveProperty('uptime_24h');
    expect(Array.isArray(full.monitors[0].daily_stats)).toBe(true);
  });

  it('旧的 /monitors/public/details 与 /monitors/public?detail=1 等价', async () => {
    const legacy = await (await call(`/monitors/public/details?id=${A}`)).json();
    const current = await (await call(`/monitors/public?id=${A}&detail=1`)).json();
    expect(legacy).toEqual(current);
  });
});

describe('单监控详情 /monitors/public/detail', () => {
  const M = 777003;

  const clean = () => env.DB.batch([
    env.DB.prepare('DELETE FROM monitors WHERE id = ?').bind(M),
  ]);

  const insert = () => env.DB.batch([
    env.DB.prepare("INSERT INTO monitors (id, name, url, type, status, sort_order) VALUES (?, '详情M', 'https://m.test', 'http', 'UP', 92)").bind(M),
  ]);

  beforeEach(async () => {
    await clean();
    await insert();
  });
  afterEach(clean);

  it('?id= 与旧路径 /monitors/public/:id 返回同一份数据', async () => {
    const byQuery = await (await call(`/monitors/public/detail?id=${M}`)).json() as { monitor: { id: number } };
    const byPath = await (await call(`/monitors/public/${M}`)).json();
    expect(byQuery.monitor.id).toBe(M);
    expect(byQuery).toEqual(byPath);
  });

  it('缺 id、给多个 id、id 非法都返回 400', async () => {
    expect((await call('/monitors/public/detail')).status).toBe(400);
    expect((await call(`/monitors/public/detail?ids=${M},${M + 1}`)).status).toBe(400);
    expect((await call('/monitors/public/detail?id=abc')).status).toBe(400);
  });

  it('id 不存在返回 404', async () => {
    expect((await call('/monitors/public/detail?id=99999999')).status).toBe(404);
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
    // 日志量用 MAX(id) 近似:COUNT(*) 要扫完整张 logs,而这个接口每 60 秒就被打一次
    const logBase = await env.DB.prepare('SELECT MAX(id) as c FROM logs').first<{ c: number }>();

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

describe('可用率聚合口径', () => {
  // 直接写聚合表再断言接口输出:这条路径必须"只读聚合表",
  // 一旦有人改回扫 logs 原始表,这组用例就会因为读不到 logs 而失败。
  const M = 888888;

  const clean = () => env.DB.batch([
    env.DB.prepare('DELETE FROM monitors WHERE id = ?').bind(M),
    env.DB.prepare('DELETE FROM monitor_hourly WHERE monitor_id = ?').bind(M),
    env.DB.prepare('DELETE FROM daily_uptime WHERE monitor_id = ?').bind(M),
  ]);

  beforeEach(async () => {
    await clean();
    await setSetting('timezone', 'UTC'); // 用 UTC 便于在测试里手算日期
    await env.DB.prepare(
      "INSERT INTO monitors (id, name, url, type, status, last_check, last_latency) VALUES (?, '统计测试', 'https://example.com', 'http', 'UP', '2000-01-01 00:00:00', 42)"
    ).bind(M).run();
  });
  afterEach(async () => {
    await clean();
    await setSetting('timezone', 'Asia/Shanghai');
  });

  it('24h 取小时桶,7d/30d 取日聚合再叠加当天小时桶', async () => {
    const now = new Date();
    const hour = now.toISOString().slice(0, 13);                                  // UTC 当前小时桶
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

    await env.DB.batch([
      env.DB.prepare('INSERT OR REPLACE INTO daily_uptime (monitor_id, date, total_checks, successful_checks, avg_latency) VALUES (?, ?, 10, 8, 20)')
        .bind(M, yesterday),
      env.DB.prepare('INSERT OR REPLACE INTO monitor_hourly (monitor_id, hour, total, fails, latency_sum) VALUES (?, ?, 2, 0, 100)')
        .bind(M, hour),
    ]);

    const res = await call(`/monitors/public/${M}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      monitor: { uptime_24h: number | null; uptime_7d: number | null; uptime_30d: number | null;
        uptime_90d: number | null; latency: number | null; daily_stats: { date: string; up: number; total: number }[] };
    };

    // 24h 只看小时桶:2/2
    expect(body.monitor.uptime_24h).toBe(100);
    // 7d/30d/90d = 日聚合(8/10)+ 当天小时桶(2/2)= 10/12
    expect(body.monitor.uptime_7d).toBe(83.3);
    expect(body.monitor.uptime_30d).toBe(83.3);
    expect(body.monitor.uptime_90d).toBe(83.3);
    // 延迟取 monitors.last_latency,不再翻 logs
    expect(body.monitor.latency).toBe(42);
    // 柱状图末尾补上当天的桶
    expect(body.monitor.daily_stats.at(-1)).toEqual({ date: today, up: 2, total: 2 });
  });
});

describe('端点收敛后的行为', () => {
  const auth: RequestInit = { headers: { Authorization: 'Bearer test-admin-key' } };
  const postJson = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
    body: JSON.stringify(body),
  });

  let id: number;

  beforeEach(async () => {
    const r = await env.DB.prepare(
      "INSERT INTO monitors (name, url, type, status, paused, sort_order) VALUES ('收敛测试', 'https://example.com', 'http', 'UP', 0, 0)"
    ).run();
    id = Number(r.meta.last_row_id);
  });

  afterEach(() => env.DB.batch([
    env.DB.prepare('DELETE FROM monitors WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM logs WHERE monitor_id = ?').bind(id),
  ]));

  /* ---------------------------- /api 前缀统一剥离 ---------------------------- */

  it('/api/… 与裸路径返回同一份数据', async () => {
    const a = await call('/api/status');
    const b = await call('/status');
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
  });

  it('/api/v1/… 与 /v1/… 等价', async () => {
    const a = await call('/api/v1/monitors', auth);
    const b = await call('/v1/monitors', auth);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
  });

  it('/api/subscribe 命中订阅端点(邮箱校验拦下,而非 404)', async () => {
    const res = await call('/api/subscribe', postJson({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('/api/backup 受保护且不因前缀剥离而漏鉴权', async () => {
    expect((await call('/api/backup')).status).toBe(401);
    expect((await call('/api/backup', auth)).status).toBe(200);
  });

  /* ------------------------- /monitors 的读取与动作 ------------------------- */

  it('GET /monitors 返回 { monitors: [...] }', async () => {
    const res = await call('/monitors', auth);
    expect(res.status).toBe(200);
    const body = await res.json() as { monitors: unknown[] };
    expect(Array.isArray(body.monitors)).toBe(true);
  });

  it('?id= 过滤 + ?include=logs 附带该监控的日志', async () => {
    await env.DB.prepare(
      "INSERT INTO logs (monitor_id, status_code, latency, is_fail, created_at) VALUES (?, 200, 12, 0, '2000-01-01 00:00:00')"
    ).bind(id).run();

    const res = await call(`/monitors?id=${id}&include=logs`, auth);
    expect(res.status).toBe(200);
    const body = await res.json() as { monitors: { id: number }[]; logs: Record<string, unknown[]> };
    expect(body.monitors.map(m => m.id)).toEqual([id]);
    expect(body.logs[String(id)]).toHaveLength(1);
  });

  it('?include=stats 附带四个可用率口径', async () => {
    const res = await call('/monitors?include=stats', auth);
    expect(res.status).toBe(200);
    const body = await res.json() as { stats: Record<string, Record<string, unknown>> };
    expect(body.stats[String(id)]).toEqual(
      expect.objectContaining({ uptime_24h: null, uptime_7d: null, uptime_30d: null, uptime_90d: null }),
    );
  });

  it('未知的 include 值报 400', async () => {
    const res = await call('/monitors?include=bogus', auth);
    expect(res.status).toBe(400);
  });

  // 这条是收敛的关键前提:静态路径必须赢过参数路径,否则 /monitors/batch
  // 会落进 POST /monitors/:id 的 action 分支,批量操作直接坏掉。
  it('/monitors/batch 不被 POST /monitors/:id 抢走', async () => {
    const res = await call('/monitors/batch', postJson({ action: 'pause', ids: [id] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // 落库生效 = 走的确实是 batch 端点(action 分支里没有批量暂停这回事)
    expect((await env.DB.prepare('SELECT paused FROM monitors WHERE id = ?').bind(id).first<{ paused: number }>())?.paused).toBe(1);
  });

  it('?action=pause 暂停与恢复', async () => {
    const paused = await call(`/monitors/${id}?action=pause`, postJson({ paused: 1 }));
    expect(paused.status).toBe(200);
    expect(await paused.json()).toEqual({ success: true, paused: true });

    const resumed = await call(`/monitors/${id}?action=pause`, postJson({ paused: 0 }));
    expect(await resumed.json()).toEqual({ success: true, paused: false });
    expect((await env.DB.prepare('SELECT paused FROM monitors WHERE id = ?').bind(id).first<{ paused: number }>())?.paused).toBe(0);
  });

  it('不传 body 时按当前状态取反', async () => {
    const first = await call(`/monitors/${id}?action=pause`, { method: 'POST', headers: { Authorization: 'Bearer test-admin-key' } });
    expect(await first.json()).toEqual({ success: true, paused: true });
    const second = await call(`/monitors/${id}?action=pause`, { method: 'POST', headers: { Authorization: 'Bearer test-admin-key' } });
    expect(await second.json()).toEqual({ success: true, paused: false });
  });

  it('缺失或未知的 action 报 400', async () => {
    const missing = await call(`/monitors/${id}`, { method: 'POST', headers: { Authorization: 'Bearer test-admin-key' } });
    expect(missing.status).toBe(400);

    const bogus = await call(`/monitors/${id}?action=bogus`, { method: 'POST', headers: { Authorization: 'Bearer test-admin-key' } });
    expect(bogus.status).toBe(400);
  });

  it('?action=check 对不存在的监控返回 404', async () => {
    const res = await call('/monitors/999999?action=check', { method: 'POST', headers: { Authorization: 'Bearer test-admin-key' } });
    expect(res.status).toBe(404);
  });

  /* --------------------------- /incidents 的两种口径 --------------------------- */

  it('默认口径免鉴权,?status=all 需鉴权', async () => {
    expect((await call('/incidents')).status).toBe(200);
    expect((await call('/incidents?status=active')).status).toBe(200);
    // 全量含已解决的历史事件,是管理视角,不能让状态页匿名读到
    expect((await call('/incidents?status=all')).status).toBe(401);
    expect((await call('/incidents?status=all', auth)).status).toBe(200);
  });

  it('?status= 非法值报 400,不静默退化成 active', async () => {
    const res = await call('/incidents?status=All', auth);
    expect(res.status).toBe(400);
  });

  /* ---------------------------- 子动作 action 化 ---------------------------- */

  it('通知渠道的测试动作', async () => {
    // 渠道不存在时先判 404,而不是落到 action 校验上
    const res = await call('/notification-channels/999999?action=test', { method: 'POST', headers: { Authorization: 'Bearer test-admin-key' } });
    expect(res.status).toBe(404);
  });

  it('模板的 duplicate / default 动作', async () => {
    const headers = { Authorization: 'Bearer test-admin-key' };
    // duplicate 要复制源版本,源不存在必须报错
    expect((await call('/alert-templates/999999?action=duplicate', { method: 'POST', headers })).status).toBe(404);
    // default 只是改指向,没有对应行时是空操作(与合并前 /:id/default 的行为一致)
    expect((await call('/alert-templates/999999?action=default', { method: 'POST', headers })).status).toBe(200);
    expect((await call('/alert-templates/999999?action=bogus', { method: 'POST', headers })).status).toBe(400);
  });

  /* ---------------------------- 备份用 method 区分 ---------------------------- */

  it('GET 导出、POST 恢复,同一个 /backup', async () => {
    const exported = await call('/backup', auth);
    expect(exported.status).toBe(200);
    expect(exported.headers.get('Content-Disposition')).toContain('attachment');

    // 缺 data.monitors 视为格式不对
    const bad = await call('/backup', postJson({ nope: true }));
    expect(bad.status).toBe(400);
  });
});
