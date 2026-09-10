// ============================================================
// MonitorFlare — 时区 / 日期工具测试
// 重点保障"按天"口径:同一 UTC 时刻在不同设置时区下应归属不同的一天,
// 这正是"11 号创建却出现 10 号记录"那类问题的根因。
// ============================================================
import { describe, it, expect } from 'vitest';
import { tzOffsetMinutes, tzModifier, localDateString, localHour } from '../src/datetime';

describe('tzOffsetMinutes', () => {
  it('上海恒为 +480(无夏令时)', () => {
    expect(tzOffsetMinutes('Asia/Shanghai', new Date('2026-01-15T00:00:00Z'))).toBe(480);
    expect(tzOffsetMinutes('Asia/Shanghai', new Date('2026-07-15T00:00:00Z'))).toBe(480);
  });

  it('UTC 与空值均为 0', () => {
    expect(tzOffsetMinutes('UTC', new Date('2026-09-11T00:00:00Z'))).toBe(0);
    expect(tzOffsetMinutes('', new Date('2026-09-11T00:00:00Z'))).toBe(0);
  });

  it('西半球为负偏移', () => {
    expect(tzOffsetMinutes('America/New_York', new Date('2026-01-15T00:00:00Z'))).toBe(-300);
  });

  it('非法时区名退回 UTC', () => {
    expect(tzOffsetMinutes('Not/AZone', new Date('2026-09-11T00:00:00Z'))).toBe(0);
  });
});

describe('tzModifier', () => {
  it('生成 SQLite date() 可用的偏移修饰符', () => {
    expect(tzModifier('Asia/Shanghai', new Date('2026-09-11T00:00:00Z'))).toBe('+480 minutes');
    expect(tzModifier('UTC', new Date('2026-09-11T00:00:00Z'))).toBe('+0 minutes');
    expect(tzModifier('America/New_York', new Date('2026-01-15T00:00:00Z'))).toBe('-300 minutes');
  });
});

describe('localDateString', () => {
  it('同一 UTC 时刻按不同时区归属不同日期', () => {
    // UTC 2026-09-10 17:30 → 北京时间已是 09-11 01:30
    const at = new Date('2026-09-10T17:30:00Z');
    expect(localDateString('Asia/Shanghai', at)).toBe('2026-09-11');
    expect(localDateString('UTC', at)).toBe('2026-09-10');
  });

  it('跨时区回退日:UTC 深夜在西半球仍是前一天', () => {
    const at = new Date('2026-09-11T02:00:00Z');
    expect(localDateString('Asia/Shanghai', at)).toBe('2026-09-11');
    expect(localDateString('America/New_York', at)).toBe('2026-09-10');
  });
});

describe('localHour', () => {
  it('给出目标时区的小时', () => {
    const at = new Date('2026-09-10T17:30:00Z');
    expect(localHour('Asia/Shanghai', at)).toBe(1);
    expect(localHour('UTC', at)).toBe(17);
  });
});
