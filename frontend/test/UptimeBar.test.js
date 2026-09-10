import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import UptimeBar from '../src/components/status/UptimeBar.vue';

const NOW = new Date('2024-03-05T12:00:00Z');
const TODAY = '2024-03-05';

/** 只关心 key 与插值参数，不引入完整 i18n 实例 */
const $t = (key, params) => (params ? `${key}|${JSON.stringify(params)}` : key);

const mountBar = (monitor, days) =>
  mount(UptimeBar, {
    props: days ? { monitor, days } : { monitor },
    global: { mocks: { $t } },
  });

const cells = (wrapper) => wrapper.findAll('.uptime-bar-cell');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UptimeBar', () => {
  it('固定渲染 90 天', () => {
    expect(cells(mountBar({ daily_stats: [] })).length).toBe(90);
  });

  it('按 days 窗口渲染对应格子数', () => {
    expect(cells(mountBar({ daily_stats: [] }, 7)).length).toBe(7);
    expect(cells(mountBar({ daily_stats: [] }, 30)).length).toBe(30);
    expect(cells(mountBar({ daily_stats: [] }, 90)).length).toBe(90);
  });

  it('窗口大于监控历史时,只有创建日之后的格子渲染色块', () => {
    const wrapper = mountBar({ daily_stats: [], created_at: '2024-03-03' }, 7);

    expect(cells(wrapper).length).toBe(7);
    expect(wrapper.findAll('.uptime-bar-fill').length).toBe(3);
  });

  it('今天刚添加时,当天绿条贴在最左边第一格', () => {
    const wrapper = mountBar({ daily_stats: [{ date: TODAY, up: 1, total: 1 }], created_at: TODAY }, 7);

    expect(cells(wrapper).length).toBe(7);
    expect(cells(wrapper)[0].find('.uptime-bar-fill').exists()).toBe(true);
    expect(wrapper.findAll('.uptime-bar-fill').length).toBe(1);
  });

  it('左侧文案带窗口天数', () => {
    expect(mountBar({ daily_stats: [] }, 7).html()).toContain('"days":7');
  });

  it('日期按时间升序，最后一格是今天', () => {
    const wrapper = mountBar({ daily_stats: [] });
    const tooltips = wrapper.findAll('.uptime-tooltip').map((n) => n.text());

    expect(tooltips[0].startsWith('2023-12-07')).toBe(true);
    expect(tooltips[89].startsWith(TODAY)).toBe(true);
  });

  it('没有数据的日期显示占位文案并使用中性色', () => {
    const wrapper = mountBar({ daily_stats: [] });
    const last = cells(wrapper)[89];

    expect(last.find('.uptime-bar-fill').classes()).toContain('bg-slate-200/80');
    expect(last.text()).toContain('uptimeBar.noData');
  });

  it('有数据的日期显示可用率', () => {
    const wrapper = mountBar({ daily_stats: [{ date: TODAY, up: 143, total: 144 }] });
    const last = cells(wrapper)[89];

    expect(last.text()).toContain('99.3%');
    expect(last.text()).not.toContain('uptimeBar.noData');
  });

  it('按可用率着色', () => {
    const cases = [
      [{ up: 100, total: 100 }, 'bg-emerald-400'],
      [{ up: 96, total: 100 }, 'bg-yellow-400'],
      [{ up: 50, total: 100 }, 'bg-red-400'],
    ];

    for (const [stat, expected] of cases) {
      const wrapper = mountBar({ daily_stats: [{ date: TODAY, ...stat }] });
      expect(cells(wrapper)[89].find('.uptime-bar-fill').classes()).toContain(expected);
    }
  });

  it('总数为 0 的日期按无数据渲染', () => {
    const wrapper = mountBar({ daily_stats: [{ date: TODAY, up: 0, total: 0 }] });
    expect(cells(wrapper)[89].find('.uptime-bar-fill').classes()).toContain('bg-slate-200/80');
  });

  it('始终渲染底部说明文案', () => {
    const wrapper = mountBar({ daily_stats: [] });
    expect(wrapper.html()).toContain('uptimeBar.daysAgo');
    expect(wrapper.html()).toContain('uptimeBar.today');
  });

  it('底部只标窗口端点,不再显示 30 天可用率', () => {
    const wrapper = mountBar({ daily_stats: [], uptime_30d: 99.95 });
    expect(wrapper.html()).not.toContain('uptimeBar.last30d');
    expect(wrapper.html()).toContain('uptimeBar.daysAgo');
  });
});
