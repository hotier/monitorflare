// ============================================================
// MonitorFlare — 告警文案多语言
// 支持: en / zh
// 英文走专业简洁风格,中文保留轻松风格
// ============================================================
import { renderTemplate } from './services/template';

export const SUPPORTED_LANGS = ['en', 'zh'] as const;
export type Lang = typeof SUPPORTED_LANGS[number];

export function isSupportedLang(lang: string | null | undefined): Lang {
  const l = (lang || '').toLowerCase();
  return l.startsWith('zh') ? 'zh' : 'en';
}

interface AlertCopy {
  downTitle: string;
  upTitle: string;
  downLabel: string;
  upLabel: string;
  footer: string;
}

const COPY: Record<Lang, AlertCopy> = {
  en: {
    downTitle: 'Service Down',
    upTitle: 'Service Recovered',
    downLabel: 'DOWN',
    upLabel: 'UP',
    footer: 'MonitorFlare',
  },
  zh: {
    downTitle: '服务故障报警',
    upTitle: '服务恢复通知',
    downLabel: '故障 (DOWN)',
    upLabel: '正常 (UP)',
    footer: 'MonitorFlare',
  },
};

export interface AlertMessage {
  title: string;
  statusText: string;
  time: string;
  isDown: boolean;
  detail: string;
  monitorName: string;
  monitorUrl: string;
  footer: string;
  lang: Lang;
}

/** 站点设置里可覆盖的文案;留空则用内置多语言文案 */
export interface AlertBranding {
  title?: string;
  footer?: string;
}

export function buildAlertMessage(
  monitor: { name: string; url: string },
  type: 'DOWN' | 'UP',
  detail: string,
  time: string,
  lang: Lang,
  branding?: AlertBranding,
  vars?: Record<string, string | number | null | undefined>,
): AlertMessage {
  const isDown = type === 'DOWN';
  const copy = COPY[lang];
  // 标题/落款同样吃变量:详情里能写 {name},标题里写了却原样发出去只会让人以为配错了
  const fill = (s?: string): string => {
    const tpl = s?.trim();
    if (!tpl) return '';
    return vars ? renderTemplate(tpl, { name: monitor.name, url: monitor.url, time, ...vars }).trim() : tpl;
  };
  return {
    title: fill(branding?.title) || (isDown ? copy.downTitle : copy.upTitle),
    statusText: isDown ? copy.downLabel : copy.upLabel,
    time,
    isDown,
    detail,
    monitorName: monitor.name,
    monitorUrl: monitor.url,
    footer: fill(branding?.footer) || copy.footer,
    lang,
  };
}
