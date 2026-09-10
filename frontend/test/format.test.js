import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatDate,
  formatDateFull,
  getDaysRemaining,
  formatExpiryDate,
  getExpiryClass,
  getExpiryClassAdmin,
  formatExpiry,
  latencyClass,
  statusBadgeClass,
  todayLocalDateStr,
  localDateStr,
  shiftDateStr,
} from '../src/utils/format.js';

const NOW = new Date('2024-03-05T12:00:00Z');

/** 以 NOW 为基准偏移若干毫秒生成 ISO 字符串 */
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();

const DAY = 86400000;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatDate', () => {
  it('空值返回占位符', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
  });

  it('无法解析的字符串返回占位符', () => {
    expect(formatDate('garbage')).toBe('-');
  });

  it('一分钟内显示相对时间', () => {
    expect(formatDate(at(-30_000))).toContain('second');
  });

  it('一小时内显示相对时间', () => {
    expect(formatDate(at(-5 * 60_000))).toContain('5 minutes');
  });

  it('超过一小时改为显示时刻', () => {
    expect(formatDate(at(-2 * 3_600_000))).toBe('18:00');
  });

  it('时刻按配置的时区渲染', () => {
    localStorage.setItem('monitorflare_tz', 'UTC');
    expect(formatDate(at(-2 * 3_600_000))).toBe('10:00');
  });

  it('默认时区为上海', () => {
    expect(formatDate('2024-03-05T10:00:00Z')).toBe('18:00');
  });

  it('识别带空格的无时区时间戳', () => {
    expect(formatDate('2024-03-05 10:00:00')).toBe('18:00');
  });
});

describe('formatDateFull', () => {
  it('按默认时区输出完整时间', () => {
    expect(formatDateFull('2024-03-05 06:07:08')).toBe('03-05 14:07:08');
  });

  it('切换时区后输出随之改变', () => {
    localStorage.setItem('monitorflare_tz', 'UTC');
    expect(formatDateFull('2024-03-05 06:07:08')).toBe('03-05 06:07:08');
  });

  it('已带偏移量的时间戳不被二次补 Z', () => {
    expect(formatDateFull('2024-03-05T06:07:08+02:00')).toBe('03-05 12:07:08');
  });

  it('空值返回占位符', () => {
    expect(formatDateFull(null)).toBe('-');
  });
});

describe('formatExpiryDate', () => {
  it('输出 YYYY-MM-DD', () => {
    expect(formatExpiryDate('2024-03-05 06:07:08')).toBe('2024-03-05');
  });

  it('空值返回占位符', () => {
    expect(formatExpiryDate(null)).toBe('-');
  });
});

describe('getDaysRemaining', () => {
  it('计算未来天数', () => {
    expect(getDaysRemaining(at(5 * DAY))).toBe(5);
  });

  it('不足一天向上取整', () => {
    expect(getDaysRemaining(at(DAY / 2))).toBe(1);
  });

  it('已过期返回负数', () => {
    expect(getDaysRemaining(at(-4 * DAY))).toBe(-4);
  });

  it('空值或非法值返回 null', () => {
    expect(getDaysRemaining(null)).toBeNull();
    expect(getDaysRemaining('')).toBeNull();
    expect(getDaysRemaining('garbage')).toBeNull();
  });
});

describe('formatExpiry', () => {
  it('未来显示天数', () => {
    expect(formatExpiry(at(5 * DAY))).toBe('5d');
  });

  it('已过期显示 Expired', () => {
    expect(formatExpiry(at(-DAY))).toBe('Expired');
  });

  it('空值返回空串', () => {
    expect(formatExpiry(null)).toBe('');
  });
});

describe('getExpiryClass', () => {
  it('无日期为中性色', () => {
    expect(getExpiryClass(null)).toContain('slate');
  });

  it('7 天内为红色', () => {
    expect(getExpiryClass(at(3 * DAY))).toContain('red');
  });

  it('30 天内为黄色', () => {
    expect(getExpiryClass(at(10 * DAY))).toContain('yellow');
  });

  it('30 天以上为绿色', () => {
    expect(getExpiryClass(at(60 * DAY))).toContain('emerald');
  });
});

describe('getExpiryClassAdmin', () => {
  it('无日期为绿色且不加粗', () => {
    const cls = getExpiryClassAdmin(null);
    expect(cls).toContain('text-green-600');
    expect(cls).not.toContain('font-bold');
  });

  it('7 天内为红色加粗', () => {
    const cls = getExpiryClassAdmin(at(3 * DAY));
    expect(cls).toContain('text-red-600');
    expect(cls).toContain('font-bold');
  });

  it('30 天内为黄色', () => {
    expect(getExpiryClassAdmin(at(10 * DAY))).toContain('text-yellow-600');
  });

  it('30 天以上为绿色', () => {
    expect(getExpiryClassAdmin(at(60 * DAY))).toContain('text-green-600');
  });
});

describe('latencyClass', () => {
  it('按延迟分档', () => {
    expect(latencyClass(50)).toContain('emerald');
    expect(latencyClass(200)).toContain('sky');
    expect(latencyClass(500)).toContain('yellow');
    expect(latencyClass(1000)).toContain('red');
  });

  it('边界值归入较慢的一档', () => {
    expect(latencyClass(100)).toContain('sky');
    expect(latencyClass(300)).toContain('yellow');
    expect(latencyClass(800)).toContain('red');
  });
});

describe('statusBadgeClass', () => {
  it('暂停优先于状态', () => {
    expect(statusBadgeClass('DOWN', true)).toContain('slate');
  });

  it('按状态着色', () => {
    expect(statusBadgeClass('UP', false)).toContain('emerald');
    expect(statusBadgeClass('DOWN', false)).toContain('red');
    expect(statusBadgeClass('PENDING', false)).toContain('yellow');
  });
});

describe('todayLocalDateStr', () => {
  it('按默认时区(上海)给出今天', () => {
    expect(todayLocalDateStr()).toBe('2024-03-05'); // NOW = 12:00Z → 上海 20:00
  });

  it('跨时区回退日:UTC 深夜在上海已是第二天', () => {
    vi.setSystemTime(new Date('2024-03-05T20:00:00Z')); // 上海 03-06 04:00
    expect(todayLocalDateStr()).toBe('2024-03-06');
    localStorage.setItem('monitorflare_tz', 'UTC');
    expect(todayLocalDateStr()).toBe('2024-03-05');
  });
});

describe('localDateStr', () => {
  it('时间戳按应用时区归日', () => {
    // UTC 09-10 17:30 → 上海 09-11 01:30
    expect(localDateStr('2026-09-10 17:30:00')).toBe('2026-09-11');
  });

  it('切换时区后归日结果随之改变', () => {
    localStorage.setItem('monitorflare_tz', 'UTC');
    expect(localDateStr('2026-09-10 17:30:00')).toBe('2026-09-10');
  });

  it('纯日期原样返回,不参与时区换算', () => {
    expect(localDateStr('2024-03-03')).toBe('2024-03-03');
  });

  it('空值与非法值返回空串', () => {
    expect(localDateStr(null)).toBe('');
    expect(localDateStr(undefined)).toBe('');
    expect(localDateStr('')).toBe('');
    expect(localDateStr('garbage')).toBe('');
  });
});

describe('shiftDateStr', () => {
  it('按天偏移(含跨月跨年)', () => {
    expect(shiftDateStr('2024-03-05', -89)).toBe('2023-12-07');
    expect(shiftDateStr('2024-03-05', 0)).toBe('2024-03-05');
  });

  it('正确跨过闰日', () => {
    expect(shiftDateStr('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDateStr('2023-02-28', 1)).toBe('2023-03-01');
  });
});
