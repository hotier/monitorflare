// ============================================================
// MonitorFlare — 告警文案多语言
// 支持: en / zh
// 英文走专业简洁风格,中文保留轻松风格
// ============================================================

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

export function buildAlertMessage(
  monitor: { name: string; url: string },
  type: 'DOWN' | 'UP',
  detail: string,
  time: string,
  lang: Lang,
): AlertMessage {
  const isDown = type === 'DOWN';
  const copy = COPY[lang];
  return {
    title: isDown ? copy.downTitle : copy.upTitle,
    statusText: isDown ? copy.downLabel : copy.upLabel,
    time,
    isDown,
    detail,
    monitorName: monitor.name,
    monitorUrl: monitor.url,
    footer: copy.footer,
    lang,
  };
}
