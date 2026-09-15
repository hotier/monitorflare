import { describe, it, expect } from 'vitest';
import { API_BASE, EP } from '../src/utils/endpoints.js';

describe('端点总表', () => {
  it('前缀固定为 /api', () => {
    expect(API_BASE).toBe('/api');
  });

  it('所有端点都带且只带一层 /api 前缀', () => {
    // 入口的 stripApiPrefix 只剥一层，多出来的那层没有对应路由 —— 历史上
    // /api/api/subscribe 就是这么静默 404 的，所以这条是回归防线。
    // 遍历 EP 而不是列一份清单：新加的端点自动纳入，不会漏测。
    for (const [name, fn] of Object.entries(EP)) {
      const p = fn(1, { action: 'x' });
      expect(p.startsWith('/api/'), name).toBe(true);
      // 不能写成 startsWith('/api/api'):/api/api-keys 是合法端点
      expect(p.startsWith(`${API_BASE}/api/`), name).toBe(false);
    }
  });

  it('订阅地址不带重复前缀', () => {
    expect(EP.subscribe()).toBe('/api/subscribe');
  });

  it('公开监控清单走集合地址，靠 scope=public 切口径', () => {
    expect(EP.publicMonitors()).toBe('/api/monitors?scope=public&detail=1');
  });

  it('监控详情不另开路径，是同一条地址上的 view=detail', () => {
    expect(EP.monitorDetail({ id: 7, range: '24h', limit: 50 }))
      .toBe('/api/monitors?scope=public&view=detail&id=7&range=24h&limit=50');
  });

  it('批量与排序不另开路径，是集合地址上的 action', () => {
    expect(EP.monitors({ action: 'batch' })).toBe('/api/monitors?action=batch');
    expect(EP.monitors({ action: 'reorder' })).toBe('/api/monitors?action=reorder');
  });

  it('事件的公开口径与管理口径出自同一个函数', () => {
    expect(EP.incidents()).toBe('/api/incidents');
    expect(EP.incidents({ status: 'all' })).toBe('/api/incidents?status=all');
  });

  it('成员操作不另开路径，目标由 id 指定', () => {
    // 与 DELETE /api/manage/apiTokens?id= 同一个路子:/monitors/:id 收掉之后,
    // "操作哪一个"从路径挪进查询串 —— 各资源都只剩集合这一条地址
    expect(EP.monitor(3, { action: 'check' })).toBe('/api/monitors?id=3&action=check');
    expect(EP.monitor(3)).toBe('/api/monitors?id=3');
    expect(EP.channel(4, { action: 'test' })).toBe('/api/notification-channels?id=4&action=test');
    expect(EP.channel(4)).toBe('/api/notification-channels?id=4');
    expect(EP.template(5, { action: 'duplicate' })).toBe('/api/alert-templates?id=5&action=duplicate');
    expect(EP.incident(6)).toBe('/api/incidents?id=6');
    expect(EP.apiKey(7)).toBe('/api/api-keys?id=7');
  });

  it('查询串丢掉空值但保留 0', () => {
    // offset=0 是首页的真实取值，被当成空值丢掉会永远拉第一页
    expect(EP.monitors({ id: 2, include: 'logs', limit: 50, offset: 0 }))
      .toBe('/api/monitors?id=2&include=logs&limit=50&offset=0');
    expect(EP.monitors({ id: 2, include: undefined, status: '' }))
      .toBe('/api/monitors?id=2');
  });

  it('查询串里的目标 id 参与编码', () => {
    expect(EP.monitor('a/b')).toBe('/api/monitors?id=a%2Fb');
  });

  it('魔法链接的 token 参与编码', () => {
    expect(EP.magicLinkVerify('a b&c')).toBe('/api/auth/magic-link/verify?token=a+b%26c');
  });
});
