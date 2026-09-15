import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineResource, defineResourceFamily, resetResources } from '../src/composables/useResource';

/** 快照配置的简写 */
const snap = (key, extra = {}) => ({ key, version: 1, maxAge: 24 * 3600_000, ...extra });

/** 造一个能手动控制何时 resolve 的 fetcher */
const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
};

beforeEach(() => {
    resetResources();
    localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('资源注册', () => {
    it('同一 key 重复声明返回同一实例', () => {
        const a = defineResource('dup', { fetcher: async () => 1 });
        const b = defineResource('dup', { fetcher: async () => 2 });
        expect(a).toBe(b);
    });

    it('不同 key 互不干扰', async () => {
        const a = defineResource('a', { fetcher: async () => 'a' });
        const b = defineResource('b', { fetcher: async () => 'b' });
        await Promise.all([a.ensure(), b.ensure()]);
        expect(a.data.value).toBe('a');
        expect(b.data.value).toBe('b');
    });
});

describe('加载态语义', () => {
    it('首次加载无数据时置 loading', async () => {
        const d = deferred();
        const res = defineResource('first', { fetcher: () => d.promise });
        const p = res.ensure();
        expect(res.loading.value).toBe(true);
        expect(res.refreshing.value).toBe(false);
        d.resolve([1]);
        await p;
        expect(res.loading.value).toBe(false);
    });

    // 这条是"切回页面不闪骨架屏"的核心保证:有数据时绝不能置 loading
    it('已有数据时刷新只置 refreshing,不置 loading', async () => {
        const d = deferred();
        let calls = 0;
        const res = defineResource('second', {
            fetcher: () => { calls++; return calls === 1 ? Promise.resolve(['a']) : d.promise; },
        });
        await res.ensure();
        expect(calls).toBe(1);

        const p = res.ensure();
        expect(res.refreshing.value).toBe(true);
        expect(res.loading.value).toBe(false);
        d.resolve(['b']);
        await p;
        expect(res.data.value).toEqual(['b']);
        expect(res.refreshing.value).toBe(false);
    });

    it('ttl 内重复 ensure 不发请求,force 才发', async () => {
        const fetcher = vi.fn(async () => [1]);
        const res = defineResource('ttl', { fetcher, ttl: 60_000 });
        await res.ensure();
        await res.ensure();
        await res.ensure();
        expect(fetcher).toHaveBeenCalledTimes(1);
        await res.refresh();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('ttl 过期后 ensure 会重新请求', async () => {
        vi.useFakeTimers();
        const fetcher = vi.fn(async () => [1]);
        const res = defineResource('ttl-expired', { fetcher, ttl: 1000 });
        await res.ensure();
        vi.advanceTimersByTime(1500);
        await res.ensure();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('并发 ensure 只发一次请求', async () => {
        const fetcher = vi.fn(async () => [1]);
        const res = defineResource('inflight', { fetcher });
        await Promise.all([res.ensure(), res.ensure(), res.ensure()]);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
});

describe('失败处理', () => {
    it('失败时保留旧数据且不向外抛异常', async () => {
        let boom = false;
        const res = defineResource('fail', {
            fetcher: async () => { if (boom) throw new Error('boom'); return [1]; },
        });
        await res.ensure();

        boom = true;
        await expect(res.ensure()).resolves.toBeUndefined();
        expect(res.data.value).toEqual([1]);
        expect(res.error.value.message).toBe('boom');
    });

    it('成功后清掉上一次的错误', async () => {
        let boom = true;
        const res = defineResource('recover', {
            fetcher: async () => { if (boom) throw new Error('boom'); return [1]; },
        });
        await res.ensure();
        expect(res.error.value).not.toBe(null);
        boom = false;
        await res.ensure();
        expect(res.error.value).toBe(null);
    });

    it('带 locked 标记的错误会置 locked,成功后清除', async () => {
        let locked = true;
        const res = defineResource('locked', {
            fetcher: async () => {
                if (locked) { const e = new Error('status_page_locked'); e.locked = true; throw e; }
                return [1];
            },
        });
        await res.ensure();
        expect(res.locked.value).toBe(true);

        locked = false;
        await res.ensure();
        expect(res.locked.value).toBe(false);
    });

    // 站点从公开切到私密后,不能让老访客继续从 localStorage 读回上次缓存的公开内容
    it('被 locked 挡下时同时清掉内存数据与快照', async () => {
        localStorage.setItem('k_lk', JSON.stringify({ v: 1, at: Date.now(), data: [1] }));
        const res = defineResource('locked-purge', {
            persist: snap('k_lk'),
            fetcher: async () => { const e = new Error('status_page_locked'); e.locked = true; throw e; },
        });
        expect(res.data.value).toEqual([1]);   // 先由快照渲染

        await res.ensure();
        expect(res.locked.value).toBe(true);
        expect(res.data.value).toBe(null);
        expect(localStorage.getItem('k_lk')).toBe(null);
    });
});

describe('invalidate', () => {
    it('清空数据、时间戳与快照', async () => {
        const res = defineResource('inv', {
            persist: snap('k_inv'),
            fetcher: async () => [1],
        });
        await res.ensure();
        expect(localStorage.getItem('k_inv')).not.toBe(null);

        res.invalidate();
        expect(res.data.value).toBe(null);
        expect(res.updatedAt.value).toBe(0);
        expect(localStorage.getItem('k_inv')).toBe(null);
    });

    it('清空后回落到首次加载语义', async () => {
        const res = defineResource('inv2', { fetcher: async () => [1] });
        await res.ensure();
        res.invalidate();
        const p = res.ensure();
        expect(res.loading.value).toBe(true);
        await p;
    });
});

describe('首屏快照', () => {
    it('拉取成功后写入快照,新实例能同步恢复', async () => {
        const res = defineResource('s1', {
            persist: snap('k_s1'),
            ttl: 60_000,
            fetcher: async () => ({ a: 1 }),
        });
        await res.ensure();
        expect(JSON.parse(localStorage.getItem('k_s1')).data).toEqual({ a: 1 });

        resetResources();
        const res2 = defineResource('s1', {
            persist: snap('k_s1'),
            ttl: 60_000,
            fetcher: async () => ({ a: 2 }),
        });
        expect(res2.data.value).toEqual({ a: 1 });
    });

    // 快照是"过期但仍可用"的数据:updatedAt 归零,保证首次 ensure 会去后台核对
    it('恢复后 updatedAt 为 0,首次 ensure 走后台刷新', async () => {
        localStorage.setItem('k_s2', JSON.stringify({ v: 1, at: Date.now(), data: [1] }));
        const fetcher = vi.fn(async () => [2]);
        const res = defineResource('s2', {
            persist: snap('k_s2'),
            ttl: 60_000,
            fetcher,
        });

        expect(res.data.value).toEqual([1]);
        expect(res.updatedAt.value).toBe(0);

        const p = res.ensure();
        expect(res.loading.value).toBe(false);
        expect(res.refreshing.value).toBe(true);
        await p;
        expect(res.data.value).toEqual([2]);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('version 不匹配则丢弃', () => {
        localStorage.setItem('k_s3', JSON.stringify({ v: 99, at: Date.now(), data: [1] }));
        const res = defineResource('s3', { persist: snap('k_s3'), fetcher: async () => [2] });
        expect(res.data.value).toBe(null);
        expect(localStorage.getItem('k_s3')).toBe(null);
    });

    it('超过 maxAge 则丢弃', () => {
        const stale = Date.now() - 48 * 3600_000;
        localStorage.setItem('k_s4', JSON.stringify({ v: 1, at: stale, data: [1] }));
        const res = defineResource('s4', {
            persist: snap('k_s4', { maxAge: 24 * 3600_000 }),
            fetcher: async () => [2],
        });
        expect(res.data.value).toBe(null);
        expect(localStorage.getItem('k_s4')).toBe(null);
    });

    it('pick 返回 null 时不写入,并清掉旧快照', async () => {
        localStorage.setItem('k_s5', JSON.stringify({ v: 1, at: Date.now(), data: { old: true } }));
        const res = defineResource('s5', {
            persist: snap('k_s5', { pick: () => null }),
            fetcher: async () => ({ secret: 'x' }),
        });
        expect(res.data.value).toEqual({ old: true });
        await res.ensure();
        expect(localStorage.getItem('k_s5')).toBe(null);
    });

    it('pick 可以对数据做裁剪', async () => {
        const res = defineResource('s6', {
            persist: snap('k_s6', { pick: (d) => ({ keep: d.keep }) }),
            fetcher: async () => ({ keep: 1, drop: 2 }),
        });
        await res.ensure();
        expect(JSON.parse(localStorage.getItem('k_s6')).data).toEqual({ keep: 1 });
    });

    it('存了非法内容不炸,当作没有快照', () => {
        localStorage.setItem('k_s7', 'not-json{{');
        expect(() => defineResource('s7', { persist: snap('k_s7'), fetcher: async () => [1] })).not.toThrow();
        expect(defineResource('s7', { persist: snap('k_s7'), fetcher: async () => [1] }).data.value).toBe(null);
    });

    it('超过体积上限则不写入', async () => {
        const res = defineResource('s8', {
            persist: snap('k_s8'),
            fetcher: async () => ({ big: 'x'.repeat(600 * 1024) }),
        });
        await res.ensure();
        expect(localStorage.getItem('k_s8')).toBe(null);
    });
});

describe('资源族(参数化资源)', () => {
    /** 造一个 (id, range) 二维参数的族,数据就是参数本身 */
    const makeFamily = (prefix, extra = {}) => defineResourceFamily(prefix, {
        key: ({ id, range }) => `${id}:${range}`,
        build: ({ id, range }) => ({ fetcher: async () => ({ id, range }) }),
        ...extra,
    });

    it('不同参数各一份实例,数据互不串', async () => {
        const family = makeFamily('f1');
        const a = family({ id: 1, range: '24h' });
        const b = family({ id: 1, range: '7d' });
        const c = family({ id: 2, range: '24h' });
        expect(a).not.toBe(b);
        await Promise.all([a.ensure(), b.ensure(), c.ensure()]);
        expect(a.data.value).toEqual({ id: 1, range: '24h' });
        expect(b.data.value).toEqual({ id: 1, range: '7d' });
        expect(c.data.value).toEqual({ id: 2, range: '24h' });
    });

    it('相同参数复用同一实例,新鲜期内不重复取数', async () => {
        let calls = 0;
        const family = defineResourceFamily('f2', {
            key: ({ id }) => String(id),
            build: () => ({ ttl: 60_000, fetcher: async () => { calls++; return calls; } }),
        });
        const first = family({ id: 9 });
        await first.ensure();
        await family({ id: 9 }).ensure();
        expect(calls).toBe(1);
        expect(family({ id: 9 })).toBe(first);
    });

    it('超过上限按 FIFO 淘汰最早的实例', async () => {
        const family = makeFamily('f3', { max: 2 });
        const a = family({ id: 1, range: '24h' });
        await a.ensure();
        await family({ id: 2, range: '24h' }).ensure();
        const c = family({ id: 3, range: '24h' });
        await c.ensure();

        // 2、3 仍在(命中已有实例不会改变淘汰顺序)
        expect(family({ id: 2, range: '24h' }).data.value).toEqual({ id: 2, range: '24h' });
        expect(family({ id: 3, range: '24h' })).toBe(c);
        // 1 已被淘汰:再取就是全新实例,数据为空
        const a2 = family({ id: 1, range: '24h' });
        expect(a2).not.toBe(a);
        expect(a2.data.value).toBe(null);
    });

    it('resetResources 连族一起清,下次取到的是新实例', async () => {
        const family = makeFamily('f4');
        const a = family({ id: 1, range: '24h' });
        await a.ensure();
        resetResources();
        const a2 = family({ id: 1, range: '24h' });
        expect(a2).not.toBe(a);
        expect(a2.data.value).toBe(null);
    });
});
