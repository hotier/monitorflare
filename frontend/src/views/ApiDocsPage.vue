<template>
  <div class="min-h-screen flex flex-col text-slate-800 dark:text-slate-200 grid-bg">
    <!-- 顶栏:与 DeployPage 同构,只放返回入口 + 语言 + 主题 -->
    <header class="sticky top-0 z-40 border-b border-black/[0.06] dark:border-white/[0.04]"
      :style="isDark ? 'background:rgba(3,7,18,0.82);backdrop-filter:blur(20px)' : 'background:rgba(255,255,255,0.82);backdrop-filter:blur(20px)'">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <router-link to="/" class="flex items-center gap-2.5 min-w-0 group">
          <div class="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center border border-emerald-500/20 shrink-0">
            <svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
              <path d="M3 12h4l2-7 3 14 2-7h7"/>
            </svg>
          </div>
          <span class="font-bold text-slate-900 dark:text-white tracking-tight truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">MonitorFlare</span>
          <span class="hidden sm:inline text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10">API</span>
        </router-link>

        <div class="flex items-center gap-1.5">
          <!-- 语言切换 -->
          <div class="relative" ref="langRef">
            <button @click="langOpen = !langOpen"
              class="flex items-center gap-1 h-8 px-2 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-all cursor-pointer"
              :title="t('languages.' + locale)">
              <i class="fas fa-globe text-[11px]"></i>
              <span class="hidden sm:inline">{{ shortLang }}</span>
              <i class="fas fa-chevron-down text-[8px]"></i>
            </button>
            <div v-if="langOpen" class="absolute right-0 mt-1.5 w-28 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl overflow-hidden z-50">
              <button v-for="l in langList" :key="l" @click="changeLang(l)"
                class="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05] cursor-pointer"
                :class="{ 'font-bold text-emerald-600 dark:text-emerald-400': l === locale }">
                {{ t('languages.' + l) }}
                <i v-if="l === locale" class="fas fa-check text-[9px]"></i>
              </button>
            </div>
          </div>
          <button @click="toggleTheme" :title="t('apiDocs.toggleTheme')"
            class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-500/10 transition-all cursor-pointer">
            <i :class="isDark ? 'fas fa-sun text-sm' : 'fas fa-moon text-sm'"></i>
          </button>
          <div class="h-4 w-px bg-slate-200 dark:bg-white/10 mx-0.5"></div>
          <router-link to="/"
            class="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/10 transition-all cursor-pointer">
            <i class="fas fa-arrow-left text-[11px]"></i>
            <span class="hidden sm:inline">{{ t('apiDocs.backHome') }}</span>
          </router-link>
        </div>
      </div>
    </header>

    <main class="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div class="lg:grid lg:grid-cols-[196px_minmax(0,1fr)] lg:gap-10">
        <!-- 目录(桌面端常驻,移动端隐藏) -->
        <aside class="hidden lg:block">
          <nav class="sticky top-24">
            <p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-600 mb-3.5">{{ t('apiDocs.tocTitle') }}</p>
            <ul class="space-y-0.5 border-l border-slate-200 dark:border-white/10">
              <li v-for="item in toc" :key="item.id">
                <a :href="`#${item.id}`" @click.prevent="scrollTo(item.id)"
                  class="block pl-3.5 py-2 text-sm border-l -ml-px transition-colors"
                  :class="activeId === item.id
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'">
                  {{ t(item.labelKey) }}
                </a>
              </li>
            </ul>
          </nav>
        </aside>

        <div class="min-w-0 space-y-12">
          <!-- Hero:标题属于正文,放在右侧列内,目录列顶部与它齐平 -->
          <div class="fade-up">
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold mb-4">
              <i class="fas fa-plug text-[10px]"></i> REST / JSON
            </div>
            <h1 class="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">{{ t('apiDocs.title') }}</h1>
            <p class="text-sm text-slate-500 dark:text-slate-400 max-w-3xl leading-relaxed">{{ t('apiDocs.subtitle') }}</p>
          </div>

          <!-- ── 概述 ── -->
          <section id="overview" class="scroll-mt-24">
            <SectionTitle icon="fa-circle-info">{{ t('apiDocs.overviewTitle') }}</SectionTitle>
            <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">{{ t('apiDocs.overviewP1') }}</p>

            <!-- Base URL -->
            <div class="glass rounded-2xl border border-slate-200 dark:border-white/[0.06] p-4 sm:p-5 mb-4">
              <div class="flex items-center justify-between gap-3 mb-2">
                <span class="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{{ t('apiDocs.baseUrl') }}</span>
                <button type="button" @click="copyText(baseUrl)"
                  class="text-[11px] font-semibold text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer">
                  <i class="fas" :class="copiedKey === baseUrl ? 'fa-check' : 'fa-copy'"></i>
                  {{ copiedKey === baseUrl ? t('apiDocs.copied') : t('apiDocs.copy') }}
                </button>
              </div>
              <code class="block font-mono text-xs sm:text-sm text-emerald-600 dark:text-emerald-400 break-all">{{ baseUrl }}</code>
              <p class="text-[11px] text-slate-500 dark:text-slate-500 mt-2.5 leading-relaxed">{{ t('apiDocs.baseUrlHint') }}</p>
            </div>

            <ul class="space-y-2">
              <li v-for="i in [1, 2, 3]" :key="i" class="flex gap-2.5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                <i class="fas fa-check text-emerald-500 text-[10px] mt-1.5 shrink-0"></i>
                <span>{{ t(`apiDocs.overviewL${i}`) }}</span>
              </li>
            </ul>
          </section>

          <!-- ── 鉴权 ── -->
          <section id="auth" class="scroll-mt-24">
            <SectionTitle icon="fa-shield-halved">{{ t('apiDocs.authTitle') }}</SectionTitle>
            <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">{{ t('apiDocs.authIntro') }}</p>

            <div class="glass rounded-2xl border border-slate-200 dark:border-white/[0.06] overflow-hidden mb-4">
              <div v-for="(row, idx) in authRows" :key="row.key"
                class="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-4"
                :class="idx > 0 ? 'border-t border-slate-200 dark:border-white/[0.06]' : ''">
                <div class="sm:w-48 shrink-0">
                  <span class="inline-block px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 break-all">{{ row.key }}</span>
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">{{ t(row.titleKey) }}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-500 leading-relaxed mt-0.5">{{ t(row.descKey) }}</p>
                </div>
              </div>
            </div>

            <CodeBlock :code="authExample" :label="t('apiDocs.authExampleTitle')" :copied-key="copiedKey" @copy="copyText" />
          </section>

          <!-- ── 各接口分组 ── -->
          <section v-for="g in docGroups" :key="g.id" :id="g.id" class="scroll-mt-24">
            <SectionTitle :icon="g.icon">
              {{ t(g.titleKey) }}
              <span class="ml-1 align-middle"><AuthBadge :auth="g.auth" /></span>
            </SectionTitle>
            <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-5">{{ t(g.descKey) }}</p>

            <div class="space-y-4">
              <article v-for="ep in g.endpoints" :key="ep.id"
                class="glass rounded-2xl border border-slate-200 dark:border-white/[0.06] overflow-hidden">
                <!-- 路径行:左侧整块是展开/收起开关,右侧复制按钮独立(不嵌套,避免点复制触发折叠) -->
                <div class="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-2 bg-slate-50/70 dark:bg-white/[0.02]"
                  :class="isEpOpen(ep.id) ? 'border-b border-slate-200 dark:border-white/[0.06]' : ''">
                  <button type="button" @click="toggleEp(ep.id)"
                    class="group flex items-center gap-2 min-w-0 cursor-pointer text-left"
                    :aria-expanded="isEpOpen(ep.id)" :aria-controls="`ep-${ep.id}`"
                    :title="isEpOpen(ep.id) ? t('apiDocs.epCollapse') : t('apiDocs.epExpand')">
                    <i class="fas fa-chevron-right text-[10px] text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-all duration-200 shrink-0"
                      :class="{ 'rotate-90': isEpOpen(ep.id) }" aria-hidden="true"></i>
                    <!-- 同一路径可能有多个方法(GET 列表 + POST 新建),标签并列展示 -->
                    <span class="flex items-center gap-1 shrink-0">
                      <MethodTag v-for="m in ep.methods" :key="m.method" :method="m.method" />
                    </span>
                    <code class="font-mono text-[13px] font-semibold text-slate-800 dark:text-slate-100 break-all">{{ ep.path }}</code>
                  </button>
                  <button type="button" @click="copyText(ep.path)" :title="t('apiDocs.copy')"
                    class="ml-auto text-slate-400 hover:text-emerald-500 transition-colors cursor-pointer">
                    <i class="fas" :class="copiedKey === ep.path ? 'fa-check' : 'fa-copy'"></i>
                  </button>
                </div>

                <!-- 0fr ↔ 1fr 过渡:不用 JS 量高度;收起时移出无障碍树 -->
                <div :id="`ep-${ep.id}`" class="grid transition-all duration-300 ease-out"
                  :class="isEpOpen(ep.id) ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'"
                  :aria-hidden="!isEpOpen(ep.id)">
                  <div class="overflow-hidden">
                    <div class="p-4 sm:p-5">
                      <!-- 完整地址:Base URL + 路径,随当前站点 origin 变化 -->
                      <!-- 三个子元素统一 20px 行盒(leading-5 / h-5):标签 10px、地址 12px、图标默认字号,
                           字号不同却要同一行对齐,靠 mt-0.5 手调会随字体渲染漂移,统一行高才稳 -->
                      <div class="flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] px-3 py-2.5">
                        <span class="shrink-0 text-[10px] font-bold uppercase tracking-widest leading-5 text-slate-500 dark:text-slate-400">{{ t('apiDocs.fullUrl') }}</span>
                        <code class="flex-1 min-w-0 font-mono text-xs leading-5 text-slate-700 dark:text-slate-300 break-all">{{ baseUrl }}{{ requestTarget(ep) }}</code>
                        <button type="button" @click="copyText(baseUrl + requestTarget(ep))" :title="t('apiDocs.copy')"
                          class="shrink-0 h-5 flex items-center text-slate-400 hover:text-emerald-500 transition-colors cursor-pointer">
                          <i class="fas" :class="copiedKey === baseUrl + requestTarget(ep) ? 'fa-check' : 'fa-copy'"></i>
                        </button>
                      </div>
                      <!-- 只在路径带变量时出现:解释 :id / :token 与参数表「路径」行的关系 -->
                      <p v-if="ep.path.includes(':')" class="mt-1.5 text-[11px] text-slate-500 dark:text-slate-500 leading-relaxed">
                        {{ t('apiDocs.pathVarHint') }}
                      </p>

                      <!-- 路径代表资源,方法代表动作:同一路径的每个方法一块,块间用分隔线 -->
                      <div v-for="(m, mi) in ep.methods" :key="m.method" class="mt-4 space-y-3"
                        :class="mi > 0 ? 'pt-4 border-t border-slate-200 dark:border-white/[0.06]' : ''">
                        <div class="flex items-start gap-2">
                          <MethodTag :method="m.method" />
                          <p class="flex-1 min-w-0 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{{ t(m.descKey) }}</p>
                        </div>

                        <!-- 参数表。brief 端点(管理接口)不列参数:请求体字段随后台版本演进,写了就会过时 -->
                        <template v-if="!ep.brief">
                          <template v-if="m.params.length">
                            <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{{ t('apiDocs.paramsTitle') }}</p>
                            <div class="rounded-xl border border-slate-200 dark:border-white/10 overflow-x-auto">
                              <table class="w-full text-left text-xs">
                                <thead class="bg-slate-100/80 dark:bg-white/[0.04] text-slate-500 dark:text-slate-400">
                                  <tr>
                                    <th class="px-3 py-2 font-semibold">{{ t('apiDocs.colName') }}</th>
                                    <th class="px-3 py-2 font-semibold">{{ t('apiDocs.colIn') }}</th>
                                    <th class="px-3 py-2 font-semibold">{{ t('apiDocs.colRequired') }}</th>
                                    <th class="px-3 py-2 font-semibold">{{ t('apiDocs.colDefault') }}</th>
                                    <th class="px-3 py-2 font-semibold">{{ t('apiDocs.colDesc') }}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr v-for="p in m.params" :key="p.name" class="border-t border-slate-200 dark:border-white/[0.06]">
                                    <td class="px-3 py-2 font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">{{ p.name }}</td>
                                    <td class="px-3 py-2 text-slate-500 dark:text-slate-500 whitespace-nowrap">{{ t('apiDocs.in_' + p.in) }}</td>
                                    <!-- 必填单独一列:它是"不给就报错"和"不给就用默认值"的分界,
                                         塞进默认值列里会被读成"默认值是必填" -->
                                    <td class="px-3 py-2 whitespace-nowrap"
                                      :class="p.required ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-400 dark:text-slate-500'">
                                      {{ p.required ? t('apiDocs.required') : t('apiDocs.optional') }}
                                    </td>
                                    <td class="px-3 py-2 font-mono text-slate-500 dark:text-slate-500 whitespace-nowrap">{{ p.def || '—' }}</td>
                                    <td class="px-3 py-2 text-slate-600 dark:text-slate-400 leading-relaxed">{{ t(p.descKey) }}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </template>
                          <p v-else class="text-xs text-slate-500 dark:text-slate-500">{{ t('apiDocs.noParams') }}</p>
                        </template>

                        <!-- 只有响应示例:请求的样子已经由上面的完整地址 + 参数表说清了,
                             再给一份请求报文只是同一件事换个写法 -->
                        <CodeBlock v-if="m.res" :code="m.res" :label="t('apiDocs.resTitle')" :copied-key="copiedKey" @copy="copyText" />

                        <p v-if="m.noteKey" class="text-[11px] text-slate-500 dark:text-slate-500 leading-relaxed flex gap-2">
                          <i class="fas fa-circle-info mt-0.5 shrink-0"></i>
                          <span>{{ t(m.noteKey) }}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <!-- ── 错误码与限制 ── -->
          <section id="errors" class="scroll-mt-24">
            <SectionTitle icon="fa-triangle-exclamation">{{ t('apiDocs.errorsTitle') }}</SectionTitle>
            <p class="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">{{ t('apiDocs.errorsIntro') }}</p>

            <div class="glass rounded-2xl border border-slate-200 dark:border-white/[0.06] overflow-hidden mb-6">
              <div v-for="(e, idx) in errorRows" :key="e.code"
                class="px-4 sm:px-5 py-3 flex flex-col sm:flex-row gap-1 sm:gap-4"
                :class="idx > 0 ? 'border-t border-slate-200 dark:border-white/[0.06]' : ''">
                <code class="sm:w-16 shrink-0 font-mono text-xs font-bold text-slate-800 dark:text-slate-200">{{ e.code }}</code>
                <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{{ t(e.descKey) }}</p>
              </div>
            </div>

            <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">{{ t('apiDocs.limitsTitle') }}</p>
            <ul class="space-y-2">
              <li v-for="i in [1, 2, 3, 4]" :key="i" class="flex gap-2.5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                <i class="fas fa-circle text-[6px] text-slate-400 mt-2 shrink-0"></i>
                <span>{{ t(`apiDocs.limit${i}`) }}</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="border-t border-black/[0.06] dark:border-white/[0.04] py-4 mt-6">
      <div class="max-w-6xl mx-auto px-6 flex justify-center text-xs text-slate-500 dark:text-slate-600">
        <p>&copy; {{ new Date().getFullYear() }} MonitorFlare. {{ t('deployPage.openSource') }}</p>
      </div>
    </footer>
  </div>
</template>

<script setup>
// ApiDocsPage — 全站 API 调用说明
//
// 内容刻意做数据驱动:端点清单在下面的 GROUPS / ADMIN_ENDPOINTS 里维护,
// 模板只负责渲染。新增接口时改这一处即可,不用来回改模板结构。
//
// SectionTitle / MethodTag / AuthBadge / CodeBlock 四个展示型子组件直接写在
// 本文件的 setup 作用域里:它们只服务这一页,拆成独立 .vue 反而多一层目录。
import { h, ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTheme } from '../composables/useTheme';
import { setAppLanguage } from '../main';

const { t, locale } = useI18n();
const { isDark, toggleTheme } = useTheme('theme');

/**
 * Base URL 一律取当前站点的 origin:文档可能跑在本地、沙箱、正式域名下,
 * 写死任何一个域名都会过期。用 ref 而不是模块常量,挂载时再同步一次 ——
 * 预渲染/SSR 场景首帧没有 location,常量形式会永远停在空串。
 * 所有示例(鉴权示例、每个端点的完整地址)都由它派生,改一处即可全站生效。
 */
const baseUrl = ref('');
const syncBaseUrl = () => {
    baseUrl.value = typeof location !== 'undefined' ? location.origin : '';
};
syncBaseUrl();

/**
 * 请求目标(路径 + 查询串),:id / :token 换成可直接用的示例值。
 * 路径里的变量本身就是参数(见参数表的「路径」行),不存在"地址里传一次、
 * 查询串里再传一次";把它示例化后,完整地址与请求行第一行逐字一致,
 * 免得读者对着 :id 猜该不该再拼 ?id=。
 */
const requestTarget = (ep) => {
    const path = ep.path
        .replace(/:id/g, '1')
        .replace(/:token/g, 'YOUR_WEBHOOK_TOKEN');
    return path + (ep.query ? `?${ep.query}` : '');
};

/** 只服务鉴权区那个示例:接口卡片已经不再展示请求报文(与参数表重复) */
const buildRequest = (ep, auth) => {
    let host = baseUrl.value;
    try { host = new URL(baseUrl.value).host; } catch { /* origin 为空时原样输出 */ }
    const lines = [
        // 不写 HTTP/1.1:它是 1.1 文本报文的写法,HTTP/2、/3 里没有这个字段,
        // 版本由客户端自动协商,写出来只会让读者以为是必填项
        `${ep.method} ${requestTarget(ep)}`,
        `Host: ${host}`,
    ];
    if (auth === 'key' || auth === 'admin') lines.push('Authorization: Bearer ut_your_key');
    return lines.join('\n');
};

/* ---------------------------------- 语言 ---------------------------------- */
const langOpen = ref(false);
const langRef = ref(null);
const langList = ['en', 'zh'];
const shortLang = computed(() => (locale.value === 'zh' ? '中文' : 'EN'));
const changeLang = (l) => {
    setAppLanguage(l);
    locale.value = l;
    langOpen.value = false;
};
const onClickOutside = (e) => {
    if (langOpen.value && langRef.value && !langRef.value.contains(e.target)) langOpen.value = false;
};

/* ---------------------------------- 复制 ---------------------------------- */
const copiedKey = ref('');
let copyTimer = null;
const copyText = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        copiedKey.value = text;
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { copiedKey.value = ''; }, 1800);
    } catch {
        copiedKey.value = '';
    }
};

/* --------------------------------- 目录/TOC -------------------------------- */
const toc = [
    { id: 'overview', labelKey: 'apiDocs.overviewTitle' },
    { id: 'auth', labelKey: 'apiDocs.authTitle' },
    { id: 'public', labelKey: 'apiDocs.tocPublic' },
    { id: 'v1', labelKey: 'apiDocs.tocV1' },
    { id: 'webhook', labelKey: 'apiDocs.tocWebhook' },
    { id: 'admin', labelKey: 'apiDocs.tocAdmin' },
    { id: 'errors', labelKey: 'apiDocs.tocErrors' },
];
const activeId = ref('overview');
let observer = null;

const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* --------------------------------- 鉴权方式 -------------------------------- */
const authRows = [
    { key: 'ut_xxx', titleKey: 'apiDocs.authKeyTitle', descKey: 'apiDocs.authKeyDesc' },
    { key: 'session', titleKey: 'apiDocs.authSessionTitle', descKey: 'apiDocs.authSessionDesc' },
    { key: 'status', titleKey: 'apiDocs.authStatusTitle', descKey: 'apiDocs.authStatusDesc' },
    { key: 'Cf-Access-Jwt-Assertion', titleKey: 'apiDocs.authCfTitle', descKey: 'apiDocs.authCfDesc' },
];
const authExample = computed(() => buildRequest(
    { method: 'GET', path: '/api/v1/monitors' },
    'key',
));

/* --------------------------------- 接口清单 -------------------------------- */
// 每个端点只声明 path / query / params 这些原始信息:完整地址由 requestTarget(ep) 拼,
// 站点换了示例不用逐条改;请求长什么样交给参数表,不再另给一份请求报文。
const GROUPS = [
    {
        id: 'public',
        icon: 'fa-globe',
        auth: 'none',
        titleKey: 'apiDocs.publicTitle',
        descKey: 'apiDocs.publicDesc',
        endpoints: [
            {
                id: 'status',
                method: 'GET',
                path: '/api/status',
                descKey: 'apiDocs.epStatus',
                noteKey: 'apiDocs.epStatusNote',
                params: [],
                res: `{
  "generated_at": "2026-09-15T08:00:00.000Z",
  "monitors": [
    {
      "id": 1,
      "name": "Main Site",
      "url": "https://example.com",
      "type": "http",
      "status": "up",
      "paused": 0,
      "tags": "prod",
      "last_check": "2026-09-15 08:00:00",
      "uptime_7d": 99.9,
      "uptime_30d": 99.8,
      "latency": 132
    }
  ],
  "incidents": [
    {
      "id": 12,
      "title": "API 响应变慢",
      "severity": "warning",
      "status": "active",
      "type": "incident",
      "created_at": "2026-09-15 07:12:00",
      "resolved_at": null
    }
  ]
}`,
            },
            {
                id: 'monitors-public',
                method: 'GET',
                path: '/monitors/public',
                descKey: 'apiDocs.epMonitorsPublic',
                noteKey: 'apiDocs.epMonitorsPublicNote',
                params: [
                    { name: 'id', in: 'query', def: '', descKey: 'apiDocs.pMonitorId' },
                    { name: 'ids', in: 'query', def: '', descKey: 'apiDocs.pMonitorIds' },
                    { name: 'detail', in: 'query', def: '', descKey: 'apiDocs.pDetail' },
                ],
                query: 'detail=1',
                res: `// 不带 detail:精简数组
[
  {
    "id": 1,
    "name": "Main Site",
    "url": "https://example.com",
    "type": "http",
    "status": "up",
    "last_check": "2026-09-15 08:00:00",
    "cert_expiry": 1767225600,
    "domain_expiry": null,
    "paused": 0,
    "tags": "prod",
    "check_ssl": 1
  }
]

// 带 ?detail=1:同一批监控,附带延迟与可用率
{
  "monitors": [
    {
      "id": 1,
      "name": "Main Site",
      "url": "https://example.com",
      "type": "http",
      "status": "up",
      "last_check": "2026-09-15 08:00:00",
      "last_latency": 132,
      "latency": 132,
      "cert_expiry": 1767225600,
      "domain_expiry": null,
      "paused": 0,
      "tags": "prod",
      "check_ssl": 1,
      "created_at": "2026-01-01 00:00:00",
      "uptime_24h": 100,
      "uptime_7d": 99.9,
      "uptime_30d": 99.8,
      "uptime_90d": 99.6,
      "daily_stats": [
        { "date": "2026-09-14", "up": 287, "total": 288 }
      ],
      "recent_latencies": [130, 128, 141]
    }
  ]
}`,
            },
            {
                id: 'monitor-public-detail',
                method: 'GET',
                path: '/monitors/public/detail',
                descKey: 'apiDocs.epMonitorDetail',
                noteKey: 'apiDocs.epMonitorDetailNote',
                params: [
                    { name: 'id', in: 'query', def: '', required: true, descKey: 'apiDocs.pId' },
                    { name: 'range', in: 'query', def: '24h', descKey: 'apiDocs.pRange' },
                    { name: 'limit', in: 'query', def: '50', descKey: 'apiDocs.pLimitLogs' },
                ],
                query: 'id=1&range=24h&limit=50',
                res: `{
  "monitor": {
    "id": 1,
    "name": "Main Site",
    "url": "https://example.com",
    "type": "http",
    "method": "GET",
    "interval": 5,
    "status": "up",
    "last_check": "2026-09-15 08:00:00",
    "last_latency": 132,
    "latency": 132,
    "paused": 0,
    "tags": "prod",
    "uptime_24h": 100,
    "uptime_7d": 99.9,
    "uptime_30d": 99.8,
    "uptime_90d": 99.6,
    "daily_stats": [{ "date": "2026-09-14", "up": 287, "total": 288 }]
  },
  "logs": [
    { "id": 9812, "created_at": "2026-09-15 08:00:00", "status_code": 200, "latency": 132, "is_fail": 0, "reason": null }
  ],
  "latency_series": [
    { "created_at": "2026-09-15 07:00:00", "latency": 128 }
  ],
  "incidents": []
}`,
            },
            {
                id: 'incidents-active',
                method: 'GET',
                path: '/incidents',
                descKey: 'apiDocs.epIncidentsActive',
                noteKey: 'apiDocs.epIncidentsActiveNote',
                params: [],

                res: `[
  {
    "id": 12,
    "title": "API 响应变慢",
    "description": "正在排查数据库连接池",
    "severity": "warning",
    "status": "active",
    "type": "incident",
    "scheduled_start": null,
    "scheduled_end": null,
    "affected_monitors": "1,2",
    "created_at": "2026-09-15 07:12:00",
    "updated_at": "2026-09-15 07:40:00",
    "resolved_at": null
  }
]`,
            },
            {
                id: 'feed',
                method: 'GET',
                path: '/feed.xml',
                descKey: 'apiDocs.epFeed',
                noteKey: 'apiDocs.epFeedNote',
                params: [],

                res: `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>MonitorFlare</title>
    <description>Status updates</description>
    <item>
      <title>API 响应变慢 [active]</title>
      <pubDate>Tue, 15 Sep 2026 07:12:00 GMT</pubDate>
      <description>正在排查数据库连接池</description>
    </item>
  </channel>
</rss>`,
            },
            {
                id: 'subscribe',
                method: 'POST',
                path: '/api/subscribe',
                descKey: 'apiDocs.epSubscribe',
                params: [
                    { name: 'email', in: 'body', def: '', required: true, descKey: 'apiDocs.pEmail' },
                ],
                res: `{ "success": true }`,
            },
            {
                id: 'unsubscribe',
                method: 'POST',
                path: '/api/unsubscribe',
                descKey: 'apiDocs.epUnsubscribe',
                noteKey: 'apiDocs.epUnsubscribeNote',
                params: [
                    { name: 'token', in: 'body', def: '', required: true, descKey: 'apiDocs.pUnsubToken' },
                ],
                res: `{ "success": true }`,
            },
        ],
    },
    {
        id: 'v1',
        icon: 'fa-key',
        auth: 'key',
        titleKey: 'apiDocs.v1Title',
        descKey: 'apiDocs.v1Desc',
        endpoints: [
            {
                id: 'v1-monitors',
                method: 'GET',
                path: '/api/v1/monitors',
                descKey: 'apiDocs.epV1Monitors',
                noteKey: 'apiDocs.epV1MonitorsNote',
                params: [],

                res: `[
  {
    "id": 1,
    "name": "Main Site",
    "url": "https://example.com",
    "type": "http",
    "method": "GET",
    "interval": 5,
    "status": "up",
    "retry_count": 2,
    "last_check": "2026-09-15 08:00:00",
    "last_latency": 132,
    "keyword": null,
    "user_agent": null,
    "tags": "prod",
    "paused": 0,
    "check_ssl": 1,
    "check_domain": 0,
    "alert_after_failures": 2,
    "sort_order": 0,
    "created_at": "2026-01-01 00:00:00"
  }
]`,
            },
            {
                id: 'v1-logs',
                method: 'GET',
                path: '/api/v1/logs',
                descKey: 'apiDocs.epV1Logs',
                noteKey: 'apiDocs.epV1LogsNote',
                params: [
                    { name: 'monitor_id', in: 'query', def: '全部', descKey: 'apiDocs.pMonitorId' },
                    { name: 'since', in: 'query', def: '', descKey: 'apiDocs.pSince' },
                    { name: 'until', in: 'query', def: '', descKey: 'apiDocs.pUntil' },
                    { name: 'limit', in: 'query', def: '100', descKey: 'apiDocs.pLimit5000' },
                    { name: 'offset', in: 'query', def: '0', descKey: 'apiDocs.pOffset' },
                ],
                query: 'monitor_id=1&limit=100&offset=0&since=2026-09-01',
                res: `{
  "total": 1284,
  "limit": 100,
  "offset": 0,
  "logs": [
    {
      "id": 1284,
      "monitor_id": 1,
      "status_code": 200,
      "latency": 132,
      "is_fail": 0,
      "reason": null,
      "created_at": "2026-09-15 08:00:00"
    }
  ]
}`,
            },
            {
                id: 'v1-incidents',
                method: 'GET',
                path: '/api/v1/incidents',
                descKey: 'apiDocs.epV1Incidents',
                params: [
                    { name: 'limit', in: 'query', def: '500', descKey: 'apiDocs.pLimit1000' },
                ],
                query: 'limit=200',
                res: `[
  {
    "id": 12,
    "title": "API 响应变慢",
    "description": "正在排查数据库连接池",
    "severity": "warning",
    "status": "resolved",
    "type": "incident",
    "affected_monitors": "1,2",
    "created_at": "2026-09-15 07:12:00",
    "resolved_at": "2026-09-15 09:02:00"
  }
]`,
            },
            {
                id: 'v1-uptime',
                method: 'GET',
                path: '/api/v1/uptime',
                descKey: 'apiDocs.epV1Uptime',
                noteKey: 'apiDocs.epV1UptimeNote',
                params: [
                    { name: 'days', in: 'query', def: '30', descKey: 'apiDocs.pDays' },
                ],
                query: 'days=90',
                res: `{
  "days": 90,
  "daily": [
    {
      "monitor_id": 1,
      "date": "2026-09-14",
      "total_checks": 288,
      "successful_checks": 287,
      "avg_latency": 130.4
    }
  ],
  "summary": [
    {
      "id": 1,
      "name": "Main Site",
      "url": "https://example.com",
      "type": "http",
      "uptime": 99.8,
      "checks": 25920
    }
  ]
}`,
            },
            {
                id: 'v1-export',
                method: 'GET',
                path: '/api/v1/export',
                descKey: 'apiDocs.epV1Export',
                noteKey: 'apiDocs.epV1ExportNote',
                params: [
                    { name: 'limit', in: 'query', def: '1000', descKey: 'apiDocs.pLimit5000' },
                ],
                query: 'limit=5000',
                res: `{
  "app": "MonitorFlare",
  "version": 1,
  "exported_at": "2026-09-15T08:00:00.000Z",
  "monitors": [{ "id": 1, "name": "Main Site" }],
  "logs": [{ "id": 1284, "monitor_id": 1, "is_fail": 0 }],
  "incidents": [],
  "uptime": [{ "monitor_id": 1, "date": "2026-09-14", "total_checks": 288, "successful_checks": 287, "avg_latency": 130.4 }],
  "settings": { "site_title": "MonitorFlare" },
  "notification_channels": [{ "id": 1, "type": "telegram", "name": "Ops", "enabled": 1 }]
}`,
            },
        ],
    },
    {
        id: 'webhook',
        icon: 'fa-satellite-dish',
        auth: 'token',
        titleKey: 'apiDocs.webhookTitle',
        descKey: 'apiDocs.webhookDesc',
        endpoints: [
            {
                id: 'webhook-inbound',
                method: 'POST',
                path: '/webhooks/:token',
                descKey: 'apiDocs.epWebhook',
                noteKey: 'apiDocs.epWebhookNote',
                params: [
                    { name: 'token', in: 'path', def: '', required: true, descKey: 'apiDocs.pWebhookToken' },
                    { name: 'title', in: 'body', def: '', required: true, descKey: 'apiDocs.pWebhookTitle' },
                    { name: 'description', in: 'body', def: '', descKey: 'apiDocs.pWebhookDesc' },
                    { name: 'severity', in: 'body', def: 'info', descKey: 'apiDocs.pWebhookSeverity' },
                ],
                res: `HTTP/1.1 201 Created

{ "success": true }`,
            },
        ],
    },
];

/**
 * 管理接口。
 * 与公开接口共用同一套端点卡片(方法标签 + 完整地址 + 说明 + 参数表),只是标记 brief:
 * 不列参数表 —— 它们的请求体就是后台表单,字段随版本演进,文档里逐项写出来必然过时。
 * [方法, 路径, i18n 后缀]
 */
const ADMIN_ENDPOINTS = [
    ['GET', '/api/health', 'adminHealth'],
    // 列表 / 日志 / 可用率是同一个端点的三种口径,靠 ?include= 与 ?id= 区分
    ['GET', '/api/monitors', 'adminMonitorsList'],
    ['GET', '/api/monitors?id=:id&include=logs', 'adminMonitorLogs'],
    ['GET', '/api/monitors?include=stats', 'adminMonitorStats'],
    ['POST', '/api/monitors', 'adminMonitorsCreate'],
    ['POST', '/api/monitors/:id?action=check', 'adminMonitorCheck'],
    ['POST', '/api/monitors/:id?action=pause', 'adminMonitorPause'],
    ['PATCH', '/api/monitors/:id/config', 'adminMonitorConfig'],
    ['DELETE', '/api/monitors/:id', 'adminMonitorDelete'],
    ['POST', '/api/monitors/batch', 'adminMonitorsBatch'],
    ['PUT', '/api/monitors/reorder', 'adminMonitorsReorder'],
    ['GET', '/api/incidents?status=all', 'adminIncidentsAll'],
    ['POST', '/api/incidents', 'adminIncidentsCreate'],
    ['PATCH', '/api/incidents/:id', 'adminIncidentsUpdate'],
    ['DELETE', '/api/incidents/:id', 'adminIncidentsDelete'],
    ['GET', '/api/settings', 'adminSettingsGet'],
    ['PUT', '/api/settings', 'adminSettings'],
    ['GET', '/api/notification-channels', 'adminChannelsList'],
    ['POST', '/api/notification-channels', 'adminChannelsCreate'],
    ['PATCH', '/api/notification-channels/:id', 'adminChannelsUpdate'],
    ['DELETE', '/api/notification-channels/:id', 'adminChannelsDelete'],
    ['POST', '/api/notification-channels/:id?action=test', 'adminChannelsTest'],
    ['POST', '/api/test-alert', 'adminTestAlert'],
    ['GET', '/api/alert-templates', 'adminTemplatesList'],
    ['POST', '/api/alert-templates', 'adminTemplatesCreate'],
    ['PUT', '/api/alert-templates/:id', 'adminTemplatesUpdate'],
    ['POST', '/api/alert-templates/:id?action=duplicate', 'adminTemplatesDuplicate'],
    ['POST', '/api/alert-templates/:id?action=default', 'adminTemplatesDefault'],
    ['DELETE', '/api/alert-templates/:id', 'adminTemplatesDelete'],
    ['GET', '/api/api-keys', 'adminKeysList'],
    ['POST', '/api/api-keys', 'adminKeysCreate'],
    ['DELETE', '/api/api-keys/:id', 'adminKeysDelete'],
    // 导出与恢复是同一个资源:GET 拿快照,POST 用快照覆盖整站
    ['GET', '/api/backup', 'adminBackupExport'],
    ['POST', '/api/backup', 'adminBackupRestore'],
].map(([method, path, key], i) => ({
    id: `admin-${i}`,
    method,
    path,
    descKey: `apiDocs.${key}`,
    brief: true,
    params: [],
}));

const ADMIN_GROUP = {
    id: 'admin',
    icon: 'fa-user-lock',
    auth: 'admin',
    titleKey: 'apiDocs.adminTitle',
    descKey: 'apiDocs.adminIntro',
    endpoints: ADMIN_ENDPOINTS,
};

const ERROR_ROWS = [
    { code: '400', descKey: 'apiDocs.err400' },
    { code: '401', descKey: 'apiDocs.err401' },
    { code: '404', descKey: 'apiDocs.err404' },
    { code: '500', descKey: 'apiDocs.err500' },
    { code: '503', descKey: 'apiDocs.err503' },
];

/**
 * 按路径合并:路径是资源(/api/monitors),方法是动作(GET 列表 / POST 新建)。
 * 拆成两张卡片会让人误以为是两个不同的端点,路径还得重复一遍;
 * 合并后一张卡片里按方法分块,共用同一条路径与完整地址。
 * 顺序按每个路径第一次出现的位置,接口清单读起来仍是从上到下。
 */
const mergeByPath = (endpoints) => {
    const order = [];
    const byPath = new Map();
    for (const ep of endpoints) {
        if (!byPath.has(ep.path)) {
            byPath.set(ep.path, []);
            order.push(ep.path);
        }
        byPath.get(ep.path).push(ep);
    }
    return order.map(path => {
        const list = byPath.get(path);
        return {
            id: list[0].id,          // 展开状态按卡片记,取第一个方法的 id 即可
            path,
            brief: list[0].brief,
            methods: list.map(({ method, descKey, noteKey, params, res }) =>
                ({ method, descKey, noteKey, params, res })),
        };
    });
};

// 管理接口并入同一循环,不再单独用一张表格渲染 —— 两处排版天然一致。
const docGroups = computed(() => [...GROUPS, ADMIN_GROUP].map(g => ({
    ...g,
    endpoints: mergeByPath(g.endpoints),
})));
const errorRows = ERROR_ROWS;

/* ------------------------------ 接口展开/收起 ------------------------------ */
// 默认全部收起:一屏能看到所有路径,需要细节再逐条展开。
// 用 Set 存已展开的 id(端点 id 全站唯一);赋新 Set 触发响应式更新。
const openEps = ref(new Set());
const isEpOpen = (id) => openEps.value.has(id);
const toggleEp = (id) => {
    const next = new Set(openEps.value);
    if (!next.delete(id)) next.add(id);
    openEps.value = next;
};

/* ------------------------------ 展示型子组件 ------------------------------ */
const METHOD_CLASS = {
    GET: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    POST: 'bg-sky-500/12 text-sky-600 dark:text-sky-400 border-sky-500/25',
    PUT: 'bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25',
    PATCH: 'bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25',
    DELETE: 'bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/25',
};

const AUTH_META = {
    none: { key: 'apiDocs.authNone', cls: 'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-400/25' },
    key: { key: 'apiDocs.authKey', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25' },
    admin: { key: 'apiDocs.authAdmin', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25' },
    token: { key: 'apiDocs.authToken', cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25' },
};

const SectionTitle = {
    props: { icon: { type: String, default: 'fa-circle' } },
    setup(props, { slots }) {
        return () => h('h2', { class: 'flex items-center gap-2.5 text-lg font-bold text-slate-900 dark:text-white mb-3' }, [
            h('span', { class: 'w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0' }, [
                h('i', { class: `fas ${props.icon} text-emerald-500 text-[11px]` }),
            ]),
            h('span', { class: 'min-w-0' }, slots.default?.()),
        ]);
    },
};

const MethodTag = {
    props: { method: { type: String, required: true } },
    setup(props) {
        return () => h('span', {
            class: `px-2 py-0.5 rounded-md border text-[10px] font-bold font-mono tracking-wide ${METHOD_CLASS[props.method] || METHOD_CLASS.GET}`,
        }, props.method);
    },
};

const AuthBadge = {
    props: { auth: { type: String, required: true } },
    setup(props) {
        const { t: tr } = useI18n();
        const meta = AUTH_META[props.auth] || AUTH_META.none;
        return () => h('span', {
            class: `inline-block px-2 py-0.5 rounded-md border text-[10px] font-bold align-middle ${meta.cls}`,
        }, tr(meta.key));
    },
};

/**
 * 代码块。
 * 浅色模式必须显式给亮底:base.css 只覆写了 bg-slate-900/800,slate-950 不在其中,
 * 而 text-slate-300 在浅色下会被改写成深灰 —— 深灰字压近黑底等于看不见。
 */
const CodeBlock = {
    props: {
        code: { type: String, required: true },
        label: { type: String, default: '' },
        copiedKey: { type: String, default: '' },
    },
    emits: ['copy'],
    setup(props, { emit }) {
        const { t: tr } = useI18n();
        const copied = () => props.copiedKey === props.code;
        return () => h('div', { class: 'rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden' }, [
            h('div', { class: 'flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-100/80 dark:bg-white/[0.04] border-b border-slate-200 dark:border-white/10' }, [
                h('span', { class: 'text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400' }, props.label),
                h('button', {
                    type: 'button',
                    class: 'text-[10px] font-semibold text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer',
                    title: tr('apiDocs.copy'),
                    onClick: () => emit('copy', props.code),
                }, [
                    h('i', { class: `fas mr-1 ${copied() ? 'fa-check' : 'fa-copy'}` }),
                    copied() ? tr('apiDocs.copied') : tr('apiDocs.copy'),
                ]),
            ]),
            h('div', { class: 'bg-slate-50 dark:bg-slate-950/60 overflow-x-auto' }, [
                h('pre', { class: 'px-3 py-2.5 text-[11px] leading-relaxed font-mono text-slate-700 dark:text-slate-300' }, props.code),
            ]),
        ]);
    },
};

/* --------------------------------- 生命周期 -------------------------------- */
onMounted(() => {
    syncBaseUrl(); // 挂载后 origin 一定可用,再同步一次兜底
    document.addEventListener('click', onClickOutside);

    // 目录高亮:取当前视口顶部附近最后一个进入视野的 section
    observer = new IntersectionObserver((entries) => {
        const visible = entries
            .filter(e => e.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) activeId.value = visible[0].target.id;
    }, { rootMargin: '-96px 0px -65% 0px', threshold: 0 });
    document.querySelectorAll('section[id]').forEach(el => observer.observe(el));
});

onBeforeUnmount(() => {
    document.removeEventListener('click', onClickOutside);
    observer?.disconnect();
    clearTimeout(copyTimer);
});
</script>
