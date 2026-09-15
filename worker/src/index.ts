// ============================================================
// MonitorFlare — Cloudflare Worker 主入口
// 基于 Uptime-Monitor(MIT)分发的增强版
// ============================================================
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings, Incident, Monitor, NotificationChannel } from './types';
import { updateDomainCertInfo, normalizeMonitorUrl } from './checks';
import { CHANNEL_TYPES, EMAIL_PROVIDERS } from './channels';
import { ensureInitialized, getSetting, getTimezone, getSettingsMap, DEFAULT_SETTINGS } from './init';
import { localHourAgo, tzModifier } from './datetime';
import { cached, invalidate, PUBLIC_CACHE, PRIVATE_CACHE } from './cache';
import { buildMonitorStats } from './stats';
import {
  createSessionToken, createOAuthState, verifyOAuthState, verifySessionToken,
  verifyAdminCredential, verifyMagicLinkToken, createMagicLinkToken,
  verifyCfAccessToken, verifyApiKey, hashApiKey,
  createStatusToken, verifyStatusToken, hashStatusPassword,
} from './auth';
import {
  getAllowedOrigins, isLocalOrigin, getAuthSecret, isValidEmail,
  maskChannelConfig, randomToken, safeEqual,
} from './utils';
import { MONITOR_COLUMNS } from './sql';
import { escapeXml, safeCompare, maskMonitorSensitive, isSensitiveSettingKey } from './utils/http';
import { runScheduledTasks, performMonitorCheck } from './scheduler';
import { sendTestAlert } from './services/alert';
import {
  listTemplateVersions, createTemplateVersion, updateTemplateVersion, deleteTemplateVersion,
  duplicateTemplateVersion, setDefaultVersion, normalizePayload,
} from './services/template-store';
import { parseTemplatePayload } from './services/template';
import type { AlertTemplatePayload, AlertTemplateVersion } from './types';
import { notifySubscribers, getEmailConfigForLogin, sendLoginEmail } from './services/email';

// ============================================================
// Hono 应用
// ============================================================
const app = new Hono<{ Bindings: Bindings }>();

// ── 公开接口的缓存策略 ──
// 30 秒:与前端轮询周期同量级,再长会让故障状态在状态页上迟到。
const PUBLIC_TTL_MS = 30_000;

/** 站点是否为公开模式。私密站点的响应不能进 CDN 等共享缓存 */
async function isPublicSite(env: Bindings): Promise<boolean> {
  return (await getSetting(env, 'status_page_visibility')) !== 'private';
}

// 全局错误处理：未捕获的异常统一转成 JSON 并写日志。
// 没有它的话，运行时异常只会返回一个没有任何信息的 Cloudflare 1101 错误页。
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
});

app.use('/*', cors({
  origin: (origin, c) => {
    const allowed = getAllowedOrigins(c.env);
    if (allowed.length === 0) return origin && isLocalOrigin(origin) ? origin : '';
    if (!origin) return allowed[0];
    return allowed.includes(origin) ? origin : '';
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// 鉴权中间件
//
// 这里的路径都是剥掉 /api 前缀之后的形态(见文件末尾的 stripApiPrefix),
// 所以 /api/status 与 /status 只需写一次裸路径。
const PUBLIC_PATHS = [
  '/auth/', '/status', '/feed.xml', '/subscribe', '/unsubscribe', '/webhooks/',
];
const PROTECTED_PREFIXES = ['/monitors', '/notification-channels', '/alert-templates', '/incidents', '/settings', '/test-alert', '/health', '/api-keys', '/backup', '/v1'];

// 私密模式下需锁定的公开接口(前缀匹配)
const STATUS_LOCK_PATHS = [
  '/incidents', '/settings', '/feed.xml', '/status', '/subscribe', '/unsubscribe',
];
// 私密模式下始终放行(登录/管理认证)
const STATUS_LOCK_EXEMPT = ['/status/login', '/auth/', '/webhooks/'];

/**
 * 公开口径的监控读取:GET /monitors?scope=public。
 *
 * /monitors/public 并进 /monitors 之后,"这一读是公开还是管理"不再体现在路径上,
 * 只能看参数 —— 免鉴权放行与私密模式锁定都得用同一个判断,否则两处会各说各话。
 */
function isPublicMonitorRead(req: { path: string; method: string; query: (k: string) => string | undefined }): boolean {
  if (req.path !== '/monitors' || req.method !== 'GET') return false;
  const scope = req.query('scope');
  // 凡是带着 scope 来的,都算冲着公开口径。非法取值也要放给 handler 去报 400:
  // 挡在鉴权层的话,写错 scope 的人只会收到 401,看不出是参数拼错了。
  return scope !== undefined && scope !== '';
}

app.use('/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return await next();
  const path = c.req.path;

  // 初始化自检(幂等,首次访问自动建表)。
  // 建表或读设置失败都不应该让整个 API 变成 1101：降级为默认公开可见性,并把真实错误写进日志。
  let visibility = 'public';
  try {
    await ensureInitialized(c.env);
    visibility = await getSetting(c.env, 'status_page_visibility') || 'public';
  } catch (err) {
    console.error('Database init/settings read failed:', err);
  }

  // 私密模式:锁定状态页公开接口
  if (visibility === 'private'
    && !STATUS_LOCK_EXEMPT.some(p => path.startsWith(p))
    && (isPublicMonitorRead(c.req) || STATUS_LOCK_PATHS.some(p => path === p || path.startsWith(p + '/')))) {
    const authHeader = c.req.header('Authorization');
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : '';
    if (token) {
      const pwHash = await getSetting(c.env, 'status_page_password');
      if (pwHash && (await verifyStatusToken(c.env, token, pwHash) || await verifySessionToken(c.env, token))) {
        return await next();
      }
    }
    return c.json({ error: 'status_page_locked' }, 401);
  }

  // 公开路由豁免
  if (PUBLIC_PATHS.some(p => path.startsWith(p))) return await next();
  // GET /incidents 默认口径是"进行中的事件",状态页直接读,免鉴权;
  // ?status=all 是管理口径(含已解决的历史事件),不能靠路径判断了,必须往下走鉴权。
  if (path === '/incidents' && c.req.method === 'GET' && c.req.query('status') !== 'all') return await next();
  // 状态页读监控走 ?scope=public,免鉴权;缺省的管理口径不在这里放行。
  if (isPublicMonitorRead(c.req)) return await next();
  if (path === '/settings' && c.req.method === 'GET') return await next();

  const needsAuth = PROTECTED_PREFIXES.some(r => path.startsWith(r));
  if (!needsAuth) return await next();

  // 1) Cloudflare Access JWT
  const cfJwt = c.req.header('Cf-Access-Jwt-Assertion');
  if (cfJwt && await verifyCfAccessToken(c.env, cfJwt)) return await next();

  const authHeader = c.req.header('Authorization');
  if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);
  const token = authHeader.replace(/^Bearer\s+/i, '');

  // 2) 会话 token
  if (await verifySessionToken(c.env, token)) return await next();
  // 3) 管理员凭据(兼容上游)
  if (await verifyAdminCredential(c.env, token)) return await next();
  // 4) 第三方 API 密钥
  if (await verifyApiKey(c.env, token)) return await next();

  if (!getAuthSecret(c.env)) return c.json({ error: 'Admin auth is not configured' }, 503);
  return c.json({ error: 'Unauthorized: Invalid credentials' }, 401);
});

// ============================================================
// 认证路由
// ============================================================
app.post('/auth/login', async (c) => {
  try {
    const body = await c.req.json<{ password?: string }>();
    if (!body.password) return c.json({ error: 'Password is required' }, 400);
    if (!getAuthSecret(c.env)) return c.json({ error: 'Admin auth is not configured' }, 503);
    if (!await verifyAdminCredential(c.env, body.password)) return c.json({ error: 'Invalid password' }, 401);
    return c.json(await createSessionToken(c.env));
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// Magic Link:发起
app.post('/auth/magic-link', async (c) => {
  try {
    const body = await c.req.json<{ email?: string }>();
    const email = (body.email || '').trim();
    if (!isValidEmail(email)) return c.json({ error: 'Valid email is required' }, 400);
    // 始终返回成功(防枚举)
    try {
      const token = await createMagicLinkToken(c.env, email);
      const base = (c.env.BASE_URL || '').replace(/\/$/, '');
      const link = `${base}/#/magic?token=${encodeURIComponent(token)}`;
      const emailCfg = await getEmailConfigForLogin(c.env);
      if (emailCfg) {
        const html = `<p>Click <a href="${link}">here</a> to sign in. This link expires in 10 minutes.</p>`;
        await sendLoginEmail(c.env, emailCfg, email, 'Sign in to MonitorFlare', html);
      } else {
        console.warn('No email channel configured for magic link delivery');
      }
    } catch (e) {
      console.error('Magic link error:', e);
    }
    return c.json({ success: true });
  } catch {
    return c.json({ success: true });
  }
});

// Magic Link:验证
app.get('/auth/magic-link/verify', async (c) => {
  try {
    const token = c.req.query('token') || '';
    const email = await verifyMagicLinkToken(c.env, token);
    if (!email) return c.json({ error: 'Invalid or expired link' }, 401);
    return c.json(await createSessionToken(c.env));
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// OAuth 发起
app.get('/auth/oauth/:provider', async (c) => {
  const provider = c.req.param('provider');
  const state = await createOAuthState(c.env);
  const base = (c.env.BASE_URL || '').replace(/\/$/, '');
  const redirectUri = `${base}/api/auth/oauth/callback/${provider}`;
  try {
    if (provider === 'google' && c.env.GOOGLE_CLIENT_ID) {
      const params = new URLSearchParams({
        client_id: c.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri,
        response_type: 'code', scope: 'openid email profile', state,
      });
      return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    }
    if (provider === 'github' && c.env.GITHUB_CLIENT_ID) {
      const params = new URLSearchParams({
        client_id: c.env.GITHUB_CLIENT_ID, redirect_uri: redirectUri, scope: 'read:user user:email', state,
      });
      return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
    }
    return c.json({ error: 'Unsupported provider or not configured' }, 400);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// OAuth 回调
//
// 只注册裸路径,/api/auth/... 由 stripApiPrefix 重写过来。
// 注意上面构造的 redirect_uri 仍然带 /api 前缀:它已经配在 Google / GitHub 的应用里,
// 改了会让所有现有部署的登录立刻失败,所以对外契约不动,只在入口处做重写。
app.get('/auth/oauth/callback/:provider', async (c) => {
  const provider = c.req.param('provider');
  const code = c.req.query('code') || '';
  const state = c.req.query('state') || '';
  if (!await verifyOAuthState(c.env, state)) return c.json({ error: 'Invalid state' }, 401);
  if (!code) return c.json({ error: 'Missing code' }, 400);
  const base = (c.env.BASE_URL || '').replace(/\/$/, '');
  const redirectUri = `${base}/api/auth/oauth/callback/${provider}`;
  try {
    let email = '';
    if (provider === 'google') {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: c.env.GOOGLE_CLIENT_ID || '', client_secret: c.env.GOOGLE_CLIENT_SECRET || '',
          redirect_uri: redirectUri, grant_type: 'authorization_code',
        }).toString(),
      });
      if (!tokenRes.ok) return c.json({ error: 'OAuth token exchange failed' }, 401);
      const tokenData = await tokenRes.json<{ access_token?: string }>();
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
      });
      if (userRes.ok) {
        const user = await userRes.json<{ email?: string }>();
        email = user.email || '';
      }
    } else if (provider === 'github') {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ code, client_id: c.env.GITHUB_CLIENT_ID, client_secret: c.env.GITHUB_CLIENT_SECRET, redirect_uri: redirectUri }),
      });
      if (!tokenRes.ok) return c.json({ error: 'OAuth token exchange failed' }, 401);
      const tokenData = await tokenRes.json<{ access_token?: string }>();
      const userRes = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'User-Agent': 'MonitorFlare' },
      });
      if (userRes.ok) {
        const user = await userRes.json<{ email?: string; login?: string }>();
        email = user.email || `${user.login}@users.noreply.github.com`;
      }
    }
    if (!email) return c.json({ error: 'Could not retrieve email' }, 401);
    // 签发会话,重定向回前端
    const session = await createSessionToken(c.env);
    const frontUrl = (c.env.ALLOWED_ORIGIN || '').split(',')[0] || base;
    return c.redirect(`${frontUrl}/#/admin?token=${encodeURIComponent(session.token)}`);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// ============================================================
// 监控 CRUD
// ============================================================
/**
 * 管理端监控列表,同时是日志与统计的入口。
 *
 * 列表 / 日志 / 90 天可用率原本是三个端点(/monitors、/monitors/:id/logs、
 * /monitors/:id/stats),口径不同但查的是同一批数据,合并后靠参数区分:
 *   /monitors                                → { monitors: [...] }
 *   /monitors?id=3                           → 只要这一个(可逗号分隔多个)
 *   /monitors?id=3&include=logs&limit=50     → 多带一份 { logs: { 3: [...] } }
 *   /monitors?include=stats                  → 多带一份 { stats: { id: {...} } }
 *
 * 公开口径也在这条地址上,由 ?scope=public 切过去(状态页免鉴权读):
 *   ?scope=public                            → 公开清单
 *   ?scope=public&detail=1                   → 清单 + 可用率与延迟
 *   ?scope=public&view=detail&id=3           → 单个监控的详情对象(日志/曲线/事件)
 */
app.get('/monitors', async (c) => {
  const scope = c.req.query('scope');
  // 拼错要报出来:否则 scope=Public 会静默落到管理口径上,状态页直接吃一个 401
  if (scope !== undefined && scope !== '' && scope !== 'public') {
    return c.json({ error: 'Invalid scope. Use scope=public or omit it' }, 400);
  }
  if (scope === 'public') {
    if (c.req.query('view') === 'detail') {
      const detailIds = parseIdList(c.req.query('id'), c.req.query('ids'));
      // 详情返回的是单个监控的对象,给多个 id 没有对应的形状
      if (detailIds === 'invalid' || !detailIds || detailIds.length !== 1) {
        return c.json({ error: 'Invalid monitor id' }, 400);
      }
      return handlePublicDetail(c, detailIds[0]);
    }
    return handlePublicList(c, isDetailRequested(c.req.query('detail')));
  }
  try {
    const ids = parseIdList(c.req.query('id'), c.req.query('ids'));
    if (ids === 'invalid') return c.json({ error: 'Invalid monitor id' }, 400);

    const include = (c.req.query('include') || '').split(',').map(s => s.trim()).filter(Boolean);
    const unknown = include.filter(v => v !== 'logs' && v !== 'stats');
    if (unknown.length > 0) return c.json({ error: `Unknown include: ${unknown.join(', ')}` }, 400);
    const wantLogs = include.includes('logs');
    const wantStats = include.includes('stats');
    // limit/offset 只作用于日志。跨监控时它是整个结果集的分页,
    // 不是"每个监控各取 N 条" —— 后者要么 N 次查询要么窗口函数,不值当。
    const limit = Math.min(Math.max(Number(c.req.query('limit') || 50), 1), 500);
    const offset = Math.max(Number(c.req.query('offset') || 0), 0);

    const scope = ids || [];
    const whereSql = scope.length > 0 ? `WHERE id IN (${scope.map(() => '?').join(',')})` : '';
    const { results } = await c.env.DB.prepare(
      `SELECT ${MONITOR_COLUMNS} FROM monitors ${whereSql} ORDER BY sort_order ASC, created_at ASC`
    ).bind(...scope).all<Monitor>();
    const monitors = results || [];

    type LogRow = { id: number; monitor_id: number; status_code: number | null; latency: number | null; is_fail: number; reason: string | null; created_at: string };
    let logs: Record<number, LogRow[]> | undefined;
    if (wantLogs) {
      logs = {};
      for (const m of monitors) logs[m.id] = [];
      const inScope = monitors.map(m => m.id);
      if (inScope.length > 0) {
        const { results: rows } = await c.env.DB.prepare(
          `SELECT id, monitor_id, status_code, latency, is_fail, reason, created_at FROM logs WHERE monitor_id IN (${inScope.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).bind(...inScope, limit, offset).all<LogRow>();
        for (const r of rows || []) logs[r.monitor_id]?.push(r);
      }
    }

    let stats: Record<number, { uptime_24h: number | null; uptime_7d: number | null; uptime_30d: number | null; uptime_90d: number | null; avg_latency: number | null }> | undefined;
    if (wantStats) {
      const tz = await getTimezone(c.env);
      const built = await buildMonitorStats(c.env, monitors.map(m => m.id), tz, 90);
      stats = {};
      for (const m of monitors) {
        const s = built.get(m.id);
        stats[m.id] = {
          uptime_24h: s?.uptime_24h ?? null,
          uptime_7d: s?.uptime_7d ?? null,
          uptime_30d: s?.uptime_30d ?? null,
          uptime_90d: s?.uptime_90d ?? null,
          avg_latency: m.last_latency ?? null,
        };
      }
    }

    return c.json({ monitors, ...(logs && { logs }), ...(stats && { stats }) });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

/**
 * 解析 ?id= 与 ?ids=(监控 id 过滤),/monitors 与 /monitors/public 共用。
 *
 * 两个参数等价且可同时出现(id 单个、ids 多个),解析后合并去重。
 * 返回 null = 没传,不过滤(全量列表);数组 = 按这些 id 过滤;'invalid' = 参数不合法。
 * 上限是为了不让 ?ids= 被当成"一次把整表拉出来"的放大器 —— 真要全量就别传参数。
 */
const MAX_ID_FILTER = 50;
function parseIdList(id?: string, ids?: string): number[] | null | 'invalid' {
  const raw = [id, ids].filter(v => v !== undefined && v !== '').join(',');
  if (!raw.trim()) return null;
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null; // 只有分隔符,等同于没传
  const out: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n <= 0) return 'invalid';
    if (!out.includes(n)) out.push(n);
  }
  return out.length > MAX_ID_FILTER ? 'invalid' : out;
}

// 公开列表的两套字段:简要(清单)与含统计(详情)。后者是前者的超集,
// 差别只在 last_latency / created_at 两列,统计字段在 handlePublicList 里补。
const PUBLIC_MONITOR_COLUMNS = 'id, name, url, type, status, last_check, cert_expiry, domain_expiry, paused, tags, check_ssl';
const PUBLIC_DETAIL_COLUMNS = 'id, name, url, type, status, last_check, last_latency, cert_expiry, domain_expiry, paused, tags, check_ssl, created_at';

/** ?detail= 的开关语义:给了非空且不是 0 / false 的值,就算"要统计字段" */
function isDetailRequested(v?: string): boolean {
  return !!v && v !== '0' && v.toLowerCase() !== 'false';
}

/**
 * 公开列表(可选带统计字段),由 /monitors/public 与旧的 /monitors/public/details 共用。
 *
 * 这是全站最热的接口(状态页和管理页都每 30 秒轮询它),所以读路径上只允许出现
 * "与监控数量成正比"的查询:monitors 一次 + 小时桶(每个监控 ≤25 行)+ 日聚合桶
 * (90 行/监控,但按天缓存 10 分钟)。任何"扫 logs 原始表"的写法都会让这里的
 * 读行数随历史数据量线性膨胀 —— 那正是原来几分钟烧完日额度的原因。
 *
 * detail 为假时返回数组(老调用方行为不变),为真时返回 { monitors: [...] }。
 */
async function handlePublicList(c: Context<{ Bindings: Bindings }>, detail: boolean) {
  const ids = parseIdList(c.req.query('id'), c.req.query('ids'));
  if (ids === 'invalid') return c.json({ error: 'Invalid monitor id' }, 400);

  // placeholders 由数字个数生成,不含外部输入,拼接是安全的;值一律 bind 传入
  const columns = detail ? PUBLIC_DETAIL_COLUMNS : PUBLIC_MONITOR_COLUMNS;
  const query = () => ids
    ? c.env.DB.prepare(
      `SELECT ${columns} FROM monitors WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY sort_order ASC, created_at ASC`
    ).bind(...ids).all()
    : c.env.DB.prepare(
      `SELECT ${columns} FROM monitors ORDER BY sort_order ASC, created_at ASC`
    ).all();

  try {
    if (!detail) {
      const { results } = await query();
      return c.json(results);
    }

    // 缓存 key 必须带上 id 集合:否则 ?id=1 会命中全量那份缓存,返回不相干的数据
    const payload = await cached(`publicDetails:${ids ? ids.join(',') : 'all'}`, PUBLIC_TTL_MS, async () => {
      const { results: monitors } = await query();
      if (!monitors || monitors.length === 0) return { monitors: [] };

      // 全站"按天"口径:跟随设置里的时区(默认 Asia/Shanghai),与每日聚合、前端日期轴一致
      const tz = await getTimezone(c.env);
      const stats = await buildMonitorStats(c.env, monitors.map(m => m.id as number), tz, 90);

      const enriched = monitors.map(m => {
        const s = stats.get(m.id as number);
        return {
          ...m,
          latency: (m.last_latency as number | null) ?? null,
          uptime_24h: s?.uptime_24h ?? null,
          uptime_7d: s?.uptime_7d ?? null,
          uptime_30d: s?.uptime_30d ?? null,
          // 列表也带上 90 天:详情页拿它做首屏预填,不用等详情请求回来才补上这一格
          uptime_90d: s?.uptime_90d ?? null,
          daily_stats: s?.daily_stats ?? [],
          recent_latencies: s?.recent_latencies ?? [],
        };
      });
      return { monitors: enriched };
    });
    // 私密站点不能进任何共享缓存;鉴权在中间件里做,内存缓存不会越权泄漏
    c.header('Cache-Control', await isPublicSite(c.env) ? PUBLIC_CACHE : PRIVATE_CACHE);
    return c.json(payload);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
}

// 公开口径的注册点已搬到 GET /monitors?scope=public 里。/monitors/public、
// /monitors/public/details 这两个老地址由入口的重写表映射过去,这里不再注册。

/**
 * 单监控公开详情:基础信息 + uptime + 90 天历史 + 日志 + 延迟曲线 + 事件。
 *
 * 刻意与列表接口分开:这里返回的是单个监控的对象,日志(≤200 行)与延迟曲线
 * (≤1500 点)只有在点开某一个监控时才用得上。塞进列表会让状态页首屏一次拉
 * N 倍数据,缓存键也会变成 id 集合 × range × limit 的组合爆炸。
 */
async function handlePublicDetail(c: Context<{ Bindings: Bindings }>, id: number) {
  try {
    const range = c.req.query('range') || '24h';
    const limit = Math.min(Math.max(Number(c.req.query('limit') || 50), 1), 200);

    const payload = await cached(`publicDetail:${id}:${range}:${limit}`, PUBLIC_TTL_MS, async () => {
      const monitor = await c.env.DB.prepare(
        'SELECT id, name, url, type, status, last_check, last_latency, cert_expiry, domain_expiry, paused, tags, check_ssl, method, interval, keyword, created_at FROM monitors WHERE id = ?'
      ).bind(id).first();
      if (!monitor) return null;

      // 全站"按天"口径:跟随设置里的时区(默认 Asia/Shanghai),与每日聚合、前端日期轴一致
      const tz = await getTimezone(c.env);
      const stats = (await buildMonitorStats(c.env, [id], tz, 90)).get(id);

      const hours = range === '7d' ? 168 : range === '30d' ? 720 : 24;
      const maxPts = range === '7d' ? 1000 : range === '30d' ? 1500 : 288;
      let rawSeries: { created_at: string; latency: number }[];
      if (range === '24h') {
        // 单监控 24 小时只有几百行,直接读原始点,曲线保留真实密度
        const { results } = await c.env.DB.prepare(
          'SELECT created_at, latency FROM logs WHERE monitor_id = ? AND is_fail = 0 AND created_at >= datetime(\'now\', ?) ORDER BY created_at ASC'
        ).bind(id, `-${hours} hours`).all();
        rawSeries = (results || []).map(r => ({ created_at: r.created_at as string, latency: r.latency as number }));
      } else {
        // 7d/30d 读小时桶:168/720 行,而不是 2 千/8 千行原始点
        const { results } = await c.env.DB.prepare(
          'SELECT hour, total, fails, latency_sum FROM monitor_hourly WHERE monitor_id = ? AND hour >= ? ORDER BY hour ASC'
        ).bind(id, localHourAgo(tz, hours)).all();
        rawSeries = (results || [])
          .filter(r => (Number(r.total) || 0) > (Number(r.fails) || 0))
          .map(r => ({
            created_at: `${String(r.hour).replace('T', ' ')}:00:00`,
            latency: Math.round(Number(r.latency_sum) / (Number(r.total) - Number(r.fails))),
          }));
      }
      const step = rawSeries.length > maxPts ? Math.ceil(rawSeries.length / maxPts) : 1;
      const latencySeries: { created_at: string; latency: number }[] = [];
      for (let i = 0; i < rawSeries.length; i += step) latencySeries.push(rawSeries[i]);

      const { results: logs } = await c.env.DB.prepare(
        'SELECT id, created_at, status_code, latency, is_fail, reason FROM logs WHERE monitor_id = ? ORDER BY created_at DESC LIMIT ?'
      ).bind(id, limit).all();

      const { results: allIncidents } = await c.env.DB.prepare(
        'SELECT id, title, description, severity, status, type, scheduled_start, scheduled_end, affected_monitors, created_at, updated_at, resolved_at FROM incidents ORDER BY created_at DESC LIMIT 50'
      ).all<Incident>();
      const incidents = (allIncidents || []).filter(inc => {
        if (!inc.affected_monitors) return false;
        return inc.affected_monitors.split(',').map(x => x.trim()).filter(Boolean).includes(String(id));
      });

      const enriched = {
        ...monitor,
        latency: (monitor.last_latency as number | null) ?? null,
        uptime_24h: stats?.uptime_24h ?? null,
        uptime_7d: stats?.uptime_7d ?? null,
        uptime_30d: stats?.uptime_30d ?? null,
        uptime_90d: stats?.uptime_90d ?? null,
        daily_stats: stats?.daily_stats ?? [],
      };

      return { monitor: enriched, logs: logs || [], latency_series: latencySeries, incidents };
    });

    if (!payload) return c.json({ error: 'Monitor not found' }, 404);
    c.header('Cache-Control', await isPublicSite(c.env) ? PUBLIC_CACHE : PRIVATE_CACHE);
    return c.json(payload);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
}

// 单监控详情同样搬到了 ?scope=public&view=detail&id=;/monitors/public/detail 与
// /monitors/public/:id 两个老地址同样交给重写表。

/**
 * 成员操作的目标 id。
 *
 * 各资源的 /xxx/:id 收进 /xxx 之后,"操作哪一个"不再体现在路径上,只能从 ?id= 读。
 * 缺 id 或 id 不合法必须挡在任何写操作之前 —— 否则一次误请求会打到整张表上。
 */
function targetId(c: Context<{ Bindings: Bindings }>): number | null {
  const n = Number(c.req.query('id'));
  return Number.isInteger(n) && n > 0 ? n : null;
}

app.post('/monitors', async (c) => {
  const action = c.req.query('action') || '';
  // 批量操作:与"创建单个"同是对集合的写,合并后靠 ?action=batch 区分
  if (action === 'batch') return handleMonitorBatch(c);
  // 单个监控的手动动作:目标由 ?id= 指认,不再占 /monitors/:id 这条路径
  if (action === 'check' || action === 'pause') {
    const id = targetId(c);
    if (id === null) return c.json({ error: 'id is required. Use ?action=' + action + '&id=1' }, 400);
    return handleMonitorAction(c, action, id);
  }
  // 拼错的 action 不能静默当成"新建":那会凭空多出一条监控
  if (action !== '') {
    return c.json({ error: 'Invalid action. Use ?action=batch, ?action=check or ?action=pause' }, 400);
  }
  // ?id= 只用来指认成员操作的目标,出现在新建请求上是调用方写错了 ——
  // 旧地址 /monitors/:id 落到这里也是这个分支,不能让它变成"新建一条监控"
  if (c.req.query('id') !== undefined) {
    return c.json({ error: 'id is only valid with ?action=check or ?action=pause' }, 400);
  }
  try {
    const body = await c.req.json<Partial<Monitor>>();
    const { name, keyword, user_agent, tags, request_headers, request_body } = body;
    if (!name || !body.url) return c.json({ error: 'Missing name or url' }, 400);
    const url = normalizeMonitorUrl(body.url);
    const type = (['dns', 'port'].includes(body.type || '') ? body.type : 'http') as Monitor['type'];
    // URL 基础格式校验:http 用 URL 解析,dns/port 只挡空白字符
    if (type === 'http') {
      try { new URL(url); } catch { return c.json({ error: 'Invalid url' }, 400); }
    } else if (/\s/.test(url)) {
      return c.json({ error: 'Invalid url' }, 400);
    }
    const method = (body.method || 'GET').toUpperCase();
    const config = body.config || null;
    // 端口监控:port 必须为 1-65535 的整数
    if (type === 'port') {
      let port: unknown = null;
      try { port = typeof config === 'string' ? JSON.parse(config).port : (config as Record<string, unknown>)?.port; } catch { /* ignore */ }
      const portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        return c.json({ error: 'Invalid port (must be 1-65535)' }, 400);
      }
    }
    const alertAfterFailures = Number(body.alert_after_failures) > 0 ? Number(body.alert_after_failures) : 1;
    // 检测频率 clamp 到 [60, 86400] 秒,防止 0/负值造成轮询风暴
    const intervalClamped = Math.min(Math.max(Math.round(Number(body.interval) || 300), 60), 86400);
    const checkSsl = body.check_ssl === 0 ? 0 : 1;
    const checkDomain = body.check_domain === 0 ? 0 : 1;
    const alertErrorRate = Math.min(Math.max(Number(body.alert_error_rate) || 0, 0), 100);
    const legacy = body as Record<string, unknown>;
    const alertSilenceUptime = Math.min(Math.max(Number(body.alert_silence_uptime ?? legacy.alert_silence_hours) || 24, 1), 720);
    const alertLatencyMs = Math.min(Math.max(Math.round(Number(body.alert_latency_ms) || 0), 0), 600000);

    const result = await c.env.DB.prepare(
      `INSERT INTO monitors (name, url, type, config, method, interval, keyword, user_agent, tags, request_headers, request_body, alert_after_failures, check_ssl, check_domain, alert_error_rate, alert_silence_uptime, alert_latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      name, url, type, config, method,
      intervalClamped, keyword || null, user_agent || null, tags || null,
      request_headers || null, request_body || null, alertAfterFailures,
      checkSsl, checkDomain, alertErrorRate, alertSilenceUptime, alertLatencyMs
    ).run();

    const newId = result.meta.last_row_id as number;

    // 创建后的首次初始化:立刻探测一次,让新监控马上就有延迟/状态数据,
    // 而不必等到下一个调度周期(最长可能是一整个 interval)。与证书/域名抓取串行执行。
    c.executionCtx.waitUntil((async () => {
      const { results } = await c.env.DB.prepare(`SELECT ${MONITOR_COLUMNS} FROM monitors WHERE id = ?`)
        .bind(newId).all<Monitor>();
      const created = results[0];
      if (!created) return;

      // 1) 首次探测(暂停中的监控跳过)
      if (created.paused !== 1) {
        try { await performMonitorCheck(created, c.env); }
        catch (err) { console.error('Initial check failed:', err); }
      }

      // 2) 首次抓取证书/域名信息
      if (type === 'http' && (body.check_ssl !== 0 || body.check_domain !== 0)) {
        try {
          await c.env.DB.prepare('UPDATE monitors SET check_info_status = ? WHERE id = ?')
            .bind(new Date().toISOString(), newId).run();
          await updateDomainCertInfo(c.env, created);
        } catch (err) { console.error('Initial cert check failed:', err); }
      }
    })());

    // 公开快照里要立刻多出这一条,否则访客最多要等一个 TTL 才看得到
    invalidate('public');
    return c.json({ success: true, id: newId }, 201);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.delete('/monitors', async (c) => {
  const id = targetId(c);
  // 没有目标就拒绝:DELETE 打到集合上等于清空整张表,不能靠"误传"触发
  if (id === null) return c.json({ error: 'id is required. Use ?id=1' }, 400);
  try {
    // 级联删掉派生数据,否则孤儿行会一直占用日聚合/小时桶并污染备份
    await c.env.DB.prepare('DELETE FROM logs WHERE monitor_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM monitor_hourly WHERE monitor_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM daily_uptime WHERE monitor_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM monitors WHERE id = ?').bind(id).run();
    invalidate('public');
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

/**
 * 改某一个监控的配置。
 *
 * 目标几经收敛:/monitors/:id/config → /monitors/:id → /monitors?id=。
 * 到这一步监控相关只剩 /monitors 这一条地址,成员与集合的差别全在 ?id= 上。
 */
app.patch('/monitors', async (c) => {
  const id = targetId(c);
  if (id === null) return c.json({ error: 'id is required. Use ?id=1' }, 400);
  try {
    const body = await c.req.json<Partial<Monitor>>();
    const fields: string[] = [];
    const values: unknown[] = [];
    const simpleMap: [string, keyof Monitor][] = [
      ['name', 'name'], ['url', 'url'], ['method', 'method'], ['interval', 'interval'],
      ['keyword', 'keyword'], ['user_agent', 'user_agent'], ['tags', 'tags'],
      ['request_headers', 'request_headers'], ['request_body', 'request_body'],
      ['check_ssl', 'check_ssl'], ['check_domain', 'check_domain'],
      ['alert_silence_uptime', 'alert_silence_uptime'], ['alert_silence_ssl', 'alert_silence_ssl'],
      ['alert_silence_domain', 'alert_silence_domain'], ['alert_error_rate', 'alert_error_rate'],
      ['alert_after_failures', 'alert_after_failures'], ['paused', 'paused'],
      ['alert_latency_ms', 'alert_latency_ms'],
      // 告警判定口径的监控级覆盖:留空 = 跟随站点设置
      ['alert_error_rate_window', 'alert_error_rate_window'],
      ['alert_error_rate_min_samples', 'alert_error_rate_min_samples'],
      ['alert_error_rate_silence', 'alert_error_rate_silence'],
      ['alert_latency_silence', 'alert_latency_silence'],
    ];
    /** 这四项允许显式清空:传 null / '' / 0 表示"去掉覆盖,跟随全局规则" */
    const CLEARABLE_NUMERIC: (keyof Monitor)[] = [
      'alert_error_rate_window', 'alert_error_rate_min_samples',
      'alert_error_rate_silence', 'alert_latency_silence',
    ];
    // 数值字段范围钳制,防止 0/负值造成轮询风暴等异常行为
    const NUMERIC_CLAMP: Partial<Record<keyof Monitor, [number, number]>> = {
      interval: [60, 86400],
      alert_silence_uptime: [1, 720],
      alert_silence_ssl: [1, 720],
      alert_silence_domain: [1, 720],
      alert_error_rate: [0, 100],
      alert_after_failures: [1, 100],
      alert_latency_ms: [0, 600000],
      alert_error_rate_window: [1, 1440],
      alert_error_rate_min_samples: [1, 1000],
      alert_error_rate_silence: [1, 10080],
      alert_latency_silence: [1, 10080],
    };
    const VALID_METHODS = ['GET', 'POST', 'HEAD', 'PUT'];
    for (const [dbField, key] of simpleMap) {
      const v = body[key];
      if (v === undefined) continue;
      // 覆盖值清空要走到 UPDATE ... = NULL,所以必须排在"跳过 null"之前
      if (CLEARABLE_NUMERIC.includes(key) && (v === null || v === '' || Number(v) <= 0)) {
        fields.push(`${dbField} = NULL`);
        continue;
      }
      if (v === null) continue;
      // name/url 不允许清空为空字符串
      if ((key === 'name' || key === 'url') && String(v).trim() === '') continue;
      let out: unknown = v;
      const range = NUMERIC_CLAMP[key];
      if (range) {
        const n = Math.round(Number(v));
        if (!Number.isFinite(n)) continue;
        out = Math.min(Math.max(n, range[0]), range[1]);
      }
      if (key === 'method') {
        if (!VALID_METHODS.includes(String(v).toUpperCase())) continue;
        out = String(v).toUpperCase();
      }
      fields.push(`${dbField} = ?`);
      values.push(out);
    }
    if (body.type !== undefined && ['http', 'dns', 'port'].includes(body.type)) {
      fields.push('type = ?'); values.push(body.type);
    }
    if (body.config !== undefined && body.config !== null) {
      fields.push('config = ?'); values.push(typeof body.config === 'string' ? body.config : JSON.stringify(body.config));
    }
    if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400);
    values.push(id);
    await c.env.DB.prepare(`UPDATE monitors SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    invalidate('public');
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

/** 批量操作。原 /monitors/batch,合并后由 POST /monitors?action=batch 调进来 */
async function handleMonitorBatch(c: Context<{ Bindings: Bindings }>) {
  try {
    const body = await c.req.json<{ ids: number[]; action: 'pause' | 'resume' | 'delete' | 'check' }>();
    if (!Array.isArray(body.ids) || body.ids.length === 0) return c.json({ error: 'ids is required' }, 400);
    const placeholders = body.ids.map(() => '?').join(',');
    if (body.action === 'delete') {
      await c.env.DB.prepare(`DELETE FROM logs WHERE monitor_id IN (${placeholders})`).bind(...body.ids).run();
      await c.env.DB.prepare(`DELETE FROM monitor_hourly WHERE monitor_id IN (${placeholders})`).bind(...body.ids).run();
      await c.env.DB.prepare(`DELETE FROM daily_uptime WHERE monitor_id IN (${placeholders})`).bind(...body.ids).run();
      await c.env.DB.prepare(`DELETE FROM monitors WHERE id IN (${placeholders})`).bind(...body.ids).run();
      invalidate('public');
    } else if (body.action === 'pause' || body.action === 'resume') {
      const paused = body.action === 'pause' ? 1 : 0;
      await c.env.DB.prepare(`UPDATE monitors SET paused = ?, status = ? WHERE id IN (${placeholders})`)
        .bind(paused, paused ? 'PAUSED' : 'UP', ...body.ids).run();
      invalidate('public');
    } else if (body.action === 'check') {
      // 批量刷新: 对选中的监控并发执行一次真实检测
      const { results } = await c.env.DB.prepare(`SELECT ${MONITOR_COLUMNS} FROM monitors WHERE id IN (${placeholders})`)
        .bind(...body.ids).all<Monitor>();
      await Promise.all(results.map((monitor) => performMonitorCheck(monitor, c.env)));
      // 手动检查的结果要立刻进公开快照:这个分支是提前 return 的,不走末尾的
      // invalidate,漏掉的话状态页最多要再等一个 30s TTL 才看得到新延迟。
      invalidate('public');
      return c.json({ success: true, affected: results.length });
    } else {
      return c.json({ error: 'Invalid action' }, 400);
    }
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
}

/**
 * 集合上的排序:原 /monitors/reorder。
 *
 * 改的是集合的顺序而不是某一个成员,挂在 PUT /monitors 上用 ?action=reorder 区分,
 * 这之后 /monitors 底下不再有子路径。
 */
app.put('/monitors', async (c) => {
  if (c.req.query('action') !== 'reorder') return c.json({ error: 'Invalid action. Use ?action=reorder' }, 400);
  try {
    const body = await c.req.json<{ ids: number[] }>();
    if (!Array.isArray(body.ids)) return c.json({ error: 'ids is required' }, 400);
    const stmt = c.env.DB.prepare('UPDATE monitors SET sort_order = ? WHERE id = ?');
    await c.env.DB.batch(body.ids.map((id, idx) => stmt.bind(idx, id)));
    invalidate('public');
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

/**
 * 单个监控的手动动作。
 *
 * 手动探测与暂停原本各占一个端点(/monitors/:id/check、/monitors/:id/pause),
 * 它们都不修改资源本身、只触发一次状态迁移;后来 /monitors/:id 本身也收进了
 * /monitors,这两个动作就成了 POST /monitors 上 ?action= 的取值,目标靠 ?id= 指认:
 *   POST /monitors?action=check&id=3   立即探测一次
 *   POST /monitors?action=pause&id=3   暂停/恢复;body 可带 { paused: 0|1 },不给则按当前状态取反
 */
async function handleMonitorAction(c: Context<{ Bindings: Bindings }>, action: 'check' | 'pause', id: number) {
  try {
    if (action === 'check') {
      const monitor = await c.env.DB.prepare(`SELECT ${MONITOR_COLUMNS} FROM monitors WHERE id = ?`)
        .bind(id).first<Monitor>();
      if (!monitor) return c.json({ error: 'Monitor not found' }, 404);
      return c.json(await performMonitorCheck(monitor, c.env));
    }
    // 优先使用 body.paused,未提供时按当前状态取反(toggle)
    let paused: number | undefined;
    try {
      const body = await c.req.json<{ paused?: number }>();
      paused = body?.paused;
    } catch { /* no body */ }
    const row = await c.env.DB.prepare('SELECT paused FROM monitors WHERE id = ?').bind(id).first<{ paused: number }>();
    if (!row) return c.json({ error: 'Monitor not found' }, 404);
    const next = paused !== undefined ? (paused ? 1 : 0) : (row.paused ? 0 : 1);
    await c.env.DB.prepare('UPDATE monitors SET paused = ?, status = ?, retry_count = 0 WHERE id = ?')
      .bind(next, next ? 'PAUSED' : 'UP', id).run();
    invalidate('public');
    return c.json({ success: true, paused: !!next });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
}

// ============================================================
// 事件公告
// ============================================================
/**
 * 事件列表。
 *
 * 进行中的公告(状态页公开读)与全量事件(管理视角)原本是两个端点
 * (/incidents、/incidents/all),同一张表的两种口径,合并后靠 ?status= 区分:
 *   /incidents                → 只返回 status = 'active'
 *   /incidents?status=all     → 全部,含已解决;鉴权在中间件里按这个参数放行
 */
app.get('/incidents', async (c) => {
  try {
    const status = c.req.query('status') || 'active';
    // 不认的值要报出来:否则 'all' 拼错成 'All' 时会被当成 active 静默返回半份数据
    if (status !== 'active' && status !== 'all') return c.json({ error: "Invalid status. Use 'active' or 'all'" }, 400);
    if (status === 'all') {
      const limit = Math.min(Math.max(Number(c.req.query('limit') || 100), 1), 500);
      const { results } = await c.env.DB.prepare(
        'SELECT * FROM incidents ORDER BY created_at DESC LIMIT ?'
      ).bind(limit).all<Incident>();
      return c.json(results || []);
    }
    // 进行中的公告本来就不会多,这里不需要 limit —— 加了只会在异常时刻静默截断
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM incidents WHERE status = 'active' ORDER BY created_at DESC"
    ).all<Incident>();
    return c.json(results || []);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.post('/incidents', async (c) => {
  try {
    const body = await c.req.json<{ title: string; description?: string; severity?: string; type?: string; scheduled_start?: string; scheduled_end?: string; affected_monitors?: string }>();
    if (!body.title) return c.json({ error: 'Missing title' }, 400);
    const severity = ['info', 'warning', 'critical'].includes(body.severity || '') ? body.severity : 'info';
    const type = body.type === 'maintenance' ? 'maintenance' : 'incident';
    const scheduledStart = type === 'maintenance' ? body.scheduled_start : null;
    const scheduledEnd = type === 'maintenance' ? body.scheduled_end : null;
    if (type === 'maintenance' && (!scheduledStart || !scheduledEnd || scheduledEnd <= scheduledStart)) {
      return c.json({ error: 'Invalid maintenance window' }, 400);
    }
    const now = new Date().toISOString();
    const result = await c.env.DB.prepare(
      'INSERT INTO incidents (title, description, severity, status, type, scheduled_start, scheduled_end, affected_monitors, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(body.title, body.description || null, severity, 'active', type, scheduledStart, scheduledEnd, body.affected_monitors || null, now, now).run();
    // 通知订阅者
    await notifySubscribers(c.env, body.title, body.description || '', 'incident');
    // /api/status 的快照里带 active 事件,公告要立刻上状态页
    invalidate('public');
    return c.json({ success: true, id: result.meta.last_row_id }, 201);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.patch('/incidents', async (c) => {
  const id = targetId(c);
  if (id === null) return c.json({ error: 'id is required. Use ?id=1' }, 400);
  try {
    const body = await c.req.json<{ title?: string; description?: string; severity?: string; status?: string; affected_monitors?: string }>();
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title); }
    if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description); }
    if (body.severity !== undefined) { fields.push('severity = ?'); values.push(body.severity); }
    if (body.affected_monitors !== undefined) { fields.push('affected_monitors = ?'); values.push(body.affected_monitors); }
    if (body.status !== undefined && ['active', 'resolved'].includes(body.status)) {
      fields.push('status = ?'); values.push(body.status);
      fields.push('resolved_at = ?'); values.push(body.status === 'resolved' ? new Date().toISOString() : null);
    }
    if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400);
    fields.push('updated_at = ?'); values.push(new Date().toISOString());
    values.push(id);
    await c.env.DB.prepare(`UPDATE incidents SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    invalidate('public');
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.delete('/incidents', async (c) => {
  const id = targetId(c);
  // 没有目标就拒绝:DELETE 打到集合上等于清空整张表
  if (id === null) return c.json({ error: 'id is required. Use ?id=1' }, 400);
  try {
    await c.env.DB.prepare('DELETE FROM incidents WHERE id = ?').bind(id).run();
    invalidate('public');
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// ============================================================
// 设置
// ============================================================
app.get('/settings', async (c) => {
  try {
    return c.json(await getSettingsMap(c.env));
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.put('/settings', async (c) => {
  try {
    const body = await c.req.json<Record<string, string>>();
    // 白名单:只允许写入已知设置键
    const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
    const entries = Object.entries(body).filter(([k]) => allowed.has(k));
    if (entries.length === 0) return c.json({ error: 'No valid setting keys' }, 400);
    const stmt = c.env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
    const now = new Date().toISOString();
    await c.env.DB.batch(entries.map(([k, v]) => stmt.bind(k, String(v), now)));
    // 时区/可见性等设置会影响公开快照的口径与缓存头,改完立即作废
    invalidate('public');
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.get('/health', async (c) => {
  try {
    // 系统状态栏所需的全部指标:批量一次往返取完,避免多次查询往返。
    // 日志量用 MAX(id) 近似而不是 COUNT(*):后者要扫完整张 logs(几十万行),
    // 而管理页每 60 秒就打一次这个接口。MAX(id) 走主键,O(1)。
    // 最后一条日志同理取 id 最大的那行,不再依赖已删除的 created_at 全局索引。
    const [probe, logs, channels, daily, lastLog] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT 1 as ok'),
      c.env.DB.prepare('SELECT MAX(id) as c FROM logs'),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM notification_channels WHERE enabled = 1'),
      c.env.DB.prepare('SELECT MAX(date) as d FROM daily_uptime'),
      c.env.DB.prepare('SELECT created_at as t FROM logs ORDER BY id DESC LIMIT 1'),
    ]);
    const logsRow = logs.results?.[0] as { c: number } | undefined;
    const channelsRow = channels.results?.[0] as { c: number } | undefined;
    const dailyRow = daily.results?.[0] as { d: string | null } | undefined;
    const lastLogRow = lastLog.results?.[0] as { t: string | null } | undefined;
    return c.json({
      status: 'ok', ok: true, db: !!probe.results?.[0],
      logs: logsRow?.c ?? 0,
      enabled_channels: channelsRow?.c ?? 0,
      latest_daily_uptime: dailyRow?.d ?? null,
      latest_log_at: lastLogRow?.t ?? null,
    });
  } catch (e: unknown) {
    return c.json({
      status: 'error', ok: false, db: false,
      logs: 0, enabled_channels: 0, latest_daily_uptime: null, latest_log_at: null,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================
// 通知渠道
// ============================================================
app.get('/notification-channels', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM notification_channels ORDER BY created_at DESC').all<NotificationChannel>();
    return c.json((results || []).map(ch => maskChannelConfig(ch) as unknown as NotificationChannel));
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.post('/notification-channels', async (c) => {
  const action = c.req.query('action') || '';
  // 测试告警(原 /test-alert 与 /notification-channels/:id/test)合成一个取值:
  // 带 ?id= 测单个渠道,不带就向全部已启用渠道发。测的都是渠道,差别只在目标范围,
  // 拆成两条地址反而看不出这层关系。
  if (action === 'test') {
    const raw = c.req.query('id');
    try {
      if (raw === undefined) return c.json({ success: await sendTestAlert(c.env) });
      const id = targetId(c);
      if (id === null) return c.json({ error: 'Invalid id. Use ?id=1' }, 400);
      const channel = await c.env.DB.prepare('SELECT * FROM notification_channels WHERE id = ?')
        .bind(id).first<NotificationChannel>();
      if (!channel) return c.json({ error: 'Channel not found' }, 404);
      return c.json({ success: await sendTestAlert(c.env, [channel]) });
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
    }
  }
  if (action !== '') return c.json({ error: 'Invalid action. Use ?action=test' }, 400);
  // 新建不带 ?id=:id 只用来指认成员操作的目标
  if (c.req.query('id') !== undefined) return c.json({ error: 'id is only valid with ?action=test' }, 400);
  try {
    const body = await c.req.json<{ type: string; name: string; config: Record<string, unknown>; enabled?: number; template_version_id?: number | null }>();
    if (!body.type || !body.name || !body.config) return c.json({ error: 'Missing required fields' }, 400);
    if (!(CHANNEL_TYPES as readonly string[]).includes(body.type)) {
      return c.json({ error: `Invalid type. Valid: ${CHANNEL_TYPES.join(', ')}` }, 400);
    }
    // 校验 email 类型必须带 provider
    if (body.type === 'email') {
      const provider = String(body.config.provider || 'resend');
      if (!(EMAIL_PROVIDERS as readonly string[]).includes(provider)) {
        return c.json({ error: `Invalid email provider. Valid: ${EMAIL_PROVIDERS.join(', ')}` }, 400);
      }
    }
    // 允许建渠道时就指定模板版本;非法 id 忽略(指向不存在的版本没有意义)
    const rawVersion = Number(body.template_version_id) || 0;
    let boundVersion: number | null = null;
    if (rawVersion > 0) {
      const exists = await c.env.DB.prepare('SELECT id FROM alert_templates WHERE id = ?').bind(rawVersion).first<{ id: number }>();
      if (exists) boundVersion = rawVersion;
    }
    await c.env.DB.prepare('INSERT INTO notification_channels (type, name, enabled, config, template_version_id) VALUES (?, ?, ?, ?, ?)')
      .bind(body.type, body.name, body.enabled ?? 1, JSON.stringify(body.config), boundVersion).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.patch('/notification-channels', async (c) => {
  const id = targetId(c);
  if (id === null) return c.json({ error: 'id is required. Use ?id=1' }, 400);
  try {
    const body = await c.req.json<{ name?: string; enabled?: number; config?: Record<string, unknown>; template_version_id?: number | null }>();
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
    if (body.enabled !== undefined) { fields.push('enabled = ?'); values.push(body.enabled); }
    // 0 或 null 表示"跟随默认版本";非法 id 直接忽略,免得渠道指向一个不存在的版本
    if (body.template_version_id !== undefined) {
      const raw = Number(body.template_version_id);
      if (raw > 0) {
        const exists = await c.env.DB.prepare('SELECT id FROM alert_templates WHERE id = ?').bind(raw).first<{ id: number }>();
        if (exists) { fields.push('template_version_id = ?'); values.push(raw); }
      } else {
        fields.push('template_version_id = NULL');
      }
    }
    if (body.config !== undefined && Object.keys(body.config).length > 0) {
      const existing = await c.env.DB.prepare('SELECT config FROM notification_channels WHERE id = ?')
        .bind(id).first<{ config: string }>();
      let mergedConfig: Record<string, unknown> = {};
      if (existing?.config) { try { mergedConfig = JSON.parse(existing.config) as Record<string, unknown>; } catch { /* ignore */ } }
      for (const [k, v] of Object.entries(body.config)) {
        if (v !== '' && v !== null && v !== undefined) mergedConfig[k] = v;
      }
      fields.push('config = ?'); values.push(JSON.stringify(mergedConfig));
    }
    if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400);
    values.push(id);
    await c.env.DB.prepare(`UPDATE notification_channels SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.delete('/notification-channels', async (c) => {
  const id = targetId(c);
  if (id === null) return c.json({ error: 'id is required. Use ?id=1' }, 400);
  try {
    await c.env.DB.prepare('DELETE FROM notification_channels WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 原 /test-alert 与 /notification-channels/:id/test 都并进了
// POST /notification-channels?action=test(带不带 ?id= 决定测单个还是全部),
// 老地址交给重写表。

// ============================================================
// 告警模板版本
//
// 一份版本 = 一整套告警文案(6 类模板 + 标题 + 落款)。
// 渠道可以各自绑定一个版本,于是同一条告警能给不同渠道发不同措辞。
// ============================================================
app.get('/alert-templates', async (c) => {
  try {
    const [versions, channelRes] = await Promise.all([
      listTemplateVersions(c.env),
      c.env.DB.prepare('SELECT id, name, type, enabled, template_version_id FROM notification_channels ORDER BY created_at DESC')
        .all<{ id: number; name: string; type: string; enabled: number; template_version_id: number | null }>(),
    ]);
    return c.json({
      versions: versions.map(v => ({
        id: v.id, name: v.name, note: v.note, is_default: Number(v.is_default) === 1,
        created_at: v.created_at, updated_at: v.updated_at,
        payload: normalizePayload(parseTemplatePayload(v.payload)),
      })),
      channels: channelRes.results || [],
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

/**
 * 单个版本的手动动作与"新建"共用一个 POST。
 *
 * 原 /alert-templates/:id/duplicate 与 /:id/default 都不改内容,只改变版本集合
 * (多一份副本 / 换默认指向),收进来之后靠 ?action= 区分,目标由 ?id= 指认:
 *   ?action=duplicate&id=3   复制一份出新版本(改文案前先留个底,也方便做 A/B 措辞)
 *   ?action=default&id=3     设为默认版本
 * 不带 action 就是新建版本 —— 顺带要求也不带 ?id=,免得两种语义含混。
 */
app.post('/alert-templates', async (c) => {
  const action = c.req.query('action') || '';
  const hasId = c.req.query('id') !== undefined;
  const id = hasId ? targetId(c) : null;
  try {
    if (action === 'duplicate' || action === 'default') {
      if (id === null) return c.json({ error: `id is required. Use ?action=${action}&id=1` }, 400);
      if (action === 'duplicate') {
        const newId = await duplicateTemplateVersion(c.env, id);
        if (!newId) return c.json({ error: 'Template version not found' }, 404);
        return c.json({ success: true, id: newId });
      }
      await setDefaultVersion(c.env, id);
      return c.json({ success: true });
    }
    if (action !== '') return c.json({ error: 'Invalid action. Use ?action=duplicate or ?action=default' }, 400);
    if (hasId) return c.json({ error: 'id is only valid with ?action=duplicate or ?action=default' }, 400);
    const body = await c.req.json<{ name?: string; note?: string; payload?: Partial<AlertTemplatePayload>; is_default?: boolean }>();
    const created = await createTemplateVersion(c.env, {
      name: body.name || '', note: body.note ?? null,
      payload: body.payload || {}, isDefault: body.is_default === true,
    });
    return c.json({ success: true, id: created });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.put('/alert-templates', async (c) => {
  const id = targetId(c);
  if (id === null) return c.json({ error: 'id is required. Use ?id=1' }, 400);
  try {
    const body = await c.req.json<{ name?: string; note?: string; payload?: Partial<AlertTemplatePayload>; is_default?: boolean }>();
    const exists = await c.env.DB.prepare('SELECT id FROM alert_templates WHERE id = ?').bind(id).first<AlertTemplateVersion>();
    if (!exists) return c.json({ error: 'Template version not found' }, 404);
    await updateTemplateVersion(c.env, id, {
      name: body.name || '', note: body.note ?? null,
      payload: body.payload || {}, isDefault: body.is_default === true,
    });
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 原 /alert-templates/:id/duplicate 与 /:id/default 已并入上面这条 POST,
// 老地址交给重写表。

app.delete('/alert-templates', async (c) => {
  const id = targetId(c);
  if (id === null) return c.json({ error: 'id is required. Use ?id=1' }, 400);
  try {
    // 默认版本是所有未绑定渠道的兜底文案,删掉它等于让一部分告警没东西可发 —— 直接挡掉
    const target = await c.env.DB.prepare('SELECT is_default FROM alert_templates WHERE id = ?').bind(id).first<{ is_default: number }>();
    if (target && Number(target.is_default) === 1) return c.json({ error: 'cannot_delete_default' }, 400);
    const cnt = await c.env.DB.prepare('SELECT COUNT(*) as c FROM alert_templates').first<{ c: number }>();
    if (cnt && Number(cnt.c) <= 1) return c.json({ error: 'At least one template version is required' }, 400);
    await deleteTemplateVersion(c.env, id);
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// ============================================================
// API 密钥管理
// ============================================================
app.get('/api-keys', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT id, name, created_at, last_used_at FROM api_keys ORDER BY created_at DESC').all();
    return c.json(results || []);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.post('/api-keys', async (c) => {
  try {
    const body = await c.req.json<{ name?: string }>();
    if (!body.name) return c.json({ error: 'Name is required' }, 400);
    const rawKey = `ut_${randomToken(24)}`;
    const hash = await hashApiKey(rawKey);
    await c.env.DB.prepare('INSERT INTO api_keys (name, key_hash) VALUES (?, ?)').bind(body.name, hash).run();
    return c.json({ success: true, key: rawKey }, 201); // 仅此一次展示明文
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.delete('/api-keys', async (c) => {
  const id = targetId(c);
  // 没有目标就拒绝:DELETE 打到集合上等于清空整张表
  if (id === null) return c.json({ error: 'id is required. Use ?id=1' }, 400);
  try {
    await c.env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// ============================================================
// 完整数据 API(/v1,需 API key 或 admin token)
// ============================================================

// /v1 子应用。/api/v1 由 stripApiPrefix 重写过来,挂一次即可
const v1App = new Hono<{ Bindings: Bindings }>();

v1App.get('/monitors', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`SELECT ${MONITOR_COLUMNS} FROM monitors ORDER BY sort_order ASC, created_at ASC`).all();
    return c.json((results || []).map(maskMonitorSensitive));
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

v1App.get('/logs', async (c) => {
  try {
    const monitorId = Number(c.req.query('monitor_id') || 0);
    const since = c.req.query('since') || '';
    const until = c.req.query('until') || '';
    const limit = Math.min(Math.max(Number(c.req.query('limit') || 100), 1), 5000);
    const offset = Math.max(Number(c.req.query('offset') || 0), 0);

    const where: string[] = [];
    const bind: (string | number)[] = [];
    if (monitorId > 0) { where.push('monitor_id = ?'); bind.push(monitorId); }
    if (since) { where.push('created_at >= ?'); bind.push(since); }
    if (until) { where.push('created_at <= ?'); bind.push(until); }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    // logs 上只剩 (monitor_id, created_at) 一个索引:带 monitor_id 时按 created_at 排序能
    // 走索引;不带时按 created_at 排要整表排序,而 id 与 created_at 同序,换成 id 走主键。
    const orderCol = monitorId > 0 ? 'created_at' : 'id';

    const { results } = await c.env.DB.prepare(
      `SELECT id, monitor_id, status_code, latency, is_fail, reason, created_at FROM logs ${whereSql} ORDER BY ${orderCol} DESC LIMIT ? OFFSET ?`
    ).bind(...bind, limit, offset).all();
    // 同理:无条件 COUNT(*) 是整表扫,用 MAX(id) 近似(用于分页总数,精度足够)
    const cnt = await c.env.DB.prepare(
      where.length > 0 ? `SELECT COUNT(*) as c FROM logs ${whereSql}` : 'SELECT MAX(id) as c FROM logs'
    ).bind(...bind).first<{ c: number }>();
    return c.json({ total: cnt?.c || 0, limit, offset, logs: results || [] });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

v1App.get('/incidents', async (c) => {
  try {
    const limit = Math.min(Math.max(Number(c.req.query('limit') || 500), 1), 1000);
    const { results } = await c.env.DB.prepare('SELECT * FROM incidents ORDER BY created_at DESC LIMIT ?').bind(limit).all();
    return c.json(results || []);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

v1App.get('/uptime', async (c) => {
  try {
    const days = Math.min(Math.max(Number(c.req.query('days') || 30), 1), 365);
    // 与每日聚合同一口径:按设置时区切天
    const tzMod = tzModifier(await getTimezone(c.env));
    const sinceDate = `date('now', '${tzMod}', '-${days - 1} days')`;
    const { results: daily } = await c.env.DB.prepare(
      `SELECT monitor_id, date, total_checks, successful_checks, avg_latency FROM daily_uptime WHERE date >= ${sinceDate} ORDER BY monitor_id, date`
    ).all();
    const { results: monitors } = await c.env.DB.prepare('SELECT id, name, url, type FROM monitors ORDER BY sort_order ASC').all();

    type Row = { monitor_id: number; total_checks: number; successful_checks: number };
    const agg = new Map<number, { t: number; s: number }>();
    for (const r of daily || []) {
      const id = r.monitor_id as number;
      const cur = agg.get(id) || { t: 0, s: 0 };
      cur.t += (r as Row).total_checks || 0;
      cur.s += (r as Row).successful_checks || 0;
      agg.set(id, cur);
    }
    const pct = (t: number, s: number) => t > 0 ? Number(((s / t) * 100).toFixed(1)) : null;
    const summary = (monitors || []).map(m => {
      const a = agg.get(m.id as number);
      return { id: m.id, name: m.name, url: m.url, type: m.type, uptime: a ? pct(a.t, a.s) : null, checks: a?.t || 0 };
    });
    return c.json({ days, daily: daily || [], summary });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

v1App.get('/export', async (c) => {
  try {
    const limit = Math.min(Math.max(Number(c.req.query('limit') || 1000), 1), 5000);
    const { results: monitors } = await c.env.DB.prepare(`SELECT ${MONITOR_COLUMNS} FROM monitors ORDER BY sort_order ASC`).all();
    // 这里按 id 而不是 created_at 排:后者没有索引可用,等于整表排序;id 与 created_at 同序
    const { results: logs } = await c.env.DB.prepare('SELECT id, monitor_id, status_code, latency, is_fail, reason, created_at FROM logs ORDER BY id DESC LIMIT ?').bind(limit).all();
    const { results: incidents } = await c.env.DB.prepare('SELECT * FROM incidents ORDER BY created_at DESC LIMIT 1000').all();
    const tzMod = tzModifier(await getTimezone(c.env));
    const { results: uptime } = await c.env.DB.prepare(`SELECT monitor_id, date, total_checks, successful_checks, avg_latency FROM daily_uptime WHERE date >= date('now', '${tzMod}', '-90 days') ORDER BY monitor_id, date`).all();
    const { results: settings } = await c.env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
    const { results: channels } = await c.env.DB.prepare('SELECT id, type, name, enabled, config, created_at FROM notification_channels').all();

    const safeSettings = (settings || []).filter(s => !isSensitiveSettingKey(s.key));
    const safeChannels = (channels || []).map(ch => maskChannelConfig(ch as unknown as { config: string }));

    return c.json({
      app: 'MonitorFlare', version: 1, exported_at: new Date().toISOString(),
      monitors: (monitors || []).map(maskMonitorSensitive),
      logs: logs || [], incidents: incidents || [], uptime: uptime || [],
      settings: safeSettings, notification_channels: safeChannels,
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.route('/v1', v1App);

// ============================================================
// 备份 / 恢复
//
// 同一个资源、两个方向:GET 导出整站快照,POST 用快照覆盖整站。
// 原来是 /backup 与 /backup/restore 两个路径,合并后用 method 区分。
// ============================================================
app.get('/backup', async (c) => {
  try {
    // alert_templates 也要带走:它是告警文案的唯一存储,丢了只剩内置兜底文案
    const tables = ['monitors', 'logs', 'incidents', 'settings', 'notification_channels', 'alert_templates', 'subscriptions'];
    const dump: Record<string, unknown[]> = {};
    for (const t of tables) {
      const { results } = await c.env.DB.prepare(`SELECT * FROM ${t}`).all();
      dump[t] = results || [];
    }
    const payload = JSON.stringify({ app: 'MonitorFlare', version: 1, exported_at: new Date().toISOString(), data: dump });
    return c.body(payload, 200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="monitorflare-backup.json"' });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.post('/backup', async (c) => {
  try {
    const body = await c.req.json<{ data?: Record<string, unknown[]> }>();
    const data = body?.data;
    if (!data || !Array.isArray(data.monitors)) return c.json({ error: 'Invalid backup format' }, 400);
    // 清空并恢复
    for (const t of ['logs', 'monitors', 'incidents', 'settings', 'notification_channels', 'subscriptions']) {
      await c.env.DB.prepare(`DELETE FROM ${t}`).run();
    }
    if (Array.isArray(data.settings)) {
      const stmt = c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      await c.env.DB.batch((data.settings as { key: string; value: string }[]).map(s => stmt.bind(s.key, s.value)));
    }
    if (Array.isArray(data.monitors)) {
      const cols = Object.keys((data.monitors[0] as Record<string, unknown>) || {}).filter(k => k !== 'id');
      for (const m of data.monitors as Record<string, unknown>[]) {
        const placeholders = cols.map(() => '?').join(',');
        await c.env.DB.prepare(`INSERT INTO monitors (${cols.join(',')}) VALUES (${placeholders})`)
          .bind(...cols.map(k => m[k] ?? null)).run();
      }
    }
    return c.json({ success: true, restored: data.monitors.length });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// ============================================================
// 公开 API + RSS + 订阅
//
// 经 Pages _worker.js 代理后 /api 前缀会被剥掉,所以每个公开路由过去都要注册
// "带 /api" 和 "不带前缀" 两个版本。现在由入口处的 stripApiPrefix 统一重写,
// 这里只注册裸路径 —— 端点数减半,也不会再出现"改了一个忘了另一个"。
// ============================================================
const statusHandler = async (c) => {
  try {
    const payload = await cached('publicStatus', PUBLIC_TTL_MS, async () => {
      const { results: monitors } = await c.env.DB.prepare(
        'SELECT id, name, url, type, status, last_check, last_latency, paused, tags FROM monitors ORDER BY sort_order ASC'
      ).all();
      const ids = (monitors || []).map(m => m.id as number);
      const statsMap: Record<number, { uptime_7d: number | null; uptime_30d: number | null; latency: number | null }> = {};
      if (ids.length > 0) {
        const tz = await getTimezone(c.env);
        const stats = await buildMonitorStats(c.env, ids, tz, 30);
        for (const id of ids) {
          const s = stats.get(id);
          const m = (monitors || []).find(x => x.id === id);
          statsMap[id] = {
            uptime_7d: s?.uptime_7d ?? null,
            uptime_30d: s?.uptime_30d ?? null,
            latency: (m?.last_latency as number | null) ?? null,
          };
        }
      }
      const { results: incidents } = await c.env.DB.prepare(
        "SELECT id, title, severity, status, type, created_at, resolved_at FROM incidents WHERE status = 'active' ORDER BY created_at DESC"
      ).all();
      const out = (monitors || []).map(m => ({
        id: m.id, name: m.name, url: m.url, type: m.type, status: m.status,
        paused: m.paused, tags: m.tags, last_check: m.last_check,
        ...(statsMap[m.id as number] || { uptime_7d: null, uptime_30d: null, latency: null }),
      }));
      return { generated_at: new Date().toISOString(), monitors: out, incidents: incidents || [] };
    });
    c.header('Cache-Control', await isPublicSite(c.env) ? PUBLIC_CACHE : PRIVATE_CACHE);
    return c.json(payload);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
};

app.get('/status', statusHandler);

// 状态页登录(私密模式):密码换 token
const statusLoginHandler = async (c: Context<{ Bindings: Bindings }>) => {
  try {
    const body = await c.req.json<{ password?: string }>().catch((): { password?: string } => ({}));
    if (!body.password) return c.json({ error: 'Password is required' }, 400);
    const storedHash = await getSetting(c.env, 'status_page_password');
    if (!storedHash) return c.json({ error: 'status_page_not_configured' }, 503);
    const inputHash = await hashStatusPassword(body.password);
    if (!await safeEqual(inputHash, storedHash)) return c.json({ error: 'invalid_password' }, 401);
    const token = await createStatusToken(c.env, storedHash);
    return c.json(token);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
};
app.post('/status/login', statusLoginHandler);

app.get('/feed.xml', async (c) => {
  try {
    const settings = await getSettingsMap(c.env);
    const siteTitle = settings.site_title || 'MonitorFlare';
    const siteDesc = settings.site_description || 'Status updates';
    const base = (c.env.BASE_URL || '').replace(/\/$/, '');
    const { results: incidents } = await c.env.DB.prepare(
      'SELECT * FROM incidents ORDER BY created_at DESC LIMIT 20'
    ).all<Incident>();
    const items = (incidents || []).map(i => {
      const link = `${base}/#/incident/${i.id}`;
      const pubDate = new Date(i.created_at.replace(' ', 'T') + 'Z').toUTCString();
      return `  <item>
    <title>${escapeXml(i.title)} [${i.status}]</title>
    <link>${link}</link>
    <guid>${link}</guid>
    <pubDate>${pubDate}</pubDate>
    <description>${escapeXml(i.description || i.title)}</description>
  </item>`;
    }).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(siteTitle)}</title>
    <description>${escapeXml(siteDesc)}</description>
    <link>${base}</link>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;
    return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'no-store' });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.post('/subscribe', async (c) => {
  try {
    const body = await c.req.json<{ email?: string }>();
    const email = (body.email || '').trim();
    if (!isValidEmail(email)) return c.json({ error: 'Valid email is required' }, 400);
    const token = randomToken(16);
    await c.env.DB.prepare('INSERT INTO subscriptions (email, token) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET token = excluded.token')
      .bind(email, token).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

app.post('/unsubscribe', async (c) => {
  try {
    const body = await c.req.json<{ token?: string }>();
    if (!body.token) return c.json({ error: 'Token is required' }, 400);
    await c.env.DB.prepare('DELETE FROM subscriptions WHERE token = ?').bind(body.token).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// ============================================================
// 入站 Webhook(外部系统推送事件)
// ============================================================
app.post('/webhooks/:token', async (c) => {
  const token = c.req.param('token');
  try {
    const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'inbound_webhook_token'").first<{ value: string }>();
    const expected = row?.value || '';
    if (!expected || !await safeCompare(token, expected)) return c.json({ error: 'Invalid token' }, 401);
    const body = await c.req.json<{ title?: string; description?: string; severity?: string }>().catch(() => null);
    if (!body?.title) return c.json({ error: 'title is required' }, 400);
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'INSERT INTO incidents (title, description, severity, status, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(body.title, body.description || null, body.severity || 'info', 'active', 'incident', now, now).run();
    await notifySubscribers(c.env, body.title, body.description || '', 'webhook');
    return c.json({ success: true }, 201);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// ============================================================
// 导出
// ============================================================
/**
 * 剥掉 /api 前缀
 *
 * Pages 的 _worker.js 代理会把 /api/* 转发到 Worker,直连 Worker 的部署又只有裸路径,
 * 所以两个前缀都得能work。以前的做法是每个路由注册两遍(/api/status 和 /status),
 * 端点数直接翻倍不说,改了一个很容易漏掉另一个。
 *
 * 必须放在 app.fetch 之外:Hono 在 dispatch 阶段就从 request.url 提取了 path,
 * 等到中间件里再改 c.req.raw,路由早就匹配完了,改了也不生效。
 */
/**
 * 旧路径 → 新路径(参数化)的重写表。
 *
 * 端点收敛之后 /monitors/public、/monitors/batch 这些都只剩参数形态了,但已经发布的
 * 脚本和旧版前端还在打老地址。这里在入口统一映射:路由表里只留新端点,老地址继续可用,
 * 等调用方都迁过去之后,整张表删掉即可。
 *
 * 顺序有意义:更具体的模式必须排在前面,否则 /monitors/public/details 会先被
 * /monitors/public 吃掉。
 */
const LEGACY_PATH_REWRITES: [RegExp, string][] = [
  [/^\/monitors\/public\/details\/?$/, '/monitors?scope=public&detail=1'],
  [/^\/monitors\/public\/detail\/?$/, '/monitors?scope=public&view=detail'],
  [/^\/monitors\/public\/(\d+)\/?$/, '/monitors?scope=public&view=detail&id=$1'],
  [/^\/monitors\/public\/?$/, '/monitors?scope=public'],
  [/^\/monitors\/batch\/?$/, '/monitors?action=batch'],
  [/^\/monitors\/reorder\/?$/, '/monitors?action=reorder'],
  // 成员地址:目标交回查询串。放在最后一条 —— 前面的 public / batch / reorder
  // 都是具体的段,排在这里之前才不会被数字规则抢先吃掉
  [/^\/monitors\/(\d+)\/config\/?$/, '/monitors?id=$1'],
  [/^\/monitors\/(\d+)\/?$/, '/monitors?id=$1'],
  [/^\/incidents\/(\d+)\/?$/, '/incidents?id=$1'],
  // 带后缀的成员动作要先匹配:否则 /:id/test 会被下面的 /:id 吃掉
  [/^\/notification-channels\/(\d+)\/test\/?$/, '/notification-channels?action=test&id=$1'],
  [/^\/notification-channels\/(\d+)\/?$/, '/notification-channels?id=$1'],
  [/^\/alert-templates\/(\d+)\/duplicate\/?$/, '/alert-templates?action=duplicate&id=$1'],
  [/^\/alert-templates\/(\d+)\/default\/?$/, '/alert-templates?action=default&id=$1'],
  [/^\/alert-templates\/(\d+)\/?$/, '/alert-templates?id=$1'],
  [/^\/api-keys\/(\d+)\/?$/, '/api-keys?id=$1'],
  [/^\/test-alert\/?$/, '/notification-channels?action=test'],
];

function stripApiPrefix(request: Request): Request {
  const url = new URL(request.url);
  let rewritten = false;
  if (url.pathname.startsWith('/api/')) {
    url.pathname = url.pathname.slice('/api'.length);
    rewritten = true;
  }
  for (const [pattern, target] of LEGACY_PATH_REWRITES) {
    const m = url.pathname.match(pattern);
    if (!m) continue;
    const [path, targetQuery = ''] = target.split('?');
    // 捕获组可能落在路径里(/monitors/$1),也可能落在参数里(id=$1),两边都要替换
    const captured = m[1] ?? '';
    const merged = new URLSearchParams(targetQuery.replace(/\$1/g, captured));
    for (const [k, v] of url.searchParams) if (!merged.has(k)) merged.set(k, v);
    url.pathname = path.replace(/\$1/g, captured);
    url.search = merged.toString();
    rewritten = true;
    break;
  }
  if (!rewritten) return request;
  // 传原 request 作为 init:method / headers / body 都被继承,只有 URL 变了
  return new Request(url.toString(), request);
}

export default {
  fetch: (request: Request, env: Bindings, ctx: ExecutionContext) => app.fetch(stripApiPrefix(request), env, ctx),
  // 定时任务：探测 / 状态机 / 告警编排 / 每日聚合均在 ./scheduler.ts
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledTasks(env));
  },
};
