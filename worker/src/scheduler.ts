// ============================================================
// MonitorFlare — 调度任务
//
// 计费相关的一切都集中在这里:每分钟的探测是唯一的常驻写入源。
// 改造要点(详见 docs/D1-OPTIMIZATION.md):
//   1. 一次探测的所有写合并成一次 DB.batch,不再三条独立 SQL 各跑一趟;
//   2. 顺带把"小时桶"增量 upsert 掉,让读侧彻底不用扫 logs 原始表;
//   3. 每日任务里,daily_uptime 由小时桶汇总而不是再扫一遍 logs。
// ============================================================
import type { Bindings, CheckResult, Monitor } from './types';
import { performCheck, updateDomainCertInfo } from './checks';
import { ensureInitialized, getSetting, getTimezone } from './init';
import { localDateString, localDateAgo, localHourString, localHour } from './datetime';
import { isSupportedLang, type Lang } from './i18n';
import { MONITOR_COLUMNS } from './sql';
import { sendUptimeAlert, checkErrorRate, checkExpiryAlerts, checkLatencyAlert } from './services/alert';

/** 原始日志保留天数 */
const LOG_RETENTION_DAYS = 90;
/** 小时桶保留天数(要覆盖最长的延迟曲线窗口 30d) */
const HOURLY_RETENTION_DAYS = 31;

async function checkSites(env: Bindings) {
  console.log('Starting scheduled check...');
  const now = Date.now();
  const { results } = await env.DB.prepare(`
    SELECT ${MONITOR_COLUMNS} FROM monitors
  `).all<Monitor>();
  const tasks = results.map(async (monitor) => {
    if (monitor.paused === 1) return;
    if (isTimeToCheck(monitor, now)) await performMonitorCheck(monitor, env);
  });
  await Promise.all(tasks);
}

function isTimeToCheck(monitor: Monitor, now: number): boolean {
  if (monitor.status === 'RETRYING') return true;
  const lastCheck = monitor.last_check ? new Date(monitor.last_check).getTime() : 0;
  const intervalMs = (monitor.interval || 300) * 1000;
  return now - lastCheck >= intervalMs;
}

/** 单次探测 + 落库 + 状态机 + 告警;同时被手动"立即检查"与批量检查复用 */
export async function performMonitorCheck(monitor: Monitor, env: Bindings) {
  const result: CheckResult = await performCheck(monitor, env);
  const now = new Date();
  const nowIso = now.toISOString();
  const ok = result.ok;

  // 时区要提前拿:小时桶的键是"本地时区的小时",而告警文案也要它。
  // getSetting 有 30s 内存缓存,这两次读取不会打到 D1。
  const tz = await getTimezone(env);
  const hour = localHourString(tz, now);

  // ── 状态机 ──
  // 只算出"下一次应该是什么状态",真正写库时再决定要不要带 status 列 ——
  // 暂停中的监控手动检查一次不该被写成 UP。
  const afterFailures = Math.max(1, monitor.alert_after_failures || 1);
  let nextStatus: Monitor['status'] = monitor.status;
  let retryCount = monitor.retry_count || 0;
  let changed = false;

  if (!ok) {
    retryCount += 1;
    if (retryCount >= afterFailures && monitor.status === 'UP') {
      nextStatus = 'DOWN';
      retryCount = 0;
      changed = true;
    } else {
      nextStatus = 'RETRYING';
    }
  } else if (monitor.status === 'DOWN' || monitor.status === 'RETRYING') {
    nextStatus = 'UP';
    retryCount = 0;
    changed = true;
  }

  const sets: string[] = ['last_check = ?', 'last_latency = ?'];
  const values: (string | number)[] = [nowIso, result.latency];
  if (nextStatus !== monitor.status) {
    sets.push('status = ?', 'retry_count = ?');
    values.push(nextStatus, retryCount);
  } else if (nextStatus === 'RETRYING') {
    sets.push('retry_count = ?');
    values.push(retryCount);
  }
  values.push(monitor.id);

  // 一次探测 = 一次往返:日志 + 监控状态 + 小时桶增量
  await env.DB.batch([
    env.DB.prepare('INSERT INTO logs (monitor_id, status_code, latency, is_fail, reason) VALUES (?, ?, ?, ?, ?)')
      .bind(monitor.id, result.statusCode, result.latency, ok ? 0 : 1, result.reason || null),
    env.DB.prepare(`UPDATE monitors SET ${sets.join(', ')} WHERE id = ?`).bind(...values),
    env.DB.prepare(`
      INSERT INTO monitor_hourly (monitor_id, hour, total, fails, latency_sum) VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(monitor_id, hour) DO UPDATE SET
        total = total + 1,
        fails = fails + excluded.fails,
        latency_sum = latency_sum + excluded.latency_sum
    `).bind(monitor.id, hour, ok ? 0 : 1, ok ? result.latency : 0),
  ]);

  // 刷新 HTTP 监控的证书/域名信息(24h)
  if (monitor.type === 'http') {
    const lastInfoCheck = monitor.check_info_status ? new Date(monitor.check_info_status).getTime() : 0;
    if (Date.now() - lastInfoCheck > 86400000) {
      await env.DB.prepare('UPDATE monitors SET check_info_status = ? WHERE id = ?')
        .bind(nowIso, monitor.id).run();
      await updateDomainCertInfo(env, monitor);
    }
  }

  // 语言在一次探测里最多读一次(getSetting 有内存缓存,但少一次是一次)
  let cachedLang: Lang | null = null;
  const getLang = async (): Promise<Lang> => (cachedLang ??= isSupportedLang(await getSetting(env, 'language')));

  // 状态跃迁才告警,避免 RETRYING 期间反复打扰。
  // 这里只交原始探测结果,最终文案由站点设置里的模板决定。
  if (changed) {
    await sendUptimeAlert(env, monitor, nextStatus === 'DOWN' ? 'DOWN' : 'UP',
      { reason: result.reason, latency: result.latency, statusCode: result.statusCode },
      await getLang(), tz);
  }

  // 错误率告警(窗口/采样数/静默均在设置里可配)
  if (monitor.alert_error_rate > 0) {
    await checkErrorRate(env, monitor, await getLang(), tz);
  }

  // 延迟阈值告警:只在探测成功时判定,失败时的耗时往往是超时值,没有参考意义
  if (ok && (monitor.alert_latency_ms || 0) > 0) {
    await checkLatencyAlert(env, monitor, result.latency, await getLang(), tz);
  }

  return result;
}

/**
 * 每日结算:清理 + 日聚合
 *
 * 按本地 01:00 跑,此时"昨天"已经完整结束。daily_uptime 只保留已结束的自然日,
 * 当天的数据一律由 monitor_hourly 实时提供 —— 这个不变式是读侧不扫 logs 的前提。
 */
async function cleanupAndAggregate(env: Bindings, tz: string) {
  const today = localDateString(tz);
  // 前天零点 → 今天零点:覆盖前天与昨天两个完整日(昨天这次写入即为终值)
  const fromHour = `${localDateAgo(tz, 2)}T00`;
  const toHour = `${today}T00`;

  await env.DB.prepare(`
    INSERT OR REPLACE INTO daily_uptime (monitor_id, date, total_checks, successful_checks, avg_latency)
    SELECT monitor_id, substr(hour, 1, 10),
           SUM(total), SUM(total - fails),
           COALESCE(CAST(AVG(CASE WHEN total > fails THEN latency_sum / (total - fails) END) AS INTEGER), 0)
    FROM monitor_hourly
    WHERE hour >= ? AND hour < ?
    GROUP BY monitor_id, substr(hour, 1, 10)
  `).bind(fromHour, toHour).run();

  await env.DB.prepare('DELETE FROM daily_uptime WHERE date >= ?').bind(today).run();
  await env.DB.prepare('DELETE FROM monitor_hourly WHERE hour < ?')
    .bind(`${localDateAgo(tz, HOURLY_RETENTION_DAYS)}T00`).run();

  // 原始日志按监控分批删:logs 上只剩 (monitor_id, created_at) 一个索引,
  // 不带 monitor_id 的时间范围删除会退化成全表扫。
  const { results: rows } = await env.DB.prepare('SELECT id FROM monitors').all<{ id: number }>();
  if (rows && rows.length > 0) {
    const stmt = env.DB.prepare(
      `DELETE FROM logs WHERE monitor_id = ? AND created_at < datetime('now','-${LOG_RETENTION_DAYS} days')`
    );
    await env.DB.batch(rows.map(m => stmt.bind(m.id)));
  }

  // 备份到 R2(如配置)。
  // 不备份 logs 原始表:它是最大的一张,而 daily_uptime + monitor_hourly 已经
  // 足够重建可用率,体积只有原来的百分之一量级。
  if (env.R2) {
    try {
      const tables = ['monitors', 'incidents', 'settings', 'notification_channels', 'subscriptions', 'daily_uptime', 'monitor_hourly'];
      const dump: Record<string, unknown[]> = {};
      for (const t of tables) {
        const { results } = await env.DB.prepare(`SELECT * FROM ${t}`).all();
        dump[t] = results || [];
      }
      const key = `backups/${localDateString(tz)}.json`;
      await env.R2.put(key, JSON.stringify(dump));
    } catch (e) { console.error('R2 backup failed:', e); }
  }
}

export async function runScheduledTasks(env: Bindings) {
  await ensureInitialized(env);
  const tasks: Promise<void>[] = [checkSites(env)];
  const tz = await getTimezone(env);
  // 每日结算锚在本地 01:00:此刻"昨天"已完整结束,按本地日汇总才不会漏掉最后几小时
  if (localHour(tz) === 1) {
    tasks.push(cleanupAndAggregate(env, tz));
    tasks.push(checkExpiryAlerts(env));
  }
  await Promise.all(tasks);
}
