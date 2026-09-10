import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { createI18n } from 'vue-i18n';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

import en from './locales/en.json';
import zh from './locales/zh.json';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

// 从 localStorage 读取语言偏好,默认跟随浏览器
function detectLocale() {
  const saved = localStorage.getItem('monitorflare_lang');
  if (saved === 'en' || saved === 'zh') return saved;
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('zh') ? 'zh' : 'en';
}

// dayjs 语言映射(相对时间等本地化)
const DAYJS_LOCALES = { en: 'en', zh: 'zh-cn' };
const applyDayjsLocale = (lang) => dayjs.locale(DAYJS_LOCALES[lang] || 'en');

const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { en, zh },
});

// 初始化时同步 dayjs 语言,否则回访用户(已存偏好/浏览器中文)相对时间仍是英文
applyDayjsLocale(i18n.global.locale.value);

// 全局时区(默认上海时区,可在设置中修改)
const storedTz = localStorage.getItem('monitorflare_tz') || 'Asia/Shanghai';
dayjs.tz.setDefault(storedTz);

// 导出切换语言/时区的辅助函数
export function setAppLanguage(lang) {
  i18n.global.locale.value = lang;
  localStorage.setItem('monitorflare_lang', lang);
  applyDayjsLocale(lang);
}

export function setAppTimezone(tz) {
  localStorage.setItem('monitorflare_tz', tz);
  dayjs.tz.setDefault(tz);
}

export function getAppTimezone() {
  return localStorage.getItem('monitorflare_tz') || 'Asia/Shanghai';
}

import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';

// 全局样式
import './styles/base.css';

// Font Awesome
import '@fortawesome/fontawesome-free/css/all.min.css';

const app = createApp(App);
app.use(router);
app.use(i18n);
app.mount('#app');
