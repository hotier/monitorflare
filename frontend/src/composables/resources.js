// ============================================================
// 全局数据资源声明
//
// 这里是"配置",机制在 useResource.js。同一份数据只声明一次,谁要用谁 import。
// 调用方请用命名空间导入,避免和视图内的同名 computed 撞名:
//   import * as resources from '../composables/resources';
//   resources.publicMonitors.data.value
//
// 新增资源前先确认:这个端点是否已经被别的页面拉过?如果是,务必复用同一份,
// 否则又会出现"同一个人被 4 处各拉一遍"的老问题(/settings 就是这么来的)。
// ============================================================
import { defineResource, defineResourceFamily } from './useResource';
import { authFetchT, fetchT, withRetry, isStatusLocked } from '../utils/api';
import { EP } from '../utils/endpoints';
import { adminToken } from './useAuth';

// ── 响应读取的统一收口 ──

/** 带 HTTP 状态的错误:视图据此区分"服务端报错"与"连不上" */
const httpError = async (res, what) => {
    let detail = '';
    try {
        const d = await res.clone().json();
        detail = d?.error || '';
    } catch { /* 响应不是 JSON(如网关返回的 HTML),detail 留空 */ }
    const e = new Error(`${what} ${res.status}`);
    e.status = res.status;
    e.detail = detail;
    return e;
};

/** 私密模式未登录。单独打标记,视图据此切到锁屏而不是报错 */
const lockedError = () => {
    const e = new Error('status_page_locked');
    e.locked = true;
    return e;
};

/** 公开接口:锁定 → 锁屏;非 2xx → 抛错;2xx → json */
const readPublic = async (res, what) => {
    if (await isStatusLocked(res)) throw lockedError();
    if (!res.ok) throw await httpError(res, what);
    return res.json();
};

/**
 * 管理接口 GET
 *
 * 未登录时**直接返回 null,不发请求** —— 这点很重要:管理接口收到 401 时
 * authFetchT 会整页刷新,如果没登录还硬发,就会变成刷新死循环。
 */
const adminGet = async (url, what) => {
    if (!adminToken.value) return null;
    const res = await withRetry(() => authFetchT(url));
    if (!res.ok) throw await httpError(res, what);
    return res.json();
};

// ── 资源 ──

/**
 * 站点配置(标题/描述/logo/语言/时区…)
 *
 * 状态页、详情页、管理页、设置弹窗读的都是同一份,统一到这里,不再各拉一遍。
 * ttl 给 5 分钟:它几乎不变,而保存设置时会主动 refresh()。
 */
export const siteSettings = defineResource('settings', {
    ttl: 5 * 60_000,
    persist: {
        key: 'monitorflare_snapshot_settings',
        version: 1,
        maxAge: 24 * 3600_000,
        // 两种情况都不落盘:
        // 1. GET /settings 在私密模式下经鉴权后会把 status_page_password 的哈希
        //    一起返回(worker 侧无条件 getSettingsMap,没有字段过滤),哈希落进
        //    localStorage 会在共享设备上长期留存;
        // 2. 站点本身就是私密模式时,任何一份缓存都可能被未授权者读到。
        pick: (d) => (d && !d.status_page_password && d.status_page_visibility !== 'private' ? d : null),
    },
    fetcher: async () => {
        const res = await withRetry(() => fetchT(EP.settings()));
        return readPublic(res, 'settings');
    },
});

/**
 * 公开监控列表(含 90 天可用率、最近延迟)
 *
 * 状态页和管理页都要它。ttl 对齐服务端的公开接口缓存(30 秒):比它再短没有意义 ——
 * 拿到的会是同一份快照,只是多打一次请求。
 */
export const publicMonitors = defineResource('monitors-public-details', {
    ttl: 30_000,
    persist: { key: 'monitorflare_snapshot_monitors', version: 1, maxAge: 24 * 3600_000 },
    fetcher: async () => {
        const res = await withRetry(() => fetchT(EP.publicMonitors()));
        return readPublic(res, 'monitors');
    },
});

/**
 * 单监控详情(基础信息 + 可用率 + 延迟曲线 + 日志 + 事件)
 *
 * 按 id + range 分 key:区间不同就是不同的数据集,切回看过的区间应该直接命中。
 * ttl 同样对齐服务端 30 秒。
 *
 * **刻意不落 localStorage**:一份 24h 详情含 288 个曲线点 + 50 条日志,约数十 KB,
 * 二十几份就能吃掉配额的一大块;它还是私密站点里信息量最大的一份数据。
 * 冷启动打开详情链接靠"状态页那份列表预填"顶上,不靠快照。
 *
 * 上限 24:够覆盖"逐个点开十几个监控再回看",再多用 FIFO 淘汰。
 */
export const monitorDetail = defineResourceFamily('monitor-detail', {
    key: ({ id, range }) => `${id}:${range}`,
    build: ({ id, range = '24h', limit = 50 }) => ({
        ttl: 30_000,
        fetcher: async () => {
            const res = await withRetry(() => fetchT(EP.monitorDetail({ id, range, limit })));
            // 404 不是错误,是"这个 id 不存在"这个事实 —— 交给视图渲染未找到页
            if (res.status === 404) return { notFound: true };
            const data = await readPublic(res, 'monitor');
            return {
                monitor: data.monitor || null,
                logs: data.logs || [],
                incidents: data.incidents || [],
                latency_series: data.latency_series || [],
            };
        },
    }),
    max: 24,
});

/** 公开事件(只含 status = active,状态页公告用) */
export const publicIncidents = defineResource('incidents-public', {
    ttl: 30_000,
    fetcher: async () => {
        const res = await withRetry(() => fetchT(EP.incidents()));
        return readPublic(res, 'incidents');
    },
});

/**
 * 管理端监控列表(含配置字段,鉴权)
 *
 * 响应是 { monitors: [...] } 而不是裸数组:同一个端点还能靠
 * ?include=logs,stats 附带日志与可用率,列表只是其中一份。
 * 未登录时 adminGet 返回 null,这里要原样透传 —— 依赖 data 为 null
 * 判断"还没加载过"的逻辑还在用。
 */
export const adminMonitors = defineResource('monitors-admin', {
    ttl: 15_000,
    fetcher: async () => {
        const d = await adminGet(EP.monitors(), 'monitors');
        return d ? d.monitors : null;
    },
});

/** 自检信息。状态栏里看的东西,跟着 60 秒的轮询节奏走 */
export const health = defineResource('health', {
    ttl: 60_000,
    fetcher: () => adminGet(EP.health(), 'health'),
});

/** 通知渠道(管理弹窗用)。变更频率低,ttl 放宽到 1 分钟 */
export const notificationChannels = defineResource('notification-channels', {
    ttl: 60_000,
    fetcher: () => adminGet(EP.channels(), 'channels'),
});

/**
 * 管理端事件全量列表
 *
 * 注意与 publicIncidents 的区别:那是 GET /incidents(只返回 active),
 * 这是 GET /incidents?status=all(管理员视角的全量)。同一个端点的两种口径,
 * 参数不同而已,不能当成同一份缓存。
 */
export const allIncidents = defineResource('incidents-all', {
    ttl: 30_000,
    fetcher: () => adminGet(EP.incidents({ status: 'all' }), 'incidents'),
});

/** API 密钥。含明文密钥的只有创建响应,列表本身是安全的 */
export const apiKeys = defineResource('api-keys', {
    ttl: 60_000,
    fetcher: () => adminGet(EP.apiKeys(), 'keys'),
});
