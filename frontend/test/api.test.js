import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchT,
  withRetry,
  isStatusLocked,
  statusLogin,
  statusLogout,
  API_BASE,
  STATUS_TOKEN_KEY,
} from '../src/utils/api.js';

/** 造一个可被 clone().json() 消费的响应 */
const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const lastCall = (fn) => fn.mock.calls[fn.mock.calls.length - 1];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('常量', () => {
  it('API 前缀与 token 存储键保持稳定', () => {
    expect(API_BASE).toBe('/api');
    expect(STATUS_TOKEN_KEY).toBe('monitorflare_status_token');
  });
});

describe('fetchT', () => {
  it('自动带上 localStorage 中的 token', async () => {
    localStorage.setItem(STATUS_TOKEN_KEY, 'tok-123');
    const f = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal('fetch', f);

    await fetchT('/api/monitors');

    expect(lastCall(f)[0]).toBe('/api/monitors');
    expect(lastCall(f)[1].headers.Authorization).toBe('Bearer tok-123');
  });

  it('不覆盖调用方显式传入的 Authorization', async () => {
    localStorage.setItem(STATUS_TOKEN_KEY, 'tok-123');
    const f = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal('fetch', f);

    await fetchT('/api/monitors', { headers: { Authorization: 'Bearer explicit' } });

    expect(lastCall(f)[1].headers.Authorization).toBe('Bearer explicit');
  });

  it('无 token 时不添加 Authorization', async () => {
    const f = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal('fetch', f);

    await fetchT('/api/monitors');

    expect(lastCall(f)[1].headers.Authorization).toBeUndefined();
  });

  it('透传 method 与 body', async () => {
    const f = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal('fetch', f);

    await fetchT('/api/monitors', { method: 'POST', body: '{"a":1}' });

    expect(lastCall(f)[1].method).toBe('POST');
    expect(lastCall(f)[1].body).toBe('{"a":1}');
  });

  it('超时后中止请求', async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, opts) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('AbortError'));
            });
          })
      )
    );

    const p = fetchT('/api/slow', {}, 100);
    vi.advanceTimersByTime(100);

    await expect(p).rejects.toThrow('AbortError');
    expect(aborted).toBe(true);
  });

  it('请求结束后清理定时器，不留下悬挂的 timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {})));

    await fetchT('/api/fast', {}, 5000);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('withRetry', () => {
  it('首次成功则不重试', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    await expect(withRetry(fn, 2, 0)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('失败后重试直到成功', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');

    await expect(withRetry(fn, 2, 0)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('重试次数用尽后抛出最后一次错误', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(withRetry(fn, 2, 0)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('默认重试 2 次(共 3 次尝试)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(withRetry(fn)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('退避时间随重试次数递增', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const p = withRetry(fn, 2, 1000);
    const settled = p.catch(() => 'failed');

    // 第 1 次重试等待 1000ms，第 2 次等待 2000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);

    await expect(settled).resolves.toBe('failed');
  });
});

describe('isStatusLocked', () => {
  it('非 401 一律不算锁定', async () => {
    await expect(isStatusLocked(jsonResponse(200, { error: 'status_page_locked' }))).resolves.toBe(false);
    await expect(isStatusLocked(jsonResponse(500, {}))).resolves.toBe(false);
  });

  it('401 且错误码为 status_page_locked 才算锁定', async () => {
    await expect(isStatusLocked(jsonResponse(401, { error: 'status_page_locked' }))).resolves.toBe(true);
  });

  it('401 但错误码不同则不算锁定', async () => {
    await expect(isStatusLocked(jsonResponse(401, { error: 'Unauthorized' }))).resolves.toBe(false);
  });

  it('401 且响应体不是 JSON 时安全返回 false', async () => {
    await expect(isStatusLocked(new Response('<html>401</html>', { status: 401 }))).resolves.toBe(false);
  });
});

describe('statusLogin', () => {
  it('成功时保存 token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { token: 'status-tok' })));

    await expect(statusLogin('pw')).resolves.toEqual({ ok: true });
    expect(localStorage.getItem(STATUS_TOKEN_KEY)).toBe('status-tok');
  });

  it('密码错误返回通用文案', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'invalid_password' })));

    await expect(statusLogin('bad')).resolves.toEqual({ ok: false, error: 'statusLock.wrongPassword' });
    expect(localStorage.getItem(STATUS_TOKEN_KEY)).toBeNull();
  });

  it('未配置密码时返回专门的提示键', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, { error: 'status_page_not_configured' })));

    await expect(statusLogin('pw')).resolves.toEqual({ ok: false, error: 'statusLock.notConfigured' });
  });

  it('响应体缺少 token 时视为失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {})));

    await expect(statusLogin('pw')).resolves.toEqual({ ok: false });
    expect(localStorage.getItem(STATUS_TOKEN_KEY)).toBeNull();
  });

  it('登录请求打到正确的地址', async () => {
    const f = vi.fn(async () => jsonResponse(200, { token: 't' }));
    vi.stubGlobal('fetch', f);

    await statusLogin('pw');

    expect(lastCall(f)[0]).toBe('/api/status/login');
    expect(lastCall(f)[1].method).toBe('POST');
    expect(JSON.parse(lastCall(f)[1].body)).toEqual({ password: 'pw' });
  });
});

describe('statusLogout', () => {
  it('清除已保存的 token', () => {
    localStorage.setItem(STATUS_TOKEN_KEY, 'status-tok');

    statusLogout();

    expect(localStorage.getItem(STATUS_TOKEN_KEY)).toBeNull();
  });
});
