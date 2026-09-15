// ============================================================
// useResource — 模块级缓存资源
//
// 解决"切页必闪骨架屏"的根子:之前每个页面把数据放在组件内的 ref 里,
// 组件一销毁缓存就没了,所以不管数据变没变都要重拉一遍。
//
// 这里的资源是**模块级单例**:defineResource 用 key 去重,同一个 key
// 在进程内只创建一份数据和一份请求状态,与组件的挂载/卸载完全解耦。
// 组件只负责"读",不负责"拥有"。
//
// 使用约定:
//   1. 资源在模块顶层声明(见 composables/resources.js),不要在组件里声明 —— 
//      在组件里声明就等于又变回组件级缓存。defineResource 内部按 key 去重,
//      即使被重复调用也不会产生第二份状态。
//   2. 骨架屏判据只认 loading。有旧数据时走的永远是 refreshing,不会闪骨架屏。
//   3. ensure() 不抛异常,失败信息在 error 里。调用方不必到处 try/catch。
// ============================================================
import { ref } from 'vue';

/** 同一份快照超过这个体积就不写 localStorage 了(配额通常 5MB,给别的键留空间) */
const SNAPSHOT_MAX_BYTES = 512 * 1024;

/** key -> 资源实例。模块级,跨组件共享 */
const registry = new Map();

/** 资源族(FIFO 队列)列表,仅供测试清空 */
const families = [];

/**
 * 构造持久化读写(首屏快照)
 *
 * 快照的意义:冷启动/整页刷新时,数据要等一次网络往返才到。把上次的结果存下来,
 * 模块初始化时**同步**读回内存,首屏就能立刻渲染,再由 ensure() 后台刷新覆盖。
 *
 * 存的是 { v, at, data }:v 是结构版本,at 是写入时间。
 * 任一不匹配就丢弃 —— 宁可重新拉,也不要让新代码去消费旧结构。
 */
function createSnapshotStore(persist) {
    const { key, version, maxAge, pick = (d) => d } = persist;

    return {
        load() {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) return null;
                const snap = JSON.parse(raw);
                if (!snap || snap.v !== version) { localStorage.removeItem(key); return null; }
                if (maxAge && Date.now() - snap.at > maxAge) { localStorage.removeItem(key); return null; }
                return snap.data ?? null;
            } catch {
                // 存了非 JSON / localStorage 被禁用 —— 当没有快照处理
                return null;
            }
        },
        save(data) {
            try {
                const picked = pick(data);
                // pick 返回 null 表示"这份数据不能落盘"(如含敏感字段),顺手清掉旧的
                if (picked == null) { localStorage.removeItem(key); return; }
                const raw = JSON.stringify({ v: version, at: Date.now(), data: picked });
                if (raw.length > SNAPSHOT_MAX_BYTES) { localStorage.removeItem(key); return; }
                localStorage.setItem(key, raw);
            } catch {
                // 超配额 / 隐私模式 —— 降级为纯内存缓存,不影响功能
            }
        },
        clear() {
            try { localStorage.removeItem(key); } catch { /* 忽略 */ }
        },
    };
}

/**
 * 声明一个缓存资源
 *
 * @param {string} key            全局唯一标识,重复调用返回同一实例
 * @param {object} options
 * @param {Function} options.fetcher  取数函数,返回解析后的数据;失败请直接 throw
 * @param {number}  [options.ttl]     新鲜期(毫秒)。期内重复 ensure 不发请求
 * @param {object}  [options.persist] 首屏快照配置 { key, version, maxAge, pick }
 */
export function defineResource(key, options = {}) {
    if (registry.has(key)) return registry.get(key);
    return createResource(key, options);
}

function createResource(key, { fetcher, ttl = 0, persist = null } = {}) {
    const store = persist ? createSnapshotStore(persist) : null;

    // 注意:这里必须是深响应式 ref,不能图省事用 shallowRef。
    // 现有代码大量依赖就地修改数组元素(MonitorList 读 m._checking、
    // ChannelsModal 写 ch.enabled),浅响应式会让这些交互静默失效。
    const data = ref(store ? store.load() : null);

    /** 仅在"当前无数据且请求进行中"为 true —— 这是骨架屏的唯一判据 */
    const loading = ref(false);
    /** 有数据时的后台刷新中。绝不能拿它去控制骨架屏,否则切回页面又会闪 */
    const refreshing = ref(false);
    const error = ref(null);
    /** 最近一次成功的时间戳。快照恢复后是 0,即"视为过期,但先拿它渲染" */
    const updatedAt = ref(0);
    /** 被私密模式挡下(status_page_locked) */
    const locked = ref(false);

    let inflight = null;

    const run = async () => {
        try {
            const result = await fetcher();
            data.value = result;
            updatedAt.value = Date.now();
            error.value = null;
            locked.value = false;
            store?.save(result);
        } catch (e) {
            // 失败保留旧数据:网络抖一下不该把已经渲染好的内容清掉
            error.value = e;
            if (e && e.locked) {
                locked.value = true;
                // 被私密模式挡下时顺手清掉快照和内存数据。
                // 不清的话,站点从公开切成私密之后,老访客的冷加载仍会先把上次缓存的
                // 公开内容渲染出来,等 401 回来才切锁屏 —— 那几百毫秒是实打实的越权展示。
                // 清掉之后最坏也只有"切换后的第一次访问"会闪一下,后续走锁屏。
                data.value = null;
                store?.clear();
            }
        } finally {
            inflight = null;
            loading.value = false;
            refreshing.value = false;
        }
    };

    const ensure = ({ force = false } = {}) => {
        // 并发去重:多个组件同时 ensure(如列表页 + 轮询)只发一次请求
        if (inflight) return inflight;
        // 命中新鲜期:什么都不做
        if (!force && data.value != null && Date.now() - updatedAt.value < ttl) return Promise.resolve();

        // 关键分支:有数据就走 refreshing,不置 loading —— 这是"切回页面不闪骨架屏"的实现点
        if (data.value == null) loading.value = true;
        else refreshing.value = true;

        inflight = run();
        return inflight;
    };

    const api = {
        key,
        data,
        loading,
        refreshing,
        error,
        updatedAt,
        locked,

        ensure,
        refresh: () => ensure({ force: true }),

        /** 清空数据、时间戳与快照。用于 404、登出、私密模式重新锁定等 */
        invalidate() {
            data.value = null;
            updatedAt.value = 0;
            error.value = null;
            locked.value = false;
            inflight = null;
            store?.clear();
        },
    };

    registry.set(key, api);
    return api;
}

/**
 * 参数化资源族:同一族内按参数各建一份资源
 *
 * 与 defineResource 的区别:defineResource 的 key 是写死的常量,适合"全站只有一份"的
 * 数据(settings / 列表)。而"监控详情"是同一个接口、不同参数 —— 用 defineResource
 * 就得在调用点拼字符串 key,去重逻辑散落各处;族把它收口到这里。
 *
 * 上限是必须的:参数组合(id × range)可以无限增长,而监控详情页的数据量不小。
 * 超上限按 FIFO 丢最早的 —— 看过的页面才是会被回看的页面。
 *
 * @param {string}   prefix
 * @param {object}   options
 * @param {Function} options.key    (params) => string,族内唯一
 * @param {Function} options.build   (params) => defineResource 的 options
 * @param {number}   [options.max]   保留的实例数上限
 * @returns {(params) => 资源实例}
 */
export function defineResourceFamily(prefix, { key, build, max = 24 } = {}) {
    const order = [];
    families.push(order);

    return (params) => {
        const k = `${prefix}:${key(params)}`;
        if (!registry.has(k)) {
            while (order.length >= Math.max(max, 1)) registry.delete(order.shift());
            order.push(k);
            createResource(k, build(params));
        }
        return registry.get(k);
    };
}

/** 仅供测试:清空注册表,避免用例之间互相污染 */
export function resetResources() {
    registry.clear();
    for (const order of families) order.length = 0;
}
