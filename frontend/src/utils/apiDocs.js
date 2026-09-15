// ============================================================
// API 文档数据
//
// 端点卡片是数据驱动的：这里声明清单，ApiDocsPage 只负责渲染。
// 从页面里分出来有两个原因：
// - 页面原本近千行，其中一半是这些示例报文，翻起来很累；
// - 分出来才是纯 JS，能被单元测试直接 import —— 端点路径是否真的派生自
//   PATHS、有没有拼错，靠测试守住，不用靠人眼。
//
// 路径一律走 docPath(PATHS.xxx)：文档与前端实际调用同源，
// 改路由时不会出现"文档还写着旧地址"。
// ============================================================

import { PATHS, docPath, toQuery } from './endpoints';

// 每个端点只声明 path / query / params 这些原始信息：完整地址由 requestTarget(ep) 拼，
// 站点换了示例不用逐条改；请求长什么样交给参数表，不再另给一份请求报文。
const GROUPS = [
    {
        id: 'public',
        icon: 'fa-globe',
        auth: 'none',
        titleKey: 'apiDocs.publicTitle',
        descKey: 'apiDocs.publicDesc',
        endpoints: [
            {
                id: 'status',
                method: 'GET',
                path: docPath(PATHS.status),
                descKey: 'apiDocs.epStatus',
                noteKey: 'apiDocs.epStatusNote',
                params: [],
                res: `{
  "generated_at": "2026-09-15T08:00:00.000Z",
  "monitors": [
    {
      "id": 1,
      "name": "Main Site",
      "url": "https://example.com",
      "type": "http",
      "status": "up",
      "paused": 0,
      "tags": "prod",
      "last_check": "2026-09-15 08:00:00",
      "uptime_7d": 99.9,
      "uptime_30d": 99.8,
      "latency": 132
    }
  ],
  "incidents": [
    {
      "id": 12,
      "title": "API 响应变慢",
      "severity": "warning",
      "status": "active",
      "type": "incident",
      "created_at": "2026-09-15 07:12:00",
      "resolved_at": null
    }
  ]
}`,
            },
            {
                id: 'monitors-public',
                method: 'GET',
                path: docPath(PATHS.monitors),
                descKey: 'apiDocs.epMonitorsPublic',
                noteKey: 'apiDocs.epMonitorsPublicNote',
                params: [
                    { name: 'scope', in: 'query', def: '', required: true, descKey: 'apiDocs.pScope' },
                    { name: 'id', in: 'query', def: '', descKey: 'apiDocs.pMonitorId' },
                    { name: 'ids', in: 'query', def: '', descKey: 'apiDocs.pMonitorIds' },
                    { name: 'detail', in: 'query', def: '', descKey: 'apiDocs.pDetail' },
                ],
                query: toQuery({ scope: 'public', detail: 1 }),
                res: `// 不带 detail:精简数组
[
  {
    "id": 1,
    "name": "Main Site",
    "url": "https://example.com",
    "type": "http",
    "status": "up",
    "last_check": "2026-09-15 08:00:00",
    "cert_expiry": 1767225600,
    "domain_expiry": null,
    "paused": 0,
    "tags": "prod",
    "check_ssl": 1
  }
]

// 带 ?detail=1:同一批监控,附带延迟与可用率
{
  "monitors": [
    {
      "id": 1,
      "name": "Main Site",
      "url": "https://example.com",
      "type": "http",
      "status": "up",
      "last_check": "2026-09-15 08:00:00",
      "last_latency": 132,
      "latency": 132,
      "cert_expiry": 1767225600,
      "domain_expiry": null,
      "paused": 0,
      "tags": "prod",
      "check_ssl": 1,
      "created_at": "2026-01-01 00:00:00",
      "uptime_24h": 100,
      "uptime_7d": 99.9,
      "uptime_30d": 99.8,
      "uptime_90d": 99.6,
      "daily_stats": [
        { "date": "2026-09-14", "up": 287, "total": 288 }
      ],
      "recent_latencies": [130, 128, 141]
    }
  ]
}`,
            },
            {
                id: 'monitor-public-detail',
                method: 'GET',
                path: docPath(PATHS.monitors),
                descKey: 'apiDocs.epMonitorDetail',
                noteKey: 'apiDocs.epMonitorDetailNote',
                params: [
                    { name: 'scope', in: 'query', def: '', required: true, descKey: 'apiDocs.pScope' },
                    { name: 'view', in: 'query', def: '', required: true, descKey: 'apiDocs.pView' },
                    { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pId' },
                    { name: 'range', in: 'query', def: '24h', descKey: 'apiDocs.pRange' },
                    { name: 'limit', in: 'query', def: '50', descKey: 'apiDocs.pLimitLogs' },
                ],
                query: toQuery({ scope: 'public', view: 'detail', id: 1, range: '24h', limit: 50 }),
                res: `{
  "monitor": {
    "id": 1,
    "name": "Main Site",
    "url": "https://example.com",
    "type": "http",
    "method": "GET",
    "interval": 5,
    "status": "up",
    "last_check": "2026-09-15 08:00:00",
    "last_latency": 132,
    "latency": 132,
    "paused": 0,
    "tags": "prod",
    "uptime_24h": 100,
    "uptime_7d": 99.9,
    "uptime_30d": 99.8,
    "uptime_90d": 99.6,
    "daily_stats": [{ "date": "2026-09-14", "up": 287, "total": 288 }]
  },
  "logs": [
    { "id": 9812, "created_at": "2026-09-15 08:00:00", "status_code": 200, "latency": 132, "is_fail": 0, "reason": null }
  ],
  "latency_series": [
    { "created_at": "2026-09-15 07:00:00", "latency": 128 }
  ],
  "incidents": []
}`,
            },
            {
                id: 'incidents-active',
                method: 'GET',
                path: docPath(PATHS.incidents),
                descKey: 'apiDocs.epIncidentsActive',
                noteKey: 'apiDocs.epIncidentsActiveNote',
                params: [],
                res: `[
  {
    "id": 12,
    "title": "API 响应变慢",
    "description": "正在排查数据库连接池",
    "severity": "warning",
    "status": "active",
    "type": "incident",
    "scheduled_start": null,
    "scheduled_end": null,
    "affected_monitors": "1,2",
    "created_at": "2026-09-15 07:12:00",
    "updated_at": "2026-09-15 07:40:00",
    "resolved_at": null
  }
]`,
            },
            {
                id: 'feed',
                method: 'GET',
                path: docPath(PATHS.feed),
                descKey: 'apiDocs.epFeed',
                noteKey: 'apiDocs.epFeedNote',
                params: [],
                res: `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>MonitorFlare</title>
    <description>Status updates</description>
    <item>
      <title>API 响应变慢 [active]</title>
      <pubDate>Tue, 15 Sep 2026 07:12:00 GMT</pubDate>
      <description>正在排查数据库连接池</description>
    </item>
  </channel>
</rss>`,
            },
            {
                id: 'subscribe',
                method: 'POST',
                path: docPath(PATHS.subscribe),
                descKey: 'apiDocs.epSubscribe',
                params: [
                    { name: 'email', in: 'body', def: '', required: true, descKey: 'apiDocs.pEmail' },
                ],
                res: `{ "success": true }`,
            },
            {
                id: 'unsubscribe',
                method: 'POST',
                path: docPath(PATHS.unsubscribe),
                descKey: 'apiDocs.epUnsubscribe',
                noteKey: 'apiDocs.epUnsubscribeNote',
                params: [
                    { name: 'token', in: 'body', def: '', required: true, descKey: 'apiDocs.pUnsubToken' },
                ],
                res: `{ "success": true }`,
            },
        ],
    },
    {
        id: 'v1',
        icon: 'fa-key',
        auth: 'key',
        titleKey: 'apiDocs.v1Title',
        descKey: 'apiDocs.v1Desc',
        endpoints: [
            {
                id: 'v1-monitors',
                method: 'GET',
                path: docPath(PATHS.v1Monitors),
                descKey: 'apiDocs.epV1Monitors',
                noteKey: 'apiDocs.epV1MonitorsNote',
                params: [],
                res: `[
  {
    "id": 1,
    "name": "Main Site",
    "url": "https://example.com",
    "type": "http",
    "method": "GET",
    "interval": 5,
    "status": "up",
    "retry_count": 2,
    "last_check": "2026-09-15 08:00:00",
    "last_latency": 132,
    "keyword": null,
    "user_agent": null,
    "tags": "prod",
    "paused": 0,
    "check_ssl": 1,
    "check_domain": 0,
    "alert_after_failures": 2,
    "sort_order": 0,
    "created_at": "2026-01-01 00:00:00"
  }
]`,
            },
            {
                id: 'v1-logs',
                method: 'GET',
                path: docPath(PATHS.v1Logs),
                descKey: 'apiDocs.epV1Logs',
                noteKey: 'apiDocs.epV1LogsNote',
                params: [
                    { name: 'monitor_id', in: 'query', def: '全部', descKey: 'apiDocs.pMonitorId' },
                    { name: 'since', in: 'query', def: '', descKey: 'apiDocs.pSince' },
                    { name: 'until', in: 'query', def: '', descKey: 'apiDocs.pUntil' },
                    { name: 'limit', in: 'query', def: '100', descKey: 'apiDocs.pLimit5000' },
                    { name: 'offset', in: 'query', def: '0', descKey: 'apiDocs.pOffset' },
                ],
                query: toQuery({ monitor_id: 1, limit: 100, offset: 0, since: '2026-09-01' }),
                res: `{
  "total": 1284,
  "limit": 100,
  "offset": 0,
  "logs": [
    {
      "id": 1284,
      "monitor_id": 1,
      "status_code": 200,
      "latency": 132,
      "is_fail": 0,
      "reason": null,
      "created_at": "2026-09-15 08:00:00"
    }
  ]
}`,
            },
            {
                id: 'v1-incidents',
                method: 'GET',
                path: docPath(PATHS.v1Incidents),
                descKey: 'apiDocs.epV1Incidents',
                params: [
                    { name: 'limit', in: 'query', def: '500', descKey: 'apiDocs.pLimit1000' },
                ],
                query: toQuery({ limit: 200 }),
                res: `[
  {
    "id": 12,
    "title": "API 响应变慢",
    "description": "正在排查数据库连接池",
    "severity": "warning",
    "status": "resolved",
    "type": "incident",
    "affected_monitors": "1,2",
    "created_at": "2026-09-15 07:12:00",
    "resolved_at": "2026-09-15 09:02:00"
  }
]`,
            },
            {
                id: 'v1-uptime',
                method: 'GET',
                path: docPath(PATHS.v1Uptime),
                descKey: 'apiDocs.epV1Uptime',
                noteKey: 'apiDocs.epV1UptimeNote',
                params: [
                    { name: 'days', in: 'query', def: '30', descKey: 'apiDocs.pDays' },
                ],
                query: toQuery({ days: 90 }),
                res: `{
  "days": 90,
  "daily": [
    {
      "monitor_id": 1,
      "date": "2026-09-14",
      "total_checks": 288,
      "successful_checks": 287,
      "avg_latency": 130.4
    }
  ],
  "summary": [
    {
      "id": 1,
      "name": "Main Site",
      "url": "https://example.com",
      "type": "http",
      "uptime": 99.8,
      "checks": 25920
    }
  ]
}`,
            },
            {
                id: 'v1-export',
                method: 'GET',
                path: docPath(PATHS.v1Export),
                descKey: 'apiDocs.epV1Export',
                noteKey: 'apiDocs.epV1ExportNote',
                params: [
                    { name: 'limit', in: 'query', def: '1000', descKey: 'apiDocs.pLimit5000' },
                ],
                query: toQuery({ limit: 5000 }),
                res: `{
  "app": "MonitorFlare",
  "version": 1,
  "exported_at": "2026-09-15T08:00:00.000Z",
  "monitors": [{ "id": 1, "name": "Main Site" }],
  "logs": [{ "id": 1284, "monitor_id": 1, "is_fail": 0 }],
  "incidents": [],
  "uptime": [{ "monitor_id": 1, "date": "2026-09-14", "total_checks": 288, "successful_checks": 287, "avg_latency": 130.4 }],
  "settings": { "site_title": "MonitorFlare" },
  "notification_channels": [{ "id": 1, "type": "telegram", "name": "Ops", "enabled": 1 }]
}`,
            },
        ],
    },
    {
        id: 'webhook',
        icon: 'fa-satellite-dish',
        auth: 'token',
        titleKey: 'apiDocs.webhookTitle',
        descKey: 'apiDocs.webhookDesc',
        endpoints: [
            {
                id: 'webhook-inbound',
                method: 'POST',
                path: docPath(PATHS.webhook),
                descKey: 'apiDocs.epWebhook',
                noteKey: 'apiDocs.epWebhookNote',
                params: [
                    { name: 'token', in: 'path', def: '', required: true, descKey: 'apiDocs.pWebhookToken' },
                    { name: 'title', in: 'body', def: '', required: true, descKey: 'apiDocs.pWebhookTitle' },
                    { name: 'description', in: 'body', def: '', descKey: 'apiDocs.pWebhookDesc' },
                    { name: 'severity', in: 'body', def: 'info', descKey: 'apiDocs.pWebhookSeverity' },
                ],
                res: `HTTP/1.1 201 Created

{ "success": true }`,
            },
        ],
    },
];

/**
 * 管理接口。
 * 与公开接口共用同一套端点卡片，只是标记 brief：默认不列参数表 —— 它们的请求体
 * 就是后台表单，字段随版本演进，文档里逐项写出来必然过时。
 *
 * 例外是"靠查询参数取不同形式"的端点，如 /api/monitors 的 ?include= / ?id=：
 * 那些参数是调用契约的一部分（include 填了别的值服务端直接 400），不列出来
 * 调用方就只能去翻源码。这类端点在第五项带上参数表。
 *
 * [方法, PATHS 里的模板, i18n 后缀, 示例查询串(可选), 参数表(可选)]
 * 第二列传 PATHS 的值而不是键名：键名拼错 docPath 会直接抛，不会静默显示错路径。
 */
/**
 * 管理接口的资源归属:一张卡片 = 一个资源。
 *
 * 集合(/api/monitors)、成员(?id= 指认的那次操作)、子动作(?action=batch)
 * 是同一个资源的几种操作,各占一张卡就变成几张标题几乎一样的卡片,
 * 读者得先分辨"这几张有什么区别"。归到一张卡后按"方法 + 路径"分行,
 * 路径不同才是不同的操作,标题也就只剩一条。
 *
 * 没列在这里的路径(以及全部公开接口)各自成卡。
 */
const RESOURCE_OF = {
    // 一个资源一条路径:集合与成员已经合并成同一条,登记一次就够
    [PATHS.monitors]: 'monitors',
    [PATHS.incidents]: 'incidents',
    [PATHS.channels]: 'channels',
    [PATHS.templates]: 'templates',
    [PATHS.apiKeys]: 'apiKeys',
    // 站点配置、自检、备份都是"整站"这一层的操作
    [PATHS.settings]: 'site',
    [PATHS.health]: 'site',
    [PATHS.backup]: 'site',
};

const ADMIN_ENDPOINTS = [
    // 列表 / 日志 / 可用率不是三个端点,是这个端点的三种参数组合,收敛成一条,
    // 可配置的参数交给下面的表格逐项说明
    ['GET', PATHS.monitors, 'adminMonitors', {}, [
        { name: 'id', in: 'query', def: '', descKey: 'apiDocs.pMonitorId' },
        { name: 'ids', in: 'query', def: '', descKey: 'apiDocs.pMonitorIds' },
        { name: 'include', in: 'query', def: '', descKey: 'apiDocs.pAdminInclude' },
        { name: 'limit', in: 'query', def: '50', descKey: 'apiDocs.pAdminLimit' },
        { name: 'offset', in: 'query', def: '0', descKey: 'apiDocs.pAdminOffset' },
    ]],
    ['POST', PATHS.monitors, 'adminMonitorsCreate'],
    // 立即检查、暂停、批量不是三个端点,是这一个 POST 的三种取值;
    // 目标不再占 /api/monitors/:id,由 ?id= 指认 —— 取值与目标都进参数表
    ['POST', PATHS.monitors, 'adminMonitorAction', { action: 'check', id: 1 }, [
        { name: 'action', in: 'query', def: '', required: true, descKey: 'apiDocs.pMonitorAction' },
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    ['PATCH', PATHS.monitors, 'adminMonitorConfig', { id: 1 }, [
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    ['DELETE', PATHS.monitors, 'adminMonitorDelete', { id: 1 }, [
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    // 批量与排序改的是集合,挂在 /monitors 上用 ?action= 区分,不再占子路径
    ['POST', PATHS.monitors, 'adminMonitorsBatch', { action: 'batch' }, [
        { name: 'action', in: 'query', def: '', required: true, descKey: 'apiDocs.pMonitorAction' },
    ]],
    ['PUT', PATHS.monitors, 'adminMonitorsReorder', { action: 'reorder' }, [
        { name: 'action', in: 'query', def: '', required: true, descKey: 'apiDocs.pReorderAction' },
    ]],
    ['GET', PATHS.incidents, 'adminIncidentsAll', { status: 'all' }],
    ['POST', PATHS.incidents, 'adminIncidentsCreate'],
    // 改事件、删事件与集合同一条地址,目标由 ?id= 指认
    ['PATCH', PATHS.incidents, 'adminIncidentsUpdate', { id: 1 }, [
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    ['DELETE', PATHS.incidents, 'adminIncidentsDelete', { id: 1 }, [
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    ['GET', PATHS.settings, 'adminSettingsGet'],
    ['PUT', PATHS.settings, 'adminSettings'],
    ['GET', PATHS.health, 'adminHealth'],
    ['GET', PATHS.channels, 'adminChannelsList'],
    ['POST', PATHS.channels, 'adminChannelsCreate'],
    ['PATCH', PATHS.channels, 'adminChannelsUpdate', { id: 1 }, [
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    ['DELETE', PATHS.channels, 'adminChannelsDelete', { id: 1 }, [
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    // 测试渠道:带 ?id= 只测这一个,与下面"测全部"只差一个 ?id=
    ['POST', PATHS.channels, 'adminChannelsTest', { action: 'test', id: 1 }, [
        { name: 'action', in: 'query', def: '', required: true, descKey: 'apiDocs.pChannelAction' },
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    // 向全部渠道发测试:同是渠道集合上的写,靠 ?action=test 与"新建渠道"区分
    ['POST', PATHS.channels, 'adminTestAlert', { action: 'test' }, [
        { name: 'action', in: 'query', def: '', required: true, descKey: 'apiDocs.pChannelAction' },
    ]],
    ['GET', PATHS.templates, 'adminTemplatesList'],
    ['POST', PATHS.templates, 'adminTemplatesCreate'],
    ['PUT', PATHS.templates, 'adminTemplatesUpdate', { id: 1 }, [
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    // 复制与设为默认同上,是这个 POST 的两种取值
    ['POST', PATHS.templates, 'adminTemplatesAction', { action: 'duplicate', id: 1 }, [
        { name: 'action', in: 'query', def: '', required: true, descKey: 'apiDocs.pTemplateAction' },
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    ['DELETE', PATHS.templates, 'adminTemplatesDelete', { id: 1 }, [
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    ['GET', PATHS.apiKeys, 'adminKeysList'],
    ['POST', PATHS.apiKeys, 'adminKeysCreate'],
    ['DELETE', PATHS.apiKeys, 'adminKeysDelete', { id: 1 }, [
        { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pTargetId' },
    ]],
    // 导出与恢复是同一个资源:GET 拿快照,POST 用快照覆盖整站
    ['GET', PATHS.backup, 'adminBackupExport'],
    ['POST', PATHS.backup, 'adminBackupRestore'],
].map(([method, pattern, key, params, paramDocs], i) => ({
    id: `admin-${i}`,
    method,
    path: docPath(pattern),
    // 资源卡:集合 / 成员 / 子动作归到同一张卡,没登记的各自成卡
    resource: RESOURCE_OF[pattern] || docPath(pattern),
    // toQuery 走 URLSearchParams,:id 会被编成 %3Aid;文档是给人读的,还原成占位符,
    // 再由 requestTarget 统一示例化成真实值(路径里的 :id 也是这么处理的)
    query: toQuery(params).replace(/%3A/g, ':'),
    descKey: `apiDocs.${key}`,
    brief: true,
    params: paramDocs || [],
}));

const ADMIN_GROUP = {
    id: 'admin',
    icon: 'fa-user-lock',
    auth: 'admin',
    titleKey: 'apiDocs.adminTitle',
    descKey: 'apiDocs.adminIntro',
    endpoints: ADMIN_ENDPOINTS,
};

/**
 * 按路径合并：路径是资源（/api/monitors），方法是动作（GET 列表 / POST 新建）。
 * 拆成两张卡片会让人误以为是两个不同的端点，路径还得重复一遍；
 * 合并后一张卡片里按方法分块，共用同一条路径与完整地址。
 * 顺序按每个路径第一次出现的位置，接口清单读起来仍是从上到下。
 *
 * 同一路径的多种口径也合在一张卡里:POST /api/monitors 的"立即检查 / 暂停 / 批量"
 * 只是 ?action= 的差别,拆开就是几张标题一模一样的卡片,不展开分不出区别。
 * 口径由 methods[i].query 区分;卡片级 query 只在全部方法一致时才有值 ——
 * 多种口径并存时,这条路径谈不上"唯一的查询串",硬选一个会让人以为另外两种不存在。
 */
const mergeByResource = (endpoints) => {
    const order = [];
    const byRes = new Map();
    for (const ep of endpoints) {
        const key = ep.resource || ep.path;
        if (!byRes.has(key)) {
            byRes.set(key, []);
            order.push(key);
        }
        byRes.get(key).push(ep);
    }
    return order.map(key => {
        const list = byRes.get(key);
        const queries = [...new Set(list.map(e => e.query || ''))];
        return {
            id: list[0].id,          // 展开状态按卡片记,取第一个方法的 id 即可
            // 卡头给资源根路径;成员 / 子动作的差别由各方法块自己的 path 标出
            path: list[0].path,
            query: queries.length === 1 ? queries[0] : '',
            brief: list[0].brief,
            // 头部标签去重:一条 GET 可能有三种口径,标签只该出现一次
            methodTags: [...new Set(list.map(e => e.method))],
            methods: list.map(({ method, path, query, descKey, noteKey, params, res }) =>
                ({ method, path, query, descKey, noteKey, params, res })),
        };
    });
};

/** 管理接口并入同一循环,不再单独用一张表格渲染 —— 两处排版天然一致 */
export const DOC_GROUPS = [...GROUPS, ADMIN_GROUP].map(g => ({
    ...g,
    endpoints: mergeByResource(g.endpoints),
}));
