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
    expect(formatDate(at(-2 * 3_600_000))).toBe('10:00');
  });

  it('时刻按配置的时区渲染', () => {
    localStorage.setItem('monitorflare_tz', 'Asia/Shanghai');
    expect(formatDate(at(-2 * 3_600_000))).toBe('18:00');
  });

  it('默认时区为 UTC', () => {
    expect(formatDate('2024-03-05T10:00:00Z')).toBe('10:00');
  });

  it('识别带空格的无时区时间戳', () => {
    expect(formatDate('2024-03-05 10:00:00')).toBe('10:00');
  });
});

describe('formatDateFull', () => {
  it('按用户时区输出完整时间', () => {
    expect(formatDateFull('2024-03-05 06:07:08')).toBe('03-05 06:07:08');
  });

  it('切换时区后输出随之改变', () => {
    localStorage.setItem('monitorflare_tz', 'Asia/Shanghai');
    expect(formatDateFull('2024-03-05 06:07:08')).toBe('03-05 14:07:08');
  });

  it('已带偏移量的时间戳不被二次补 Z', () => {
    expect(formatDateFull('2024-03-05T06:07:08+02:00')).toBe('03-05 04:07:08');
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
