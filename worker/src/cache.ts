// ============================================================
// MonitorFlare — Worker 内存缓存
//
// 存在的唯一理由:把"公开只读数据"的重复计算挡在 D1 之外。
//
// 两层缓存的关系:
//   L2(本文件)  isolate 内有效,合并同一 isolate 上的并发轮询;
//   L3(HTTP)    响应头 s-maxage,让 Cloudflare 边缘直接回,连 Worker 都不进。
// 两者叠加后,状态页 30 秒轮询真正打到 D1 的次数是"每 30 秒一次",
// 而不是"每个访客每次轮询一次"。
//
// 私密模式(status_page_visibility=private)下调用方必须传 cacheable=false:
// 那种响应带站点私有信息,不能进任何共享缓存。
// ============================================================

type Entry = { value: unknown; expires: number };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** 条目上限。公开资源的 key 数量很小(十几个量级),超了先清过期再整体丢弃一半 */
const MAX_ENTRIES = 256;

function purge(): void {
  const now = Date.now();
  for (const [k, v] of store) if (v.expires <= now) store.delete(k);
  if (store.size > MAX_ENTRIES) {
    let drop = Math.ceil(store.size / 2);
    for (const k of store.keys()) {
      if (drop-- <= 0) break;
      store.delete(k);
    }
  }
}

/**
 * 取缓存;未命中(或已过期)时调 producer 并写入缓存。
 *
 * 并发去重:同一个 key 的并发请求共享一次 producer 调用 —— 这正是缓存的目的,
 * 否则"缓存刚过期 + 10 个访客同时刷新"会瞬间打穿到 D1 十次。
 */
export async function cached<T>(key: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const task = (async () => {
    try {
      const value = await producer();
      store.set(key, { value, expires: Date.now() + ttlMs });
      if (store.size > MAX_ENTRIES) purge();
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

/** 按前缀失效。设置变更、监控增删改之后调用 */
export function invalidate(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

// ── HTTP 缓存头 ──

/** 公开只读资源:浏览器缓存 10s、边缘缓存 30s、过期后 60s 内可先用陈旧副本 */
export const PUBLIC_CACHE = 'public, max-age=10, s-maxage=30, stale-while-revalidate=60';
/** 私密站点或需要鉴权的响应:任何共享缓存都不许留 */
export const PRIVATE_CACHE = 'private, no-store';
