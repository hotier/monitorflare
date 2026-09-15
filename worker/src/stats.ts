// ============================================================
// MonitorFlare — 可用率统计读取层
//
// 这一层的存在只有一个原因:让所有"算可用率"的地方都从聚合表里取数,
// 而不是各自去扫 logs 原始表。
//
// 数据分层(不变式,改动前请先确认没有破坏它):
//   logs            原始探测点,只服务"最近 N 条日志"和 24h 原始延迟曲线
//   monitor_hourly  最近 31 天的小时桶,探测时增量 upsert(含今天,实时)
//   daily_uptime    已结束的自然日(本地时区),由每日任务从小时桶汇总,不再含今天
//
// 因此"任意窗口"= 已结束的日聚合(daily_uptime)+ 今天的小时桶(monitor_hourly),
// 全程不碰 logs,读行数与监控数量成正比、与历史数据量无关。
// ============================================================
import type { Bindings } from './types';
import { cached } from './cache';
import { localDateString, localDateAgo, localHourAgo, localDayStartHour } from './datetime';

export interface HourBucket {
  hour: string;
  total: number;
  fails: number;
  latency_sum: number;
}

export interface DayBar {
  date: string;
  up: number;
  total: number;
}

export interface MonitorStats {
  uptime_24h: number | null;
  uptime_7d: number | null;
  uptime_30d: number | null;
  uptime_90d: number | null;
  daily_stats: DayBar[];
  recent_latencies: number[];
}

const num = (v: unknown): number => Number(v) || 0;

export function pct(total: number, success: number): number | null {
  if (!total || total <= 0) return null;
  return Number(((success / total) * 100).toFixed(1));
}

/** 小时桶:只取 [fromHour, 现在],每个监控 ≤ 25 行 */
export async function loadHourBuckets(env: Bindings, ids: number[], fromHour: string): Promise<Map<number, HourBucket[]>> {
  const out = new Map<number, HourBucket[]>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT monitor_id, hour, total, fails, latency_sum FROM monitor_hourly
     WHERE monitor_id IN (${placeholders}) AND hour >= ? ORDER BY monitor_id, hour`
  ).bind(...ids, fromHour).all<{ monitor_id: number; hour: string; total: number; fails: number; latency_sum: number }>();
  for (const r of results || []) {
    const list = out.get(r.monitor_id) || [];
    list.push({ hour: r.hour, total: num(r.total), fails: num(r.fails), latency_sum: num(r.latency_sum) });
    out.set(r.monitor_id, list);
  }
  return out;
}

/**
 * 已结束自然日的聚合桶。
 *
 * 只在"跨天"时才会变,所以结果按 (本地日期, 天数, 监控集合) 缓存 10 分钟 ——
 * 90 天 × N 个监控是这个接口里唯一还是"按天线性"的开销,不缓存的话
 * 每 30 秒就要重扫一遍。
 */
export async function loadDailyBars(env: Bindings, ids: number[], tz: string, days: number): Promise<Map<number, DayBar[]>> {
  const out = new Map<number, DayBar[]>();
  if (ids.length === 0) return out;
  const today = localDateString(tz);
  const since = localDateAgo(tz, days - 1);
  const key = `dailyBars:${days}:${today}:${ids.join(',')}`;
  return cached(key, 10 * 60_000, async () => {
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT monitor_id, date, total_checks, successful_checks FROM daily_uptime
       WHERE monitor_id IN (${placeholders}) AND date >= ? AND date < ? ORDER BY monitor_id, date`
    ).bind(...ids, since, today).all<{ monitor_id: number; date: string; total_checks: number; successful_checks: number }>();
    for (const r of results || []) {
      const list = out.get(r.monitor_id) || [];
      list.push({ date: r.date, up: num(r.successful_checks), total: num(r.total_checks) });
      out.set(r.monitor_id, list);
    }
    return out;
  });
}

/**
 * 汇总一组监控的可用率。
 *
 * @param days 柱状图窗口(默认 90 天),同时也是 uptime_90d 的窗口
 */
export async function buildMonitorStats(
  env: Bindings,
  ids: number[],
  tz: string,
  days = 90,
): Promise<Map<number, MonitorStats>> {
  const out = new Map<number, MonitorStats>();
  if (ids.length === 0) return out;

  const now = new Date();
  const today = localDateString(tz, now);
  const dayStart = localDayStartHour(tz, now);   // 今天零点桶
  const h24 = localHourAgo(tz, 23, now);         // 滚动 24h 的起点桶
  const fromHour = h24 < dayStart ? h24 : dayStart;

  const [buckets, bars] = await Promise.all([
    loadHourBuckets(env, ids, fromHour),
    loadDailyBars(env, ids, tz, days),
  ]);

  const d7 = localDateAgo(tz, 6, now);
  const d30 = localDateAgo(tz, 29, now);
  const d90 = localDateAgo(tz, days - 1, now);

  for (const id of ids) {
    const rows = (buckets.get(id) || []).slice().sort((a, b) => (a.hour < b.hour ? -1 : 1));

    // 一次遍历同时求"滚动 24h"和"今天":今天的桶必然落在 24h 窗口内或与之重叠
    let t24 = 0, s24 = 0, tToday = 0, sToday = 0;
    for (const r of rows) {
      if (r.hour >= h24) { t24 += r.total; s24 += r.total - r.fails; }
      if (r.hour >= dayStart) { tToday += r.total; sToday += r.total - r.fails; }
    }

    const allBars = bars.get(id) || [];
    let t7 = 0, s7 = 0, t30 = 0, s30 = 0, t90 = 0, s90 = 0;
    for (const b of allBars) {
      if (b.date >= d7) { t7 += b.total; s7 += b.up; }
      if (b.date >= d30) { t30 += b.total; s30 += b.up; }
      if (b.date >= d90) { t90 += b.total; s90 += b.up; }
    }
    t7 += tToday; s7 += sToday;
    t30 += tToday; s30 += sToday;
    t90 += tToday; s90 += sToday;

    const dailyStats = allBars.filter(b => b.date >= d90);
    if (tToday > 0) dailyStats.push({ date: today, up: sToday, total: tToday });

    // 迷你延迟曲线:取最近 24 个有效小时桶的均值(原本是扫成功日志取 200 条)
    const recent = rows
      .filter(r => r.total - r.fails > 0)
      .slice(-24)
      .map(r => Math.round(r.latency_sum / (r.total - r.fails)));

    out.set(id, {
      uptime_24h: pct(t24, s24),
      uptime_7d: pct(t7, s7),
      uptime_30d: pct(t30, s30),
      uptime_90d: pct(t90, s90),
      daily_stats: dailyStats,
      recent_latencies: recent,
    });
  }
  return out;
}
