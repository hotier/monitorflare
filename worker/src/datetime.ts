// ============================================================
// MonitorFlare — 时区 / 日期工具
// 全站"按天"的口径统一从这里出:每日可用率聚合、今日边界、日期轴。
// 存储保持 UTC(logs.created_at、monitors.created_at 等),只有"切天"跟随
// 设置里的 timezone,避免各处 date('now') / toISOString() / Date.now() 各自为政漂移。
// 注:SQLite 没有时区数据库,只能按"当前时刻的固定偏移"切天,对没有夏令时的
// 时区(如默认的 Asia/Shanghai)完全准确;有夏令时的时区在切换日会有 1 小时误差。
// ============================================================

/** 默认时区(与 settings 默认值同源) */
export const DEFAULT_TZ = 'Asia/Shanghai';

const MINUTE_MS = 60000;

/** 目标时区在给定时刻相对 UTC 的偏移(分钟)。Asia/Shanghai → +480 */
export function tzOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  if (!timeZone || timeZone === 'UTC') return 0;
  try {
    const parts: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at)) {
      if (p.type !== 'literal') parts[p.type] = p.value;
    }
    // 把"目标时区的墙钟时间"当作 UTC 解析,与真实 UTC 时刻之差即偏移
    const wallMs = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return Math.round((wallMs - at.getTime()) / MINUTE_MS);
  } catch {
    return 0; // 非法时区名 → 退回 UTC
  }
}

/** SQLite 日期修饰符,如 '+480 minutes';配合 date(col, '...') 按本地日切分 */
export function tzModifier(timeZone: string, at: Date = new Date()): string {
  const offset = tzOffsetMinutes(timeZone, at);
  return `${offset < 0 ? '-' : '+'}${Math.abs(offset)} minutes`;
}

/** 某时刻在目标时区下的日期 YYYY-MM-DD */
export function localDateString(timeZone: string, at: Date = new Date()): string {
  const shifted = at.getTime() + tzOffsetMinutes(timeZone, at) * MINUTE_MS;
  return new Date(shifted).toISOString().slice(0, 10);
}

/** 目标时区下的小时(0-23),用于把"每日任务"锚到本地午夜之后 */
export function localHour(timeZone: string, at: Date = new Date()): number {
  const shifted = at.getTime() + tzOffsetMinutes(timeZone, at) * MINUTE_MS;
  return new Date(shifted).getUTCHours();
}
