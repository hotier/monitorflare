// ============================================================
// MonitorFlare — HTTP / 输出相关工具
// 原 index.ts 内的私有函数,拆分时集中到此。
// ============================================================
import { maskSecret } from '../utils';

/** XML 特殊字符转义(RSS 输出用) */
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * 常量时间字符串比较。
 * 先各自 SHA-256 再逐字节异或,避免因长度或前缀不同导致提前返回,
 * 从而泄漏 token 内容。**安全相关,不要改成 `===`。**
 */
export async function safeCompare(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const digestA = await crypto.subtle.digest('SHA-256', encoder.encode(a));
  const digestB = await crypto.subtle.digest('SHA-256', encoder.encode(b));
  const bufA = new Uint8Array(digestA), bufB = new Uint8Array(digestB);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < Math.max(bufA.length, bufB.length); i++) diff |= (bufA[i] || 0) ^ (bufB[i] || 0);
  return diff === 0;
}

/** 脱敏:掩码监控请求头中的敏感字段 */
export function maskMonitorSensitive(monitor: Record<string, unknown>): Record<string, unknown> {
  if (monitor.request_headers && typeof monitor.request_headers === 'string') {
    try {
      const headers = JSON.parse(monitor.request_headers) as Record<string, string>;
      const masked: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        masked[k] = ['authorization', 'token', 'api-key', 'apikey', 'password', 'cookie', 'x-api-key'].some(s => k.toLowerCase().includes(s)) ? maskSecret(v) : v;
      }
      return { ...monitor, request_headers: JSON.stringify(masked) };
    } catch { /* keep as is */ }
  }
  return monitor;
}

/** 敏感设置 key(导出时排除) */
const SENSITIVE_SETTING_KEYS = ['status_page_password'];
export function isSensitiveSettingKey(key: string): boolean {
  return SENSITIVE_SETTING_KEYS.includes(key) || /(password|secret|token|api[_-]?key)/i.test(key);
}
