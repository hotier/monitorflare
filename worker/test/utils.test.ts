import { describe, it, expect } from 'vitest';
import {
  base64UrlEncode,
  base64UrlDecode,
  sha256,
  safeEqual,
  hmacSha256,
  getAuthSecret,
  getAllowedOrigins,
  isLocalOrigin,
  toSqlDateTime,
  randomToken,
  isValidEmail,
  maskSecret,
  maskChannelConfig,
  formatTimeInTz,
} from '../src/utils';
import type { Bindings } from '../src/types';

const asEnv = (v: Record<string, unknown>): Bindings => v as unknown as Bindings;

describe('safeEqual', () => {
  it('相同字符串返回 true', async () => {
    await expect(safeEqual('hunter2', 'hunter2')).resolves.toBe(true);
  });

  it('不同字符串返回 false', async () => {
    await expect(safeEqual('hunter2', 'hunter3')).resolves.toBe(false);
  });

  it('大小写不同视为不同', async () => {
    await expect(safeEqual('Secret', 'secret')).resolves.toBe(false);
  });

  it('空串与空串相等', async () => {
    await expect(safeEqual('', '')).resolves.toBe(true);
  });

  it('空串与非空串不等', async () => {
    await expect(safeEqual('', 'a')).resolves.toBe(false);
  });

  it('长度差异不影响判定(先哈希再比较)', async () => {
    await expect(safeEqual('a', 'a'.repeat(500))).resolves.toBe(false);
  });

  it('支持多字节字符', async () => {
    await expect(safeEqual('密码123', '密码123')).resolves.toBe(true);
    await expect(safeEqual('密码123', '密码124')).resolves.toBe(false);
  });
});

describe('sha256', () => {
  it('输出 32 字节', async () => {
    expect((await sha256('x')).length).toBe(32);
  });

  it('确定性', async () => {
    expect(await sha256('x')).toEqual(await sha256('x'));
  });

  it('不同输入产生不同摘要', async () => {
    expect(await sha256('x')).not.toEqual(await sha256('y'));
  });
});

describe('base64UrlEncode / base64UrlDecode', () => {
  it('输出不含 + / = 等 URL 不安全字符', () => {
    const out = base64UrlEncode('subjects?_d=1>2<3&4');
    expect(out).not.toMatch(/[+/=]/);
  });

  it('ASCII 往返一致', () => {
    expect(base64UrlDecode(base64UrlEncode('hello world'))).toBe('hello world');
  });

  it('多字节字符往返一致', () => {
    expect(base64UrlDecode(base64UrlEncode('监控状态 · 中文'))).toBe('监控状态 · 中文');
  });

  it('接受 Uint8Array 输入', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toBe('\u0001\u0002\u0003');
  });
});

describe('hmacSha256', () => {
  it('确定性且 URL 安全', async () => {
    const a = await hmacSha256('secret', 'payload');
    const b = await hmacSha256('secret', 'payload');
    expect(a).toBe(b);
    expect(a).not.toMatch(/[+/=]/);
  });

  it('密钥不同则签名不同', async () => {
    expect(await hmacSha256('s1', 'p')).not.toBe(await hmacSha256('s2', 'p'));
  });

  it('内容不同则签名不同', async () => {
    expect(await hmacSha256('s', 'p1')).not.toBe(await hmacSha256('s', 'p2'));
  });
});

describe('getAuthSecret', () => {
  it('优先取 ADMIN_API_KEY', () => {
    expect(getAuthSecret(asEnv({ ADMIN_API_KEY: 'k', ADMIN_PASSWORD: 'p' }))).toBe('k');
  });

  it('无 API Key 时退回 ADMIN_PASSWORD', () => {
    expect(getAuthSecret(asEnv({ ADMIN_PASSWORD: 'p' }))).toBe('p');
  });

  it('空字符串视为未配置', () => {
    expect(getAuthSecret(asEnv({ ADMIN_API_KEY: '', ADMIN_PASSWORD: 'p' }))).toBe('p');
  });

  it('都没有时返回 null', () => {
    expect(getAuthSecret(asEnv({}))).toBeNull();
  });
});

describe('getAllowedOrigins', () => {
  it('按逗号拆分并去除空白', () => {
    expect(getAllowedOrigins(asEnv({ ALLOWED_ORIGIN: 'https://a.com, https://b.com' })))
      .toEqual(['https://a.com', 'https://b.com']);
  });

  it('空值返回空数组', () => {
    expect(getAllowedOrigins(asEnv({}))).toEqual([]);
    expect(getAllowedOrigins(asEnv({ ALLOWED_ORIGIN: '' }))).toEqual([]);
  });

  it('过滤掉空片段', () => {
    expect(getAllowedOrigins(asEnv({ ALLOWED_ORIGIN: 'https://a.com,,' })))
      .toEqual(['https://a.com']);
  });
});

describe('isLocalOrigin', () => {
  it('识别 localhost 与 127.0.0.1', () => {
    expect(isLocalOrigin('http://localhost:5173')).toBe(true);
    expect(isLocalOrigin('https://localhost')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:8787')).toBe(true);
  });

  it('拒绝真实域名', () => {
    expect(isLocalOrigin('https://example.com')).toBe(false);
    expect(isLocalOrigin('https://localhost.evil.com')).toBe(false);
    expect(isLocalOrigin('https://notlocalhost')).toBe(false);
  });
});

describe('toSqlDateTime', () => {
  it('ISO 转 SQLite DATETIME 格式', () => {
    expect(toSqlDateTime('2024-03-05T06:07:08.123Z')).toBe('2024-03-05 06:07:08');
  });

  it('空值返回 null', () => {
    expect(toSqlDateTime(null)).toBeNull();
    expect(toSqlDateTime(undefined)).toBeNull();
    expect(toSqlDateTime('')).toBeNull();
  });

  it('非法日期返回 null', () => {
    expect(toSqlDateTime('not-a-date')).toBeNull();
  });
});

describe('randomToken', () => {
  it('URL 安全且无填充', () => {
    expect(randomToken(24)).not.toMatch(/[+/=]/);
  });

  it('字节数决定长度', () => {
    expect(randomToken(16).length).toBe(22);
    expect(randomToken(24).length).toBe(32);
  });

  it('多次调用不重复', () => {
    expect(randomToken(24)).not.toBe(randomToken(24));
  });
});

describe('isValidEmail', () => {
  it('接受常见合法地址', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('  user@example.com  ')).toBe(true);
    expect(isValidEmail('a.b+tag@sub.example.co.uk')).toBe(true);
  });

  it('拒绝非法地址', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('user@example')).toBe(false);
    expect(isValidEmail('user@example.c')).toBe(false);
    expect(isValidEmail('user example@x.com')).toBe(false);
    expect(isValidEmail('user@@example.com')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
  });
});

describe('maskSecret', () => {
  it('短值整体掩码', () => {
    expect(maskSecret('')).toBe('****');
    expect(maskSecret('12345678')).toBe('****');
  });

  it('长值保留首尾各 4 位', () => {
    expect(maskSecret('123456789')).toBe('1234****6789');
    expect(maskSecret('abcdefghijklmnop')).toBe('abcd****mnop');
  });
});

describe('maskChannelConfig', () => {
  it('掩码敏感字段、保留普通字段', () => {
    const out = maskChannelConfig({
      config: JSON.stringify({ bot_token: 'abcdefghijklmnop', webhook_url: 'https://x/y' }),
    });
    const parsed = JSON.parse(out.config);
    expect(parsed.bot_token).toBe('abcd****mnop');
    expect(parsed.webhook_url).toBe('https://x/y');
  });

  it('非字符串值原样保留', () => {
    const out = maskChannelConfig({ config: JSON.stringify({ enabled: true, retries: 3, api_key: 'zzzzzzzzzzzz' }) });
    const parsed = JSON.parse(out.config);
    expect(parsed.enabled).toBe(true);
    expect(parsed.retries).toBe(3);
    expect(parsed.api_key).toBe('zzzz****zzzz');
  });

  it('config 非法 JSON 时原样返回', () => {
    const input = { config: '{not json' };
    expect(maskChannelConfig(input)).toEqual(input);
  });
});

describe('formatTimeInTz', () => {
  const date = new Date('2024-03-05T06:07:08Z');

  it('按指定时区输出', () => {
    expect(formatTimeInTz(date, 'UTC')).toMatch(/^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/);
  });

  it('不同时区产生不同结果', () => {
    expect(formatTimeInTz(date, 'UTC')).not.toBe(formatTimeInTz(date, 'Asia/Shanghai'));
  });

  it('非法时区退回 ISO 字符串', () => {
    expect(formatTimeInTz(date, 'Not/AZone')).toBe(date.toISOString());
  });
});
