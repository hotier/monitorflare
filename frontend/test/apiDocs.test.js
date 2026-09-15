import { describe, it, expect } from 'vitest';
import { API_BASE, PATHS, docPath } from '../src/utils/endpoints.js';
import { DOC_GROUPS } from '../src/utils/apiDocs.js';

const endpoints = DOC_GROUPS.flatMap(g => g.endpoints);
const templates = new Set(Object.values(PATHS));

describe('API 文档端点清单', () => {
  it('每个端点的路径都派生自 PATHS', () => {
    // 这条是文档收敛的核心:文档里不再有自己手写的路径字符串,
    // 路径只有 PATHS 一个出处,改路由不会只改实现、漏改文档。
    // 卡头是资源根路径,成员 / 子动作挂在方法上,两边都要查
    for (const ep of endpoints) {
      for (const p of [ep.path, ...ep.methods.map(m => m.path)]) {
        const bare = p.slice(API_BASE.length);
        expect(templates.has(bare), `${p} 不在 PATHS 里`).toBe(true);
      }
    }
  });

  it('路径带且只带一层 /api 前缀', () => {
    for (const ep of endpoints) {
      for (const p of [ep.path, ...ep.methods.map(m => m.path)]) {
        expect(p.startsWith('/api/')).toBe(true);
        // 不能写成 startsWith('/api/api'):/api/api-keys 是合法端点
        expect(p.startsWith(`${API_BASE}/api/`)).toBe(false);
      }
    }
  });

  it('模板本身不带 /api 前缀', () => {
    // 前缀统一由 API_BASE 加,模板里再写一遍就是双前缀
    for (const [key, p] of Object.entries(PATHS)) {
      expect(p.startsWith('/'), key).toBe(true);
      // 同样不能写 startsWith('/api'):/api-keys 是合法模板
      expect(p.startsWith('/api/'), key).toBe(false);
    }
  });

  it('覆盖了 PATHS 里除登录类之外的全部端点', () => {
    // 文档是给外部调用方看的:换会话 token 的三个端点只服务浏览器自身,不列进来
    const browserOnly = new Set([PATHS.authLogin, PATHS.magicLinkVerify, PATHS.statusLogin]);
    // 成员 / 子动作挂在资源卡下,卡头只显示资源根路径,所以按方法级路径统计
    const documented = new Set(endpoints.flatMap(ep => ep.methods.map(m => m.path.slice(API_BASE.length))));
    const missing = [...templates].filter(p => !browserOnly.has(p) && !documented.has(p));
    expect(missing).toEqual([]);
  });

  it('同一路径只占一张卡片:形式差别收敛进参数表', () => {
    // /api/monitors 的"列表 / 日志 / 可用率"不是三个端点,是一个端点的三种参数组合:
    // 拆成三条 GET 就是三个一模一样的标题,不展开分不出区别。
    // 只看管理章节:?scope=public 那份在公开章节另有一张卡,是给状态页访客看的
    const admin = DOC_GROUPS.find(g => g.id === 'admin');
    const monitors = docPath(PATHS.monitors);
    const cards = admin.endpoints.filter(ep => ep.path === monitors);
    expect(cards).toHaveLength(1);

    const card = cards[0];
    const gets = card.methods.filter(m => m.method === 'GET');
    expect(gets).toHaveLength(1);
    // 可配置的参数由表格承担:id / include 这些是调用契约,服务端还要校验
    expect(gets[0].params.map(p => p.name))
      .toEqual(['id', 'ids', 'include', 'limit', 'offset']);
  });

  it('管理接口只给"靠参数取不同形式"的端点列参数表', () => {
    // 其余管理端点的请求体就是后台表单,字段随版本演进,列出来必然过时。
    // 这里列的就是 ?include= / ?action= / ?id= 这类"填错服务端会拒"的调用契约
    const admin = DOC_GROUPS.find(g => g.id === 'admin');
    const withParams = admin.endpoints.flatMap(c => c.methods).filter(m => m.params.length > 0);
    // ?id= 也是契约:成员操作不占路径,缺了它服务端直接 400
    expect(withParams.map(m => m.descKey)).toEqual([
      'apiDocs.adminMonitors',
      'apiDocs.adminMonitorAction',
      'apiDocs.adminMonitorConfig',
      'apiDocs.adminMonitorDelete',
      'apiDocs.adminMonitorsBatch',
      'apiDocs.adminMonitorsReorder',
      'apiDocs.adminIncidentsUpdate',
      'apiDocs.adminIncidentsDelete',
      'apiDocs.adminChannelsUpdate',
      'apiDocs.adminChannelsDelete',
      'apiDocs.adminChannelsTest',
      'apiDocs.adminTestAlert',
      'apiDocs.adminTemplatesUpdate',
      'apiDocs.adminTemplatesAction',
      'apiDocs.adminTemplatesDelete',
      'apiDocs.adminKeysDelete',
    ]);
  });

  it('管理接口按资源收敛到 8 张卡片以内', () => {
    // 集合(/api/monitors)、成员(?id= 指认的那次操作)、批量与排序(?action=)
    // 是同一个资源的操作,各占一张卡就是几张标题几乎一样的卡片
    const admin = DOC_GROUPS.find(g => g.id === 'admin');
    expect(admin.endpoints.length).toBeLessThanOrEqual(8);
    // 卡头显示资源根路径:配置 / 自检 / 备份归到 /api/settings 这张"站点"卡下
    expect(admin.endpoints.map(ep => ep.path)).toEqual([
      docPath(PATHS.monitors),
      docPath(PATHS.incidents),
      docPath(PATHS.settings),
      docPath(PATHS.channels),
      docPath(PATHS.templates),
      docPath(PATHS.apiKeys),
    ]);
  });

  it('成员与子动作挂在资源卡下,方法自带路径', () => {
    // 卡头只给资源根路径,具体打到哪条地址由方法块自己标 —— 少了 path 就分不清
    const admin = DOC_GROUPS.find(g => g.id === 'admin');
    const monitors = admin.endpoints.find(ep => ep.path === docPath(PATHS.monitors));
    // 成员与子动作都不再占子路径:目标走 ?id=、批量与排序靠 ?action=,
    // 整张卡上只有 /api/monitors 这一条路径
    expect(monitors.methods.map(m => m.path)).toEqual(new Array(7).fill(docPath(PATHS.monitors)));
  });

  it('同端点的 action 动作收敛成一条', () => {
    // check / pause / batch 不是三个端点,是同一个 POST 的三种取值,取值列进参数表
    const admin = DOC_GROUPS.find(g => g.id === 'admin');
    const monitor = admin.endpoints.find(ep => ep.path === docPath(PATHS.monitors));
    // 方法块的 query 不带 ?,问号是渲染完整地址时才补上的
    const action = monitor.methods.find(m => m.method === 'POST' && m.query === 'action=check&id=1');
    expect(action.params.map(p => p.name)).toEqual(['action', 'id']);
    // 批量共用一个 action 参数,只是取值不同;目标 ids 在 body 里,不占参数表
    const batch = monitor.methods.find(m => m.method === 'POST' && m.query === 'action=batch');
    expect(batch.params.map(p => p.name)).toEqual(['action']);

    const templates = admin.endpoints.find(ep => ep.path === docPath(PATHS.templates));
    // duplicate / default 收进集合地址后,目标也由 ?id= 指认
    const dup = templates.methods.find(m => m.method === 'POST' && m.query === 'action=duplicate&id=1');
    expect(dup.params.map(p => p.name)).toEqual(['action', 'id']);
    // 新建模板是同一个 POST 的缺省分支,没有 action 也就没有参数
    const create = templates.methods.find(m => m.method === 'POST' && m.query === '');
    expect(create.params).toEqual([]);
  });

  it('卡片头部的方法标签不重复', () => {
    // 一条 GET 可能有三种口径,标签按方法去重后才不会连着出现三个 GET
    for (const ep of endpoints) {
      expect(new Set(ep.methodTags).size, ep.path).toBe(ep.methodTags.length);
    }
  });

  it('每个方法都带参数表字段,渲染时不会读空', () => {
    // 参数表是方法块里第一层判断,缺了字段整页会直接白屏
    for (const ep of endpoints) {
      for (const m of ep.methods) {
        expect(Array.isArray(m.params), `${ep.path} ${m.method}`).toBe(true);
      }
    }
  });

  it('查询串里的占位符保持可读,不被 URL 编码', () => {
    // URLSearchParams 会把 :id 编成 %3Aid,文档里就成了 ?id=%3Aid
    for (const ep of endpoints) {
      for (const m of ep.methods) {
        expect(m.query || '', `${ep.path} ${m.method}`).not.toContain('%3A');
      }
    }
  });

  it('管理端点的动作参数与 EP 一致', () => {
    // 文档写 ?action=check&id=1、前端调 EP.monitor(id, { action: 'check' }),
    // 两处都从同一条模板出来,这里钉住拼出来的样子。成员已与集合同路径,
    // 所以这里不再是 /api/monitors/:id —— 目标走 ?id=
    expect(docPath(PATHS.monitors)).toBe('/api/monitors');
    expect(docPath(PATHS.templates)).toBe('/api/alert-templates');
    // 入站 webhook 的 token 是渠道自己的凭据,留在路径里
    expect(docPath(PATHS.webhook)).toBe('/api/webhooks/:token');
  });

  it('模板为空时报错,不静默显示错路径', () => {
    expect(() => docPath(undefined)).toThrow();
  });
});
