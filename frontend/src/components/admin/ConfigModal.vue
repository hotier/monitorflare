<template>
  <transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm admin-modal-overlay" @click="$emit('close')"></div>
      <div class="relative w-full max-w-xl glass admin-modal rounded-2xl shadow-2xl flex flex-col overflow-hidden" style="animation:modal-in 0.25s ease-out; max-height: 85vh">
        <div class="shrink-0 px-8 pt-5 pb-4 flex justify-between items-center">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-purple-500/15 flex items-center justify-center shrink-0"><i class="fas fa-sliders-h text-purple-500 dark:text-purple-400"></i></div>
            <div><h3 class="text-base font-bold text-white">{{ configTarget?.name }}</h3><p class="text-xs text-slate-500 mt-0.5">{{ $t('configModal.editSubtitle') }}</p></div>
          </div>
          <button @click="$emit('close')" class="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"><i class="fas fa-times text-lg"></i></button>
        </div>
        <!-- min-h-0 不能省:flex 子项默认 min-height:auto,不归零的话内容区会被内容
             撑开而不滚动,整个弹窗溢出 85vh,底部按钮被顶出可视区。滚动交给内容区,
             底部按钮就永远钉在底部。
             另外:选项 label 都带 @mousedown.prevent —— 点击 label 时浏览器会把焦点
             交给里面那个隐藏 input,并滚动祖先容器把它"拽进视野",表现就是保存按钮
             跳上来盖住表单。阻止 mousedown 默认行为后鼠标点击不再产生焦点(键盘 Tab
             不受影响),配合 .focus-safe-input 铺满可见 label,聚焦滚动从源头消失。 -->
        <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-6">
          <!-- 基础信息 -->
          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2"><i class="fas fa-edit text-green-500 text-[10px]"></i> {{ $t('configModal.basicInfo') }}</h4>
            <div class="space-y-3">
              <div><label class="block text-xs font-medium text-slate-400 mb-1">{{ $t('configModal.siteName') }}</label><input v-model="configForm.name" class="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-800/80 text-white focus:border-green-500 outline-none"></div>
              <div><label class="block text-xs font-medium text-slate-400 mb-1">{{ $t('configModal.url') }}</label><input v-model="configForm.url" class="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-800/80 text-white focus:border-green-500 outline-none font-mono"></div>
              <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-medium text-slate-400 mb-1">{{ $t('configModal.keyword') }}</label><input v-model="configForm.keyword" :placeholder="$t('configModal.keywordPlaceholder')" class="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-800/80 text-white focus:border-green-500 outline-none"></div>
                <div><label class="block text-xs font-medium text-slate-400 mb-1">{{ $t('monitorForm.userAgent') }}</label><input v-model="configForm.user_agent" placeholder="Uptime-Monitor/1.0" class="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-800/80 text-white focus:border-green-500 outline-none font-mono text-xs"></div>
              </div>
            </div>
          </div>
          <!-- 高级请求设置 -->
          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2"><i class="fas fa-cogs text-blue-500 text-[10px]"></i> {{ $t('configModal.advancedRequest') }}</h4>
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-medium text-slate-400 mb-1">{{ $t('configModal.method') }}</label>
                  <AppSelect v-model="configForm.method" :options="httpMethods" variant="field-sm" mono />
                </div>
                <div><label class="block text-xs font-medium text-slate-400 mb-1">{{ $t('configModal.tags') }}</label><input v-model="configForm.tags" placeholder="prod,web,api" class="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-800/80 text-white focus:border-green-500 outline-none placeholder-slate-600"></div>
              </div>
              <div><label class="block text-xs font-medium text-slate-400 mb-1">{{ $t('configModal.requestHeaders') }}</label><input v-model="configForm.request_headers" placeholder='{"Authorization":"Bearer xxx"}' class="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-800/80 text-white outline-none font-mono placeholder-slate-600 text-xs"></div>
              <div v-if="['POST','PUT','PATCH'].includes(configForm.method)"><label class="block text-xs font-medium text-slate-400 mb-1">{{ $t('configModal.requestBody') }}</label><textarea v-model="configForm.request_body" placeholder='{"key":"value"}' rows="2" class="w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-800/80 text-white outline-none font-mono placeholder-slate-600 resize-none text-xs"></textarea></div>
            </div>
          </div>
          <!-- 功能开关 -->
          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">{{ $t('configModal.detection') }}</h4>
            <div class="space-y-3">
              <label class="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-900/50 cursor-pointer" @mousedown.prevent>
                <div class="flex items-center gap-2 text-sm text-slate-300"><i class="fas fa-lock text-blue-400 w-4"></i><span>{{ $t('configModal.sslCheck') }}</span></div>
                <input type="checkbox" v-model="configForm.check_ssl" class="switch-input">
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
              <label class="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-900/50 cursor-pointer" @mousedown.prevent>
                <div class="flex items-center gap-2 text-sm text-slate-300"><i class="fas fa-globe text-green-400 w-4"></i><span>{{ $t('configModal.domainCheck') }}</span></div>
                <input type="checkbox" v-model="configForm.check_domain" class="switch-input">
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
          </div>
          <!-- 监测频率 -->
          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">{{ $t('configModal.frequency') }}</h4>
            <div class="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              <label v-for="opt in [{value:60,label:$t('monitorForm.minutes',{count:1})},{value:180,label:$t('monitorForm.minutes',{count:3})},{value:300,label:$t('monitorForm.minutes',{count:5})},{value:600,label:$t('monitorForm.minutes',{count:10})},{value:900,label:$t('monitorForm.minutes',{count:15})},{value:1800,label:$t('monitorForm.minutes',{count:30})}]" :key="opt.value"
                class="relative flex flex-col items-center justify-center py-2 rounded-lg border-2 cursor-pointer transition-all text-center" @mousedown.prevent
                :class="Number(configForm.interval) === opt.value ? 'border-green-500 bg-green-900/20 text-green-400' : 'border-slate-700 text-slate-400 hover:border-green-500/40'">
                <input type="radio" :value="opt.value" v-model="configForm.interval" class="focus-safe-input"><span class="text-sm font-bold">{{ opt.label }}</span>
              </label>
            </div>
          </div>
          <!-- 告警静默窗口 -->
          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">{{ $t('configModal.alertFrequency') }}</h4>
            <p class="text-xs text-slate-500 mb-4">{{ $t('configModal.alertHint') }}</p>
            <div class="mb-5 pb-4 border-b border-slate-700/50">
              <div class="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2"><i class="fas fa-exclamation-triangle text-orange-400 w-3"></i><span>{{ $t('configModal.errorRate') }}</span></div>
              <div class="flex items-center justify-between bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                <div class="text-xs text-slate-500 mr-2 flex-1">{{ $t('configModal.errorRateHint') }}</div>
                <div class="flex items-center gap-2 shrink-0">
                  <input type="number" v-model="configForm.alert_error_rate" min="0" max="100" placeholder="0" class="w-16 border border-slate-700 rounded text-center px-1 py-1 text-sm bg-slate-800 text-white focus:border-green-500 outline-none block">
                  <span class="text-slate-400 text-sm">%</span>
                </div>
              </div>
            </div>
            <div class="mb-5 pb-4 border-b border-slate-700/50">
              <div class="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2"><i class="fas fa-gauge-high text-sky-400 w-3"></i><span>{{ $t('configModal.latencyThreshold') }}</span></div>
              <div class="flex items-center justify-between bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                <div class="text-xs text-slate-500 mr-2 flex-1">{{ $t('configModal.latencyHint') }}</div>
                <div class="flex items-center gap-2 shrink-0">
                  <input type="number" v-model.number="configForm.alert_latency_ms" min="0" max="600000" placeholder="0" class="w-20 border border-slate-700 rounded text-center px-1 py-1 text-sm bg-slate-800 text-white focus:border-green-500 outline-none block">
                  <span class="text-slate-400 text-sm">ms</span>
                </div>
              </div>
            </div>
            <div class="space-y-4">
              <div v-for="item in silenceItems" :key="item.key">
                <div class="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2"><i :class="item.icon + ' w-3'"></i><span>{{ item.label }}</span></div>
                <p class="text-xs text-slate-500 mb-2">{{ item.hint }}</p>
                <div class="grid grid-cols-5 gap-1.5">
                  <label v-for="opt in item.options" :key="opt.value"
                    class="relative flex flex-col items-center justify-center py-2 rounded-lg border-2 cursor-pointer transition-all text-center" @mousedown.prevent
                    :class="configForm[item.key] === opt.value ? 'border-green-500 bg-green-900/20 text-green-400' : 'border-slate-700 text-slate-400 hover:border-green-500/40'">
                    <input type="radio" :value="opt.value" v-model="configForm[item.key]" class="focus-safe-input"><span class="text-sm font-bold">{{ opt.label }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <!-- 告警判定口径覆盖(默认跟随站点设置) -->
          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">{{ $t('configModal.ruleOverrides') }}</h4>
            <p class="text-xs text-slate-500 mb-3">{{ $t('configModal.ruleOverridesHint') }}</p>
            <div class="space-y-2">
              <div v-for="item in ruleOverrideItems" :key="item.key" class="flex items-center justify-between gap-3 bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                <div class="min-w-0">
                  <div class="text-sm text-slate-300">{{ item.label }}</div>
                  <div class="text-xs text-slate-500 mt-0.5">{{ $t('configModal.ruleFollowGlobal', { value: item.global }) }}</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <input type="number" :min="item.min" :max="item.max" v-model="configForm[item.key]" :placeholder="String(item.global)" class="w-20 border border-slate-700 rounded text-center px-1 py-1 text-sm bg-slate-800 text-white focus:border-green-500 outline-none block">
                  <span class="text-slate-400 text-xs">{{ item.unit }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="shrink-0 px-6 py-4 border-t border-white/5 bg-slate-900/30">
          <button @click="$emit('save')" :disabled="configSaving" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded-xl transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 text-xs border border-transparent cursor-pointer">
            <i v-if="configSaving" class="fas fa-spinner fa-spin"></i><i v-else class="fas fa-save"></i>
            {{ configSaving ? $t('common.saving') : $t('configModal.save') }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSelect from '../common/AppSelect.vue';

const props = defineProps({
    configTarget: Object,
    configForm: Object,
    configSaving: Boolean,
    /** 站点设置里的全局告警判定口径,用于「留空跟随全局」的占位与说明 */
    globalRules: { type: Object, default: () => ({}) },
});
defineEmits(['close', 'save']);

const { t } = useI18n();
const httpMethods = ['GET', 'POST', 'HEAD', 'PUT'].map(v => ({ value: v, label: v }));
// 可用性告警:静默窗口,单位是小时
const silenceOptions = [{ value: 1, label: '1h' }, { value: 4, label: '4h' }, { value: 12, label: '12h' }, { value: 24, label: '24h' }, { value: 72, label: '72h' }];
// 证书/域名到期:提前提醒,单位是天(字段名 alert_silence_* 是历史遗留,后端按天使用)
const expiryOptions = [{ value: 3, label: '3d' }, { value: 7, label: '7d' }, { value: 14, label: '14d' }, { value: 24, label: '24d' }, { value: 60, label: '60d' }];
const silenceItems = [
    {
        key: 'alert_silence_uptime', label: t('configModal.alertUptime'), icon: 'fas fa-heartbeat text-red-400',
        options: silenceOptions, hint: t('configModal.alertUptimeHint'),
    },
    {
        key: 'alert_silence_ssl', label: t('configModal.alertSsl'), icon: 'fas fa-lock text-blue-400',
        options: expiryOptions, hint: t('configModal.alertSslHint'),
    },
    {
        key: 'alert_silence_domain', label: t('configModal.alertDomain'), icon: 'fas fa-globe text-green-400',
        options: expiryOptions, hint: t('configModal.alertDomainHint'),
    },
];

// 判定口径覆盖:与站点设置「告警规则」里的四项一一对应,留空即跟随全局
const ruleOverrideItems = computed(() => {
    const g = props.globalRules || {};
    return [
        {
            key: 'alert_error_rate_window', label: t('settings.errorRateWindow'), min: 1, max: 1440,
            unit: t('configModal.unitMinutes'), global: Number(g.errorRateWindowMin) || 5,
        },
        {
            key: 'alert_error_rate_min_samples', label: t('settings.errorRateMinSamples'), min: 1, max: 1000,
            unit: t('configModal.unitSamples'), global: Number(g.errorRateMinSamples) || 5,
        },
        {
            key: 'alert_error_rate_silence', label: t('settings.errorRateSilence'), min: 1, max: 10080,
            unit: t('configModal.unitMinutes'), global: Number(g.errorRateSilenceMin) || 60,
        },
        {
            key: 'alert_latency_silence', label: t('settings.latencySilence'), min: 1, max: 10080,
            unit: t('configModal.unitMinutes'), global: Number(g.latencySilenceMin) || 60,
        },
    ];
});
</script>
