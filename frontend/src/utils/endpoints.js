// ============================================================
// API 端点总表
//
// 所有请求地址在这里拼装，业务代码里不再出现 `${API_BASE}/xxx` 这类裸字符串。
//
// 为什么要有这一层：
// - 入口的 stripApiPrefix 只剥一层 /api，地址多写一层前缀（历史上
//   `${API_BASE}/api/subscribe` 就是这么来的，实际打到了 /api/api/subscribe）
//   会直接 404，而散在十几个文件里的字符串没人能一眼看出来；
// - 同一个端点被哪些页面在用、有没有重复拉取，是缓存治理的前提，
//   端点集中后"谁在用"这个问题才有唯一的答案。
//
// 约定：
// - 这里只写裸路径（/monitors），/api 前缀统一由 API_BASE 补上。服务端入口会把
//   /api/xxx 重写成 /xxx，两种写法等价，但前端只需要保留一种。
// - 每个函数返回可直接交给 fetchT / authFetchT 的完整地址。
// - 路径片段走 seg() 编码，查询串走 query()（null / undefined / '' 一律丢弃，
//   0 与 false 必须保留 —— offset=0 是合法值）。
//
// 三层导出，各管一件事，且都源自同一份 PATHS：
//   PATHS   —— 路径模板，:id / :token 是占位符，唯一的路径出处
//   EP      —— 实际请求地址（填真实值 + 查询串），业务代码用它
//   docPath —— 文档展示路径（保留占位符），ApiDocsPage 用它
// 文档与调用同源，改路由时不会只改一边。
// ============================================================

/**
 * 请求前缀
 *
 * 服务端入口会把 /api/xxx 重写成裸路径 /xxx，所以 /api/… 与裸路径等价。
 * 前端统一走带前缀的写法：Pages 的静态资源不会命中这些路径，留着前缀
 * 在抓包和日志里更容易一眼区分"接口"和"页面"。
 */
export const API_BASE = '/api';

/** 路径里的动态片段。id 目前都是数字，编码只是让拼串这件事只有一种写法 */
const seg = (v) => encodeURIComponent(String(v));

/** 拼查询串。返回 'detail=1' 或 ''（不带 ?，拼接方自己加） */
const query = (params) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
        if (v === null || v === undefined || v === '') continue;
        usp.set(k, String(v));
    }
    return usp.toString();
};

/** 把模板里的 :id / :token 换成真实值；没给值的占位符原样保留 */
const fill = (pattern, values = {}) =>
    pattern.replace(/:([A-Za-z]+)/g, (m, k) => (k in values ? seg(values[k]) : m));

/**
 * 端点模板 —— 全站唯一的路径出处
 *
 * 没有列在这里的路径，要么是静态资源，要么就是拼错了。
 * 其中一部分前端并不调用（v1 数据层、入站 webhook、退订），只有文档和外部脚本用，
 * 但同样收在这里：它们是同一套 API，散在文档里就会跟实现各说各话。
 */
export const PATHS = {
    // ── 公开 ──
    status: '/status',
    // 公开清单与单监控详情不再单独占路径:都走 /monitors,靠 ?scope=public 与
    // ?view=detail&id= 区分(见 EP.publicMonitors / EP.monitorDetail)。
    // 事件公开读与管理写本来就共用这一条,管理侧的改 / 删同样靠 ?id= 指认。
    incidents: '/incidents',
    feed: '/feed.xml',
    subscribe: '/subscribe',
    unsubscribe: '/unsubscribe',

    // ── v1 数据层：API Key 鉴权，供外部脚本取全量数据 ──
    v1Monitors: '/v1/monitors',
    v1Logs: '/v1/logs',
    v1Incidents: '/v1/incidents',
    v1Uptime: '/v1/uptime',
    v1Export: '/v1/export',

    // ── 入站 webhook：token 在路径里，是渠道自己的凭据 ──
    webhook: '/webhooks/:token',

    // ── 监控项 ──
    // 全站只剩 /monitors 这一条:成员操作不再占 /monitors/:id,"操作哪一个"
    // 一律由 ?id= 指认(与 DELETE /api/manage/apiTokens?id= 同一个路子),
    // 差别全在方法与参数上。
    monitors: '/monitors',

    // ── 通知渠道 ──
    channels: '/notification-channels',

    // ── 告警模板 ──
    templates: '/alert-templates',

    // ── API 密钥 ──
    apiKeys: '/api-keys',

    // ── 站点配置与鉴权 ──
    settings: '/settings',
    authLogin: '/auth/login',
    magicLinkVerify: '/auth/magic-link/verify',
    statusLogin: '/status/login',

    // ── 其它 ──
    health: '/health',
    backup: '/backup',
};

/** 实际请求地址：/api 前缀 + 填好值的模板 + 查询串 */
const url = (key, params, values) => `${API_BASE}${fill(PATHS[key], values)}${qs(params)}`;

/** 查询串前面补上 ?，没有参数时返回空串 */
const qs = (params) => {
    const s = query(params);
    return s ? `?${s}` : '';
};

export const EP = {
    // ── 站点配置与鉴权 ──

    /**
     * GET 是公开读（状态页/详情页都要），PUT 是管理写。
     * 同一个端点两种口径：公开读不带 status_page_password，管理写才带。
     */
    settings: () => url('settings'),
    /** 管理端登录：密码换会话 token */
    authLogin: () => url('authLogin'),
    /** 魔法链接换会话 token */
    magicLinkVerify: (token) => url('magicLinkVerify', { token }),
    /** 私密站点：访问密码换状态页 token */
    statusLogin: () => url('statusLogin'),

    // ── 公开读取 ──

    /**
     * 公开监控清单。与 EP.monitors() 是同一条地址:?scope=public 切到公开口径
     * (免鉴权),detail=1 额外带 90 天可用率与最近延迟。
     */
    publicMonitors: () => url('monitors', { scope: 'public', detail: 1 }),
    /** 单监控详情:同一条地址换 ?view=detail —— 基础信息 + 可用率 + 延迟曲线 + 日志 + 事件 */
    monitorDetail: ({ id, range = '24h', limit = 50 } = {}) =>
        url('monitors', { scope: 'public', view: 'detail', id, range, limit }),
    /**
     * 事件。不传参是公开口径（只返回 active）；
     * 传 { status: 'all' } 是管理口径（含已解决的历史事件）。
     */
    incidents: (params) => url('incidents', params),
    /** RSS 订阅源。不进 fetch，给 <a href> 用 */
    feed: () => url('feed'),
    /** 邮件订阅 */
    subscribe: () => url('subscribe'),

    // ── 监控项（管理） ──

    /**
     * 集合地址 —— 读与写都在这条上:
     *   GET  ?id= / ?include=logs|stats   取不同口径的数据
     *   POST ?action=batch               批量暂停 / 恢复 / 删除 / 探测
     *   PUT  ?action=reorder             改排序
     */
    monitors: (params) => url('monitors', params),
    /**
     * 成员操作 —— 与集合同一条地址,目标交给 ?id=:
     *   POST   ?id=3&action=check|pause   触发动作
     *   PATCH  ?id=3                      改配置
     *   DELETE ?id=3                      删除
     */
    monitor: (id, params) => url('monitors', { id, ...params }),

    // ── 事件（管理） ──

    /** 改事件 / 删事件:与集合同一条地址,目标交给 ?id= */
    incident: (id) => url('incidents', { id }),

    // ── 通知渠道 ──

    channels: () => url('channels'),
    /**
     * 渠道的成员操作 —— 与集合同一条地址,目标交给 ?id=:
     *   PATCH  ?id=3              改配置
     *   DELETE ?id=3              删除
     *   POST   ?id=3&action=test  只测这一个渠道(不带 id 就是测全部已启用渠道)
     */
    channel: (id, params) => url('channels', { id, ...params }),
    /** 向全部已启用渠道发一条测试告警:同一条集合地址上的 ?action=test */
    testAlert: () => url('channels', { action: 'test' }),

    // ── 告警模板 ──

    templates: () => url('templates'),
    /**
     * 模板版本的成员操作 —— 与集合同一条地址,目标交给 ?id=:
     *   PUT    ?id=3                   改这一版本的内容
     *   POST   ?id=3&action=duplicate  复制一份出新版本
     *   POST   ?id=3&action=default    设为默认版本
     *   DELETE ?id=3                   删除版本
     */
    template: (id, params) => url('templates', { id, ...params }),

    // ── API 密钥 ──

    apiKeys: () => url('apiKeys'),
    /** 删除密钥:与集合同一条地址,目标交给 ?id= */
    apiKey: (id) => url('apiKeys', { id }),

    // ── 其它 ──

    /** 自检信息：调度器状态、版本、存储用量 */
    health: () => url('health'),
    /** 整站备份：GET 拿快照，POST 用快照覆盖 */
    backup: () => url('backup'),
};

/**
 * 文档里的路径：/api 前缀 + 原样保留占位符的模板（/api/webhooks/:token）。
 *
 * 传 PATHS 的**值**而不是键名字符串 —— 键名拼错会立刻拿到 undefined，
 * 比拼错后静默显示一条错路径好找得多，所以这里直接抛。
 */
export const docPath = (pattern) => {
    if (!pattern) throw new Error('docPath: 端点模板为空，检查 PATHS 的引用是否写错');
    return `${API_BASE}${pattern}`;
};

/** 查询串。文档拼示例查询串与 EP 内部共用同一套丢弃规则，避免两处写法分叉 */
export const toQuery = query;
