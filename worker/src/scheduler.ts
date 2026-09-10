// ============================================================
// MonitorFlare — 调度任务
// 原 index.ts 1232-1450 行,纯搬迁。
// ============================================================
import type { Bindings, CheckResult, Monitor } from './types';
import { performCheck, updateDomainCertInfo } from './checks';
import { ensureInitialized, getSetting } from './init';
import { isSupportedLang } from './i18n';
import { MONITOR_COLUMNS } from './sql';
import { sendUptimeAlert, checkErrorRate, checkExpiryAlerts } from './services/alert';

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

async function performMonitorCheck(monitor: Monitor, env: Bindings) {
  const result: CheckResult = await performCheck(monitor, env);

  // 写日志
  await env.DB.prepare('INSERT INTO logs (monitor_id, status_code, latency, is_fail, reason) VALUES (?, ?, ?, ?, ?)')
    .bind(monitor.id, result.statusCode, result.latency, result.ok ? 0 : 1, result.reason || null).run();

  // 刷新 HTTP 监控的证书/域名信息(24h)
  if (monitor.type === 'http') {
    const lastInfoCheck = monitor.check_info_status ? new Date(monitor.check_info_status).getTime() : 0;
    if (Date.now() - lastInfoCheck > 86400000) {
      await env.DB.prepare('UPDATE monitors SET check_info_status = ? WHERE id = ?')
        .bind(new Date().toISOString(), monitor.id).run();
      await updateDomainCertInfo(env, monitor);
    }
  }

  // 状态机: 连续失败计数 → 告警
  const afterFailures = Math.max(1, monitor.alert_after_failures || 1);
  const lang = isSupportedLang(await getSetting(env, 'language'));
  const tz = await getSetting(env, 'timezone') || 'UTC';

  if (!result.ok) {
    const newRetry = (monitor.retry_count || 0) + 1;
    if (newRetry >= afterFailures && monitor.status === 'UP') {
      await env.DB.prepare('UPDATE monitors SET status = ?, retry_count = ?, last_check = ? WHERE id = ?')
        .bind('DOWN', 0, new Date().toISOString(), monitor.id).run();
      await sendUptimeAlert(env, monitor, 'DOWN', result.reason, lang, tz);
    } else {
      await env.DB.prepare('UPDATE monitors SET status = ?, retry_count = ?, last_check = ? WHERE id = ?')
        .bind('RETRYING', newRetry, new Date().toISOString(), monitor.id).run();
    }
  } else {
    if (monitor.status === 'DOWN' || monitor.status === 'RETRYING') {
      await env.DB.prepare('UPDATE monitors SET status = ?, retry_count = ?, last_check = ? WHERE id = ?')
        .bind('UP', 0, new Date().toISOString(), monitor.id).run();
      await sendUptimeAlert(env, monitor, 'UP', result.reason || `Response time: ${result.latency}ms`, lang, tz);
    } else {
      await env.DB.prepare('UPDATE monitors SET last_check = ? WHERE id = ?')
        .bind(new Date().toISOString(), monitor.id).run();
    }
  }

  // 错误率告警(过去 5 分钟)
  if (monitor.alert_error_rate > 0) {
    await checkErrorRate(env, monitor, lang, tz);
  }

  return result;
}

/** 日志清理 + 每日聚合 */
async function cleanupAndAggregate(env: Bindings) {
  // 清理 90 天前的日志
  await env.DB.prepare("DELETE FROM logs WHERE created_at < datetime('now','-90 days')").run();
  // 每日聚合
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS daily_uptime (
    monitor_id INTEGER NOT NULL, date TEXT NOT NULL,
    total_checks INTEGER DEFAULT 0, successful_checks INTEGER DEFAULT 0,
    avg_latency INTEGER DEFAULT 0, PRIMARY KEY (monitor_id, date)
  )`).run();
  await env.DB.prepare(`
    INSERT OR REPLACE INTO daily_uptime (monitor_id, date, total_checks, successful_checks, avg_latency)
    SELECT monitor_id, date(created_at), COUNT(*), SUM(CASE WHEN is_fail=0 THEN 1 ELSE 0 END),
           COALESCE(CAST(AVG(CASE WHEN is_fail=0 THEN latency END) AS INTEGER), 0)
    FROM logs
    WHERE created_at >= date('now','-1 day')
    GROUP BY monitor_id, date(created_at)
  `).run();
  // 备份到 R2(如配置)
  if (env.R2) {
    try {
      const tables = ['monitors', 'logs', 'incidents', 'settings', 'notification_channels', 'subscriptions'];
      const dump: Record<string, unknown[]> = {};
      for (const t of tables) {
        const { results } = await env.DB.prepare(`SELECT * FROM ${t}`).all();
        dump[t] = results || [];
      }
      const key = `backups/${new Date().toISOString().slice(0, 10)}.json`;
      await env.R2.put(key, JSON.stringify(dump));
    } catch (e) { console.error('R2 backup failed:', e); }
  }
}

export async function runScheduledTasks(env: Bindings) {
  await ensureInitialized(env);
  const tasks: Promise<void>[] = [checkSites(env)];
  const hour = new Date().getUTCHours();
  if (hour === 2) {
    tasks.push(cleanupAndAggregate(env));
    tasks.push(checkExpiryAlerts(env));
  }
  await Promise.all(tasks);
}
