// ============================================================
// MonitorFlare — 监测引擎
// 支持: http(HTTP/HTTPS) / dns(DoH 解析比对) / port(TCP 连通性)
// ============================================================
import type { Bindings, CheckResult, Monitor } from './types';

// ---------- URL 规范化(无协议时自动补 https://) ----------
export function normalizeMonitorUrl(raw: string): string {
  const url = (raw || '').trim();
  if (!url || /^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

// ---------- HTTP 监测 ----------
async function checkHTTP(monitor: Monitor): Promise<CheckResult> {
  const startTime = Date.now();
  try {
    let headers: Record<string, string> = {
      'User-Agent': monitor.user_agent || 'MonitorFlare/1.0',
    };
    if (monitor.request_headers) {
      try {
        headers = { ...headers, ...JSON.parse(monitor.request_headers) as Record<string, string> };
      } catch { /* ignore */ }
    }
    const fetchOptions: RequestInit = {
      method: monitor.method || 'GET',
      headers,
      cf: { cacheTtl: 0, cacheEverything: false } as RequestInitCfProperties,
    };
    if (['POST', 'PUT', 'PATCH'].includes(monitor.method || 'GET') && monitor.request_body) {
      fetchOptions.body = monitor.request_body;
      if (!headers['Content-Type']) {
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }
    const response = await fetch(normalizeMonitorUrl(monitor.url), fetchOptions);
    const latency = Date.now() - startTime;
    if (!response.ok) {
      return { ok: false, statusCode: response.status, latency, reason: `HTTP ${response.status}` };
    }
    if (monitor.keyword) {
      const text = await response.text();
      if (!text.includes(monitor.keyword)) {
        return { ok: false, statusCode: response.status, latency, reason: `Keyword "${monitor.keyword}" not found` };
      }
    }
    return { ok: true, statusCode: response.status, latency, reason: '' };
  } catch (e: unknown) {
    const latency = Date.now() - startTime;
    const errorMsg = e instanceof Error ? e.message : 'Unknown error';
    let reason = errorMsg;
    if (errorMsg.includes('handshake') || errorMsg.includes('certificate') || errorMsg.includes('SSL') || errorMsg.includes('TLS')) {
      reason = `SSL Error: ${errorMsg}`;
    } else if (errorMsg.includes('time') || errorMsg.includes('timeout')) {
      reason = 'Timeout';
    } else if (errorMsg.includes('fetch failed') || errorMsg.includes('getaddrinfo')) {
      reason = 'DNS resolution failed';
    }
    return { ok: false, statusCode: 0, latency, reason };
  }
}

// ---------- DNS 监测(DoH) ----------
interface DnsConfig {
  record_type?: string;  // A / AAAA / CNAME / MX / TXT / NS
  expected?: string;     // 期望值,逗号分隔;留空 = 仅检查记录存在
  resolver?: 'cloudflare' | 'google';
}

interface DohAnswer {
  name?: string;
  type?: number;
  data?: string;
}

function parseDnsConfig(monitor: Monitor): DnsConfig {
  try { return (monitor.config ? JSON.parse(monitor.config) : {}) as DnsConfig; } catch { return {}; }
}

function extractRecordValue(ans: DohAnswer): string {
  return (ans.data || '').replace(/\.$/, '').toLowerCase();
}

async function checkDNS(monitor: Monitor): Promise<CheckResult> {
  const startTime = Date.now();
  try {
    const cfg = parseDnsConfig(monitor);
    const recordType = (cfg.record_type || 'A').toUpperCase();
    let hostname: string;
    try {
      hostname = new URL(monitor.url).hostname;
    } catch {
      hostname = monitor.url.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    }
    const resolver = cfg.resolver === 'google'
      ? 'https://dns.google/resolve'
      : 'https://cloudflare-dns.com/dns-query';
    const url = `${resolver}?name=${encodeURIComponent(hostname)}&type=${recordType}`;
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/dns-json' },
      cf: { cacheTtl: 0, cacheEverything: false } as RequestInitCfProperties,
    });
    const latency = Date.now() - startTime;
    if (!resp.ok) {
      return { ok: false, statusCode: resp.status, latency, reason: `DoH ${resp.status}` };
    }
    const data = await resp.json<{ Status?: number; Answer?: DohAnswer[]; Comment?: string }>();
    if (data.Status !== 0) {
      return { ok: false, statusCode: 0, latency, reason: `DNS status ${data.Status} (${data.Comment || 'NXDOMAIN or error'})` };
    }
    const answers = (data.Answer || []).filter(a => (a.type || 0) > 0);
    if (answers.length === 0) {
      return { ok: false, statusCode: 0, latency, reason: `No ${recordType} record found` };
    }
    const values = answers.map(extractRecordValue);
    if (cfg.expected) {
      const expectedList = cfg.expected.split(',').map(s => s.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
      const matched = values.some(v => expectedList.includes(v));
      if (!matched) {
        return { ok: false, statusCode: 0, latency, reason: `Expected [${expectedList.join(', ')}] got [${values.join(', ')}]` };
      }
    }
    return { ok: true, statusCode: 0, latency, reason: '', detail: `${recordType}: ${values.join(', ')}` };
  } catch (e: unknown) {
    const latency = Date.now() - startTime;
    return { ok: false, statusCode: 0, latency, reason: e instanceof Error ? e.message : 'DNS check error' };
  }
}

// ---------- 端口监测(TCP connect) ----------
interface PortConfig {
  port?: number;
  timeout?: number;       // 毫秒,默认 5000
}

type SocketLike = {
  opened?: Promise<void>;
  closed?: Promise<void>;
  readable?: ReadableStream;
  close: () => void;
};

async function checkPort(monitor: Monitor): Promise<CheckResult> {
  const startTime = Date.now();
  try {
    const cfg = (() => { try { return (monitor.config ? JSON.parse(monitor.config) : {}) as PortConfig; } catch { return {}; } })();
    let hostname: string;
    try {
      hostname = new URL(monitor.url).hostname;
    } catch {
      hostname = monitor.url.replace(/^https?:\/\//, '').split('/')[0];
    }
    const port = Number(cfg.port) || 443;
    const timeoutMs = Number(cfg.timeout) || 5000;

    // Workers TCP Socket API(cloudflare:sockets)
    const mod = await import('cloudflare:sockets');
    const connect = mod.connect as unknown as (opts: { hostname: string; port: number }) => SocketLike;
    const result = await new Promise<{ ok: boolean; err?: string }>((resolve) => {
      let socket: SocketLike | null = null;
      const timer = setTimeout(() => {
        try { socket?.close(); } catch { /* ignore */ }
        resolve({ ok: false, err: 'Timeout' });
      }, timeoutMs);
      let settled = false;
      const done = (r: { ok: boolean; err?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      try {
        socket = connect({ hostname, port });
        socket.opened?.then(() => done({ ok: true })).catch((err: unknown) => done({ ok: false, err: err instanceof Error ? err.message : 'connect error' }));
        socket.closed?.catch((err: unknown) => {
          if (!settled) done({ ok: false, err: err instanceof Error ? err.message : 'closed' });
        });
        socket.readable?.getReader().read().then(() => done({ ok: true })).catch((err: unknown) => {
          if (!settled) done({ ok: false, err: err instanceof Error ? err.message : 'read error' });
        });
      } catch (err) {
        done({ ok: false, err: err instanceof Error ? err.message : 'connect failed' });
      }
    });
    const latency = Date.now() - startTime;
    if (result.ok) {
      return { ok: true, statusCode: 0, latency, reason: '', detail: `Port ${port} open` };
    }
    return { ok: false, statusCode: 0, latency, reason: `Port ${port} unreachable: ${result.err || 'refused'}` };
  } catch (e: unknown) {
    const latency = Date.now() - startTime;
    return { ok: false, statusCode: 0, latency, reason: e instanceof Error ? e.message : 'Port check error' };
  }
}

// ---------- 统一分发 ----------
export async function performCheck(monitor: Monitor, _env: Bindings): Promise<CheckResult> {
  switch (monitor.type) {
    case 'dns':  return await checkDNS(monitor);
    case 'port': return await checkPort(monitor);
    case 'http':
    default:     return await checkHTTP(monitor);
  }
}

// ---------- 域名 / 证书信息更新(多数据源 + 超时保护) ----------
const INFO_FETCH_TIMEOUT_MS = 10000;

/** 带超时的 JSON GET,失败返回 null */
async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(INFO_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch { return null; }
}

/** 证书到期:Cert Spotter 优先,失败回退 crt.sh;只取仍有效且到期最晚的一张 */
async function fetchLatestCertExpiry(domain: string): Promise<string | null> {
  const nowMs = Date.now();
  const pickLatest = (items: { not_after?: string | null }[]): string | null => {
    const exps = items
      .map(c => c.not_after)
      .filter((s): s is string => !!s)
      .map(s => new Date(s.includes('T') ? s : s.replace(' ', 'T')).getTime())
      .filter(t => !isNaN(t) && t > nowMs)
      .sort((a, b) => b - a);
    return exps.length > 0 ? new Date(exps[0]).toISOString() : null;
  };

  // 1) Cert Spotter(商用级 CT 查询,免费匿名限流)
  const spotter = await fetchJson<{ not_after?: string }[]>(
    `https://api.certspotter.com/v1/certs-by-domain?domain=${encodeURIComponent(domain)}&include_expired=false&include_subdomains=true`
  );
  if (Array.isArray(spotter) && spotter.length > 0) {
    const expiry = pickLatest(spotter);
    if (expiry) return expiry;
  }

  // 2) 回退 crt.sh(含根域与通配符证书扩展搜索)
  const browserUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const fetchCerts = async (searchDomain: string): Promise<{ not_after?: string }[]> => {
    const data = await fetchJson<{ not_after?: string }[]>(`https://crt.sh/?q=${encodeURIComponent(searchDomain)}&output=json`, { 'User-Agent': browserUA });
    return Array.isArray(data) ? data : [];
  };

  let certs = await fetchCerts(domain);
  if (domain.split('.').length > 2) {
    const parts = domain.split('.');
    const rootDomain = parts.slice(parts.length - 2).join('.');
    const [rootCerts, wildcardCerts] = await Promise.all([
      fetchCerts(rootDomain),
      fetchCerts(`%.${rootDomain}`),
    ]);
    certs = [...certs, ...rootCerts, ...wildcardCerts];
  }
  return certs.length > 0 ? pickLatest(certs) : null;
}

/** IANA RDAP bootstrap:TLD → 官方注册局端点映射(进程内缓存) */
let rdapBootstrapCache: Record<string, string[]> | null = null;
async function getBootstrapRdapUrls(domain: string): Promise<string[]> {
  try {
    const tld = domain.split('.').pop()?.toLowerCase();
    if (!tld) return [];
    if (!rdapBootstrapCache) {
      const res = await fetch('https://data.iana.org/rdap/dns.json', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const json = await res.json<{ services?: [string[], string[]][] }>();
      const map: Record<string, string[]> = {};
      for (const [tlds, urls] of json.services || []) {
        for (const t of tlds) map[t.toLowerCase()] = urls;
      }
      rdapBootstrapCache = map;
    }
    return rdapBootstrapCache[tld] || [];
  } catch { return []; }
}

function extractRdapExpiry(data: { events?: { eventAction?: string; eventDate?: string }[] } | null): string | null {
  const expEvent = (data?.events || []).find(e => (e.eventAction || '').includes('expiration'));
  return expEvent?.eventDate || null;
}

/** 域名到期:rdap.org 优先,失败回退 IANA bootstrap 直连注册局官方端点 */
async function fetchDomainExpiry(domain: string): Promise<string | null> {
  // 1) rdap.org 引导网关
  const viaBootstrap = await fetchJson<{ events?: { eventAction?: string; eventDate?: string }[] }>(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  const expiry = extractRdapExpiry(viaBootstrap);
  if (expiry) return expiry;

  // 2) 回退:直连注册局官方 RDAP 端点
  const urls = await getBootstrapRdapUrls(domain);
  for (const base of urls.slice(0, 2)) {
    const data = await fetchJson<{ events?: { eventAction?: string; eventDate?: string }[] }>(`${base.replace(/\/+$/, '')}/domain/${encodeURIComponent(domain)}`);
    const fallbackExpiry = extractRdapExpiry(data);
    if (fallbackExpiry) return fallbackExpiry;
  }
  return null;
}

export async function updateDomainCertInfo(env: Bindings, monitor: Monitor): Promise<void> {
  try {
    const urlObj = new URL(normalizeMonitorUrl(monitor.url));
    const domain = urlObj.hostname;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return;

    const [certExpiry, domainExpiry] = await Promise.all([
      fetchLatestCertExpiry(domain),
      fetchDomainExpiry(domain),
    ]);

    await env.DB.prepare('UPDATE monitors SET cert_expiry = ?, domain_expiry = ? WHERE id = ?')
      .bind(certExpiry, domainExpiry, monitor.id).run();
  } catch (e) {
    console.error('updateDomainCertInfo failed:', e);
  }
}
