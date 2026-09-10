// ============================================================
// MonitorFlare — CORS + 鉴权中间件
// 原 index.ts 37-111 行,纯搬迁。
// ============================================================
import type { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from '../types';
import { getAllowedOrigins, isLocalOrigin, getAuthSecret } from '../utils';
import { ensureInitialized, getSetting } from '../init';
import {
  verifySessionToken, verifyAdminCredential, verifyApiKey,
  verifyCfAccessToken, verifyStatusToken,
} from '../auth';

/** 完全公开的前缀 */
const PUBLIC_PATHS = [
  '/auth/', '/monitors/public', '/api/status', '/feed.xml', '/api/subscribe', '/api/unsubscribe', '/webhooks/',
];

/** 需要鉴权的前缀 */
const PROTECTED_PREFIXES = ['/monitors', '/notification-channels', '/incidents', '/settings', '/test-alert', '/health', '/api-keys', '/backup', '/api/v1', '/v1'];

/** 私密模式下需锁定的公开接口(前缀匹配) */
const STATUS_LOCK_PATHS = [
  '/monitors/public', '/incidents', '/settings', '/feed.xml', '/api/status', '/status',
  '/api/subscribe', '/api/unsubscribe', '/subscribe', '/unsubscribe',
];

/** 私密模式下始终放行(登录/管理认证) */
const STATUS_LOCK_EXEMPT = ['/status/login', '/api/status/login', '/auth/', '/webhooks/'];

/**
 * 安装全局中间件。
 * **必须在注册任何路由之前调用**,否则中间件不会覆盖到已注册的路由。
 */
export function installMiddleware(app: Hono<{ Bindings: Bindings }>) {
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

  app.use('/*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return await next();
    const path = c.req.path;

    // 初始化自检(幂等,首次访问自动建表)
    await ensureInitialized(c.env);

    // 私密模式:锁定状态页公开接口
    const visibility = await getSetting(c.env, 'status_page_visibility');
    if (visibility === 'private'
      && !STATUS_LOCK_EXEMPT.some(p => path.startsWith(p))
      && STATUS_LOCK_PATHS.some(p => path === p || path.startsWith(p + '/'))) {
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
    if (path === '/incidents' && c.req.method === 'GET') return await next();
    if (path === '/settings' && c.req.method === 'GET') return await next();
    if (path === '/monitors/public/details') return await next();

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
}
