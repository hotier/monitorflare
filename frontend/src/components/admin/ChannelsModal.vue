<template>
  <transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" enter-to-class="opacity-100">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm admin-modal-overlay" @click="$emit('close')"></div>
      <div class="relative w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col glass admin-modal rounded-2xl shadow-2xl" style="animation:modal-in 0.25s ease-out">
        <div class="px-5 sm:px-6 pt-5 pb-4">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-xl bg-green-500/15 flex items-center justify-center shrink-0">
                <i class="fas fa-bell text-green-500 dark:text-green-400"></i>
              </div>
              <div class="min-w-0">
                <h3 class="text-base font-bold text-white">{{ $t('channels.title') }}</h3>
                <p class="text-xs text-slate-500 mt-0.5">{{ $t('channels.subtitle') }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2 sm:justify-end">
              <div class="hidden sm:inline-flex items-center gap-2 h-[34px] rounded-xl border border-slate-700 bg-slate-900/30 px-3 text-xs">
                <span class="text-slate-500">{{ $t('common.enabled') }}</span>
                <span class="font-mono font-bold text-green-400">{{ enabledCount }}</span>
                <span class="text-slate-600">/</span>
                <span class="font-mono text-slate-400">{{ channels.length }}</span>
              </div>
              <button @click="startCreate()" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-transparent bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 transition-colors cursor-pointer">
                <i class="fas fa-plus text-xs"></i> {{ $t('channels.addChannel') }}
              </button>
              <button @click="$emit('close')" class="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 transition-colors cursor-pointer" :aria-label="$t('common.close')">
                <i class="fas fa-times text-lg"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden p-5 sm:p-6 lg:p-0">
          <!-- 左右两栏各自独立滚动:宽屏时列表与表单互不牵连 -->
          <div class="grid gap-5 lg:gap-0 lg:grid-cols-12 lg:h-full lg:grid-rows-[minmax(0,1fr)]">
            <!-- 左:渠道列表 -->
            <section class="lg:col-span-4 space-y-3 lg:min-h-0 lg:overflow-y-auto lg:p-5 lg:border-r lg:border-slate-700/60">
              <div v-if="channelError" class="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 flex items-center gap-3">
                <i class="fas fa-exclamation-circle text-orange-400 shrink-0 text-xs"></i>
                <p class="text-xs text-orange-300 flex-1">{{ channelError }}</p>
                <button @click="fetchChannels" class="inline-flex h-8 shrink-0 items-center rounded-lg border border-orange-500/30 px-2.5 text-[11px] font-semibold text-orange-300 hover:bg-orange-500/10 cursor-pointer">{{ $t('common.retry') }}</button>
              </div>

              <div v-if="channelsLoading && channels.length === 0" class="space-y-3">
                <div v-for="i in 3" :key="i" class="h-24 rounded-xl bg-slate-800/50 animate-pulse"></div>
              </div>

              <div v-else-if="channels.length === 0" class="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 px-6 py-10 text-center">
                <div class="mx-auto mb-4 w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center">
                  <i class="fas fa-bell-slash text-slate-500"></i>
                </div>
                <h4 class="text-base font-bold text-white">{{ $t('channels.noChannelsTitle') }}</h4>
                <p class="text-sm text-slate-500 mt-1 mb-5">{{ $t('channels.noChannelsDesc') }}</p>
                <button @click="startCreate()" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-transparent bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 transition-colors cursor-pointer">
                  <i class="fas fa-plus text-xs"></i> {{ $t('channels.addFirstChannel') }}
                </button>
              </div>

              <div v-else class="space-y-3">
                <article v-for="ch in channels" :key="ch.id"
                  class="rounded-xl border px-3 py-3 transition-all"
                  :class="editing?.id === ch.id ? 'border-green-500/50 bg-green-500/10 shadow-lg shadow-green-500/5' : 'border-slate-700 bg-slate-900/35 hover:border-slate-600 hover:bg-slate-900/55'">
                  <button type="button" class="w-full flex items-start gap-3 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
                    :class="editing?.id === ch.id ? 'cursor-default' : 'cursor-pointer'"
                    @click="selectChannel(ch)" :aria-label="$t('channels.editAria', { name: ch.name })">
                    <span class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" :class="getTypeInfo(ch.type).bg">
                      <i :class="getTypeInfo(ch.type).iconClass"></i>
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="flex flex-wrap items-center gap-1.5">
                        <span class="text-sm font-bold text-white truncate">{{ ch.name }}</span>
                        <span class="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">{{ getTypeInfo(ch.type).label }}</span>
                        <span v-if="isEnabled(ch)" class="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-400">
                          <span class="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                          {{ $t('common.enabled') }}
                        </span>
                        <span v-else class="inline-flex items-center gap-1 rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                          <span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                          {{ $t('common.disabled') }}
                        </span>
                      </span>
                      <span class="mt-1 block text-xs text-slate-500">{{ getTypeInfo(ch.type).desc }}</span>
                      <span v-if="versionName(ch)" class="mt-0.5 block text-[11px] text-slate-600">{{ $t('channels.templateVersion') }}: <span class="text-slate-400">{{ versionName(ch) }}</span></span>
                    </span>
                  </button>

                  <div class="mt-3 flex items-center gap-1.5">
                    <button @click.stop="toggleCh(ch)" :disabled="togglingId === ch.id"
                      class="relative w-11 h-6 shrink-0 rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 disabled:opacity-60"
                      :class="isEnabled(ch) ? 'bg-green-600' : 'bg-slate-700'"
                      role="switch" :aria-checked="isEnabled(ch)" :aria-label="isEnabled(ch) ? $t('channels.disableAria', { name: ch.name }) : $t('channels.enableAria', { name: ch.name })" :title="isEnabled(ch) ? $t('channels.disableTitle') : $t('channels.enableTitle')">
                      <span class="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all" :class="isEnabled(ch) ? 'left-6' : 'left-1'"></span>
                    </button>
                    <button @click.stop="testCh(ch)" :disabled="testingId === ch.id" class="ml-auto inline-flex h-8 items-center gap-1 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 text-[11px] font-semibold text-green-400 hover:bg-green-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 disabled:opacity-60 transition-colors cursor-pointer" :aria-label="$t('channels.testAria', { name: ch.name })">
                      <i class="fas text-[10px]" :class="testingId === ch.id ? 'fa-spinner fa-spin' : 'fa-paper-plane'"></i>
                      {{ $t('channels.test') }}
                    </button>
                    <button v-if="selectedChannel?.id !== ch.id" @click.stop="editCh(ch)" class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-blue-400/80 hover:text-blue-300 hover:border-blue-500/40 hover:bg-blue-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition-colors cursor-pointer" :aria-label="$t('channels.editAria', { name: ch.name })" :title="$t('common.edit')">
                      <i class="fas fa-pen text-[11px]"></i>
                    </button>
                    <button @click.stop="deleteCh(ch)" :disabled="deletingId === ch.id" class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/20 text-red-400/80 hover:text-red-300 hover:border-red-500/40 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50 transition-colors cursor-pointer" :aria-label="$t('channels.deleteAria', { name: ch.name })" :title="$t('common.delete')">
                      <i class="fas text-[11px]" :class="deletingId === ch.id ? 'fa-spinner fa-spin' : 'fa-trash'"></i>
                    </button>
                  </div>
                </article>
              </div>
            </section>

            <!-- 右:编辑区(窄屏时把表单提到列表上方,免得点完「添加」还要往下找) -->
            <section class="lg:col-span-8 lg:min-h-0 lg:overflow-y-auto lg:p-5" :class="editing ? 'order-first lg:order-none' : ''">
              <div v-if="!editing" class="rounded-2xl border border-slate-700 bg-slate-900/30 p-5">
                <div class="flex items-center gap-3">
                  <span class="w-9 h-9 rounded-xl bg-green-500/15 flex items-center justify-center shrink-0">
                    <i class="fas fa-route text-green-500 dark:text-green-400"></i>
                  </span>
                  <h4 class="text-sm font-bold text-white">{{ $t('channels.selectOrAdd') }}</h4>
                </div>
                <div class="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2 text-left">
                  <button v-for="item in channelTypeOptions" :key="item.key" @click="startCreate(item.key)"
                    class="rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-3 text-left hover:border-green-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 transition-colors cursor-pointer">
                    <i :class="item.iconClass"></i>
                    <span class="block text-xs font-semibold text-slate-300 mt-2">{{ item.label }}</span>
                  </button>
                </div>
              </div>

              <div v-else class="rounded-2xl border border-slate-700 bg-slate-900/30 overflow-hidden">
                <div class="px-5 py-4 border-b border-slate-700/70 bg-slate-900/35">
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                      <div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" :class="currentEditingInfo.bg">
                        <i :class="currentEditingInfo.iconClass"></i>
                      </div>
                      <div class="min-w-0">
                        <h4 class="text-sm font-bold text-white">{{ editing.id ? $t('channels.editChannel') : $t('channels.addChannel') }}</h4>
                        <p class="text-xs text-slate-500 mt-0.5">{{ $t('channels.configFor', { type: currentEditingInfo.label }) }}</p>
                      </div>
                    </div>
                    <button @click="editing = null" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 transition-colors cursor-pointer" :title="$t('channels.collapseForm')" :aria-label="$t('channels.collapseForm')">
                      <i class="fas fa-times text-xs"></i>
                    </button>
                  </div>
                </div>

                <div class="p-5 space-y-5">
                  <div v-if="!editing.id">
                    <label :class="LABEL_CLASS">{{ $t('channels.channelType') }}</label>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <button v-for="item in channelTypeOptions" :key="item.key" @click="selectType(item.key)"
                        class="rounded-xl border px-3 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 cursor-pointer"
                        :class="editing.type === item.key ? 'border-green-500 bg-green-900/20' : 'border-slate-700 bg-slate-900/40 hover:border-green-500/40'">
                        <i :class="item.iconClass"></i>
                        <span class="mt-2 flex items-baseline gap-1.5 text-xs font-semibold" :class="editing.type === item.key ? 'text-green-400' : 'text-slate-300'">
                          {{ item.label }}
                          <span v-if="item.badge" class="text-[10px] font-normal text-slate-500">{{ item.badge }}</span>
                        </span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label :class="LABEL_CLASS">{{ $t('channels.channelName') }} <span class="text-red-400">*</span></label>
                    <input v-model="editing.name" :placeholder="$t('channels.channelNamePlaceholder')" :class="FIELD_CLASS">
                  </div>

                  <template v-if="editing.type === 'dingtalk'">
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.accessToken') }}</label>
                      <input v-model="editing.config.access_token" :placeholder="editing.id ? $t('channels.keepSecretPlaceholder') : $t('channels.accessTokenPlaceholder')" :class="FIELD_MONO_CLASS">
                    </div>
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.secret') }} <span class="text-slate-600">{{ $t('common.optional') }}</span></label>
                      <input v-model="editing.config.secret" :placeholder="editing.id ? $t('channels.keepSecretPlaceholder') : $t('channels.secretPlaceholder')" type="password" :class="FIELD_MONO_CLASS">
                    </div>
                  </template>

                  <template v-if="editing.type === 'wecom'">
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.webhookKey') }}</label>
                      <input v-model="editing.config.key" :placeholder="editing.id ? $t('channels.keepSecretPlaceholder') : $t('channels.webhookKeyPlaceholder')" :class="FIELD_MONO_CLASS">
                    </div>
                  </template>

                  <template v-if="editing.type === 'feishu'">
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.webhookUrl') }}</label>
                      <input v-model="editing.config.webhook_url" type="url" placeholder="https://open.feishu.cn/..." :class="FIELD_MONO_CLASS">
                    </div>
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.secret') }} <span class="text-slate-600">{{ $t('common.optional') }}</span></label>
                      <input v-model="editing.config.secret" type="password" :class="FIELD_MONO_CLASS">
                    </div>
                  </template>

                  <template v-if="editing.type === 'telegram'">
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.botToken') }}</label>
                      <input v-model="editing.config.bot_token" type="password" :class="FIELD_MONO_CLASS">
                    </div>
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.chatId') }}</label>
                      <input v-model="editing.config.chat_id" :class="FIELD_MONO_CLASS">
                    </div>
                  </template>

                  <template v-if="editing.type === 'webhook'">
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.webhookUrl') }}</label>
                      <input v-model="editing.config.url" type="url" placeholder="https://your-server.com/webhook" :class="FIELD_MONO_CLASS">
                    </div>
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.method') }}</label>
                      <AppSelect v-model="editing.config.method" :options="webhookMethods" variant="field-md" mono />
                    </div>
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.headers') }}</label>
                      <input v-model="editing.config.headers" placeholder='{"Authorization":"Bearer xxx"}' :class="FIELD_MONO_CLASS">
                    </div>
                  </template>

                  <template v-if="editing.type === 'email'">
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.emailProvider') }}</label>
                      <AppSelect v-model="editing.config.provider" :options="emailProviders" variant="field-md" />
                    </div>
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.apiKey') }}</label>
                      <input v-model="editing.config.api_key" type="password" :placeholder="editing.id ? $t('channels.keepSecretPlaceholder') : ''" :class="FIELD_MONO_CLASS">
                    </div>
                    <div v-if="editing.config.provider === 'mailgun'">
                      <label :class="LABEL_CLASS">{{ $t('channels.domain') }}</label>
                      <input v-model="editing.config.domain" placeholder="mg.example.com" :class="FIELD_MONO_CLASS">
                    </div>
                    <template v-if="editing.config.provider === 'ses'">
                      <div>
                        <label :class="LABEL_CLASS">{{ $t('channels.secretKey') }}</label>
                        <input v-model="editing.config.api_secret" type="password" :placeholder="editing.id ? $t('channels.keepSecretPlaceholder') : ''" :class="FIELD_MONO_CLASS">
                      </div>
                      <div>
                        <label :class="LABEL_CLASS">{{ $t('channels.region') }}</label>
                        <input v-model="editing.config.region" placeholder="us-east-1" :class="FIELD_MONO_CLASS">
                      </div>
                    </template>
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.fromEmail') }}</label>
                      <input v-model="editing.config.from_email" placeholder="Uptime Monitor <notify@yourdomain.com>" :class="FIELD_MONO_CLASS">
                    </div>
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.toEmail') }}</label>
                      <input v-model="editing.config.to_email" type="email" placeholder="admin@example.com" :class="FIELD_MONO_CLASS">
                    </div>
                  </template>

                  <template v-if="editing.type === 'slack'">
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.webhookUrl') }}</label>
                      <input v-model="editing.config.webhook_url" type="url" placeholder="https://hooks.slack.com/services/..." :class="FIELD_MONO_CLASS">
                    </div>
                  </template>

                  <template v-if="editing.type === 'discord'">
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.webhookUrl') }}</label>
                      <input v-model="editing.config.webhook_url" type="url" placeholder="https://discord.com/api/webhooks/..." :class="FIELD_MONO_CLASS">
                    </div>
                  </template>

                  <template v-if="editing.type === 'ntfy'">
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.server') }}</label>
                      <input v-model="editing.config.server" placeholder="https://ntfy.sh" :class="FIELD_MONO_CLASS">
                    </div>
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.topic') }}</label>
                      <input v-model="editing.config.topic" placeholder="uptime-alerts" :class="FIELD_MONO_CLASS">
                    </div>
                    <div>
                      <label :class="LABEL_CLASS">{{ $t('channels.accessToken') }} <span class="text-slate-600">{{ $t('common.optional') }}</span></label>
                      <input v-model="editing.config.token" type="password" :class="FIELD_MONO_CLASS">
                    </div>
                  </template>

                  <!-- 用哪份告警文案:文案本身在「告警模板」里维护,渠道只挑一个模板 -->
                  <div>
                    <label :class="LABEL_CLASS">{{ $t('channels.templateVersion') }}</label>
                    <AppSelect v-model="editing.template_version_id" :options="templateVersionOptions" variant="field-md" />
                    <p class="text-xs text-slate-500 mt-2">{{ $t('channels.templateVersionHint') }}</p>
                  </div>
                </div>

                <div class="px-5 py-4 border-t border-slate-700/70 bg-slate-900/35 flex flex-col sm:flex-row gap-2 sm:justify-end">
                  <button @click="editing = null" class="inline-flex items-center justify-center rounded-xl border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 transition-colors cursor-pointer">
                    {{ $t('common.cancel') }}
                  </button>
                  <button @click="saveCh" :disabled="saving" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-transparent bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 transition-colors disabled:opacity-50 cursor-pointer">
                    <i class="fas text-xs" :class="saving ? 'fa-spinner fa-spin' : 'fa-save'"></i>
                    {{ saving ? $t('common.saving') : (editing.id ? $t('channels.saveChanges') : $t('channels.addChannel')) }}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { API_BASE, authFetchT } from '../../utils/api';
import * as resources from '../../composables/resources';
import AppSelect from '../common/AppSelect.vue';

const { t } = useI18n();
defineEmits(['close']);
const { addToast } = useToast();
const { confirmDialog } = useConfirm();

// 表单里所有输入框/下拉共用一套尺寸,避免同类控件高低不一
const LABEL_CLASS = 'mb-2 block text-sm font-medium text-slate-300';
const FIELD_CLASS = 'input-field w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2.5 text-sm text-white outline-none placeholder-slate-600';
const FIELD_MONO_CLASS = `${FIELD_CLASS} font-mono`;

// 渠道数据来自模块级资源:弹窗关了再开直接渲染缓存,不再每次重新拉
const channels = computed(() => resources.notificationChannels.data.value || []);
const channelsLoading = computed(() => resources.notificationChannels.loading.value);
const channelError = computed(() => (resources.notificationChannels.error.value ? t('channels.loadFailed') : ''));
const editing = ref(null);
const templateVersions = ref([]);
const saving = ref(false);
const testingId = ref(null);
const togglingId = ref(null);
const deletingId = ref(null);

const webhookMethods = ['POST', 'PUT', 'PATCH'].map(v => ({ value: v, label: v }));

const emailProviders = [
    { value: 'resend', label: 'Resend' },
    { value: 'sendgrid', label: 'SendGrid' },
    { value: 'mailgun', label: 'Mailgun' },
    { value: 'postmark', label: 'Postmark' },
    { value: 'ses', label: 'AWS SES' },
];

const typeInfo = computed(() => ({
    wecom: { iconClass: 'fab fa-weixin text-green-400 text-lg', label: t('channelTypes.wecom'), desc: t('channelTypes.wecomDesc'), bg: 'bg-green-900/40' },
    feishu: { iconClass: 'fas fa-paper-plane text-purple-400 text-lg', label: t('channelTypes.feishu'), desc: t('channelTypes.feishuDesc'), bg: 'bg-purple-900/40' },
    dingtalk: { iconClass: 'fas fa-comment-dots text-blue-400 text-lg', label: t('channelTypes.dingtalk'), desc: t('channelTypes.dingtalkDesc'), bg: 'bg-blue-900/40' },
    webhook: { iconClass: 'fas fa-link text-orange-400 text-lg', label: t('channelTypes.webhook'), desc: t('channelTypes.webhookDesc'), bg: 'bg-orange-900/40' },
    telegram: { iconClass: 'fab fa-telegram text-sky-400 text-lg', label: t('channelTypes.telegram'), desc: t('channelTypes.telegramDesc'), badge: t('channelTypes.overseas'), bg: 'bg-sky-900/40' },
    email: { iconClass: 'fas fa-envelope text-rose-400 text-lg', label: t('channelTypes.email'), desc: t('channelTypes.emailDesc'), badge: t('channelTypes.overseas'), bg: 'bg-rose-900/40' },
    slack: { iconClass: 'fab fa-slack text-fuchsia-400 text-lg', label: t('channelTypes.slack'), desc: t('channelTypes.slackDesc'), badge: t('channelTypes.overseas'), bg: 'bg-fuchsia-900/40' },
    discord: { iconClass: 'fab fa-discord text-indigo-400 text-lg', label: t('channelTypes.discord'), desc: t('channelTypes.discordDesc'), badge: t('channelTypes.overseas'), bg: 'bg-indigo-900/40' },
    ntfy: { iconClass: 'fas fa-bullhorn text-lime-400 text-lg', label: t('channelTypes.ntfy'), desc: t('channelTypes.ntfyDesc'), badge: t('channelTypes.overseas'), bg: 'bg-lime-900/40' },
}));

const fallbackTypeInfo = () => ({ iconClass: 'fas fa-bell text-slate-400 text-lg', label: t('channels.unknownChannel'), desc: t('channels.customChannel'), bg: 'bg-slate-700' });
const channelTypeOptions = computed(() => Object.entries(typeInfo.value).map(([key, info]) => ({ key, ...info })));
const enabledCount = computed(() => channels.value.filter(ch => isEnabled(ch)).length);
const currentEditingInfo = computed(() => editing.value ? getTypeInfo(editing.value.type) : fallbackTypeInfo());
const templateVersionOptions = computed(() => [
    { value: '', label: t('channels.followDefault') },
    ...templateVersions.value.map(v => ({ value: v.id, label: v.is_default ? `${v.name} · ${t('alertTemplates.defaultTag')}` : v.name })),
]);

const getTypeInfo = (type) => typeInfo.value[type] || { ...fallbackTypeInfo(), label: type || t('channels.unknownChannel') };
const isEnabled = (ch) => ch.enabled === true || Number(ch.enabled) === 1;

/** 正在编辑的已有渠道;新建时没有,列表照常全量展示 */
const selectedChannel = computed(() => {
    const id = editing.value?.id;
    return id ? channels.value.find(ch => ch.id === id) || null : null;
});

const selectChannel = (ch) => {
    // 已经在编辑它了:再点一次会把填了一半的表单重置掉,直接忽略
    if (editing.value?.id === ch.id) return;
    editCh(ch);
};

/** 手动刷新(出错重试、保存后同步)。打开弹窗时走 loadChannels,不强制请求 */
const fetchChannels = () => resources.notificationChannels.refresh();
const loadChannels = () => resources.notificationChannels.ensure();

const baseConfig = (type) => {
    if (type === 'webhook') return { method: 'POST' };
    if (type === 'email') return { provider: 'resend' };
    return {};
};

const startCreate = (type = 'wecom') => {
    editing.value = { type, name: '', config: baseConfig(type), template_version_id: '' };
};

const selectType = (type) => {
    if (!editing.value || editing.value.id) return;
    editing.value = { type, name: editing.value.name, config: baseConfig(type), template_version_id: editing.value.template_version_id };
};

/** 渠道列表上显示"用的哪份文案":没绑定就是跟随默认模板 */
const versionName = (ch) => {
    const id = Number(ch.template_version_id) || 0;
    return templateVersions.value.find(v => v.id === id)?.name || '';
};

// 各渠道类型必填的配置字段(仅新建时强制,编辑时留空表示保留原密钥)
const REQUIRED_CONFIG = {
    dingtalk: ['access_token'],
    wecom: ['key'],
    feishu: ['webhook_url'],
    telegram: ['bot_token', 'chat_id'],
    webhook: ['url'],
    email: ['api_key', 'from_email', 'to_email'],
    slack: ['webhook_url'],
    discord: ['webhook_url'],
    ntfy: ['server', 'topic'],
};

const saveCh = async () => {
    const ch = editing.value;
    if (!ch.name || !ch.type) { addToast(t('channels.fillName'), 'error'); return; }
    const missing = (REQUIRED_CONFIG[ch.type] || []).filter(k => !(ch.config?.[k] || '').trim());
    if (!ch.id && missing.length) { addToast(t('channels.fillConfig'), 'error'); return; }
    saving.value = true;
    try {
        const url = ch.id ? `${API_BASE}/notification-channels/${ch.id}` : `${API_BASE}/notification-channels`;
        // '' 表示跟随默认模板,否则带上具体模板 id
        const versionId = Number(ch.template_version_id) > 0 ? Number(ch.template_version_id) : null;
        const body = ch.id
            ? { type: ch.type, name: ch.name, config: ch.config, template_version_id: versionId }
            : { type: ch.type, name: ch.name, config: ch.config, enabled: 1, template_version_id: versionId };
        const res = await authFetchT(url, { method: ch.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) {
            addToast(ch.id ? t('channels.updated') : t('channels.added'), 'success');
            editing.value = null;
            await fetchChannels();
        } else {
            const d = await res.json();
            addToast(d.error || t('channels.operationFailed'), 'error');
        }
    } catch {
        addToast(t('common.networkError'), 'error');
    } finally {
        saving.value = false;
    }
};

const editCh = (ch) => {
    let parsedConfig = {};
    try { parsedConfig = typeof ch.config === 'string' ? JSON.parse(ch.config) : (ch.config || {}); } catch {}
    const secretKeys = ['secret', 'token', 'access_token', 'bot_token', 'key', 'api_key'];
    const cleanConfig = {};
    for (const [k, v] of Object.entries(parsedConfig)) {
        const isSecret = secretKeys.some(s => k.toLowerCase().includes(s));
        cleanConfig[k] = (isSecret || (typeof v === 'string' && v.includes('****'))) ? '' : v;
    }
    if (ch.type === 'email' && !cleanConfig.provider) cleanConfig.provider = 'resend';
    // 模板 id 统一成数字,否则下拉里可能匹配不上而显示空白
    const versionId = ch.template_version_id ? Number(ch.template_version_id) : '';
    editing.value = { id: ch.id, type: ch.type, name: ch.name, config: cleanConfig, template_version_id: versionId };
};

const deleteCh = async (ch) => {
    const ok = await confirmDialog(t('channels.deleteConfirm', { name: ch.name }));
    if (!ok) return;
    deletingId.value = ch.id;
    try {
        const res = await authFetchT(`${API_BASE}/notification-channels/${ch.id}`, { method: 'DELETE' });
        if (res.ok) {
            addToast(t('channels.deleted'), 'success');
            if (editing.value?.id === ch.id) editing.value = null;
            await fetchChannels();
        } else {
            addToast(t('channels.deleteFailed'), 'error');
        }
    } catch {
        addToast(t('channels.deleteFailed'), 'error');
    } finally {
        deletingId.value = null;
    }
};

const toggleCh = async (ch) => {
    togglingId.value = ch.id;
    try {
        const enabled = isEnabled(ch) ? 0 : 1;
        const res = await authFetchT(`${API_BASE}/notification-channels/${ch.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
        if (res.ok) ch.enabled = enabled;
        else addToast(t('channels.operationFailed'), 'error');
    } catch {
        addToast(t('channels.operationFailed'), 'error');
    } finally {
        togglingId.value = null;
    }
};

const testCh = async (ch) => {
    testingId.value = ch.id;
    addToast(t('channels.testing'), 'info');
    try {
        const res = await authFetchT(`${API_BASE}/notification-channels/${ch.id}?action=test`, { method: 'POST' });
        const d = await res.json();
        addToast(d.success ? t('channels.testSent') : t('channels.testFailed'), d.success ? 'success' : 'error');
    } catch {
        addToast(t('channels.testFailed'), 'error');
    } finally {
        testingId.value = null;
    }
};

/** 模板列表只用来做下拉和卡片上的"用哪份文案"展示,拉不到也不该挡住渠道配置 */
const loadTemplateVersions = async () => {
    try {
        const res = await authFetchT(`${API_BASE}/alert-templates`);
        if (res.ok) {
            const d = await res.json();
            templateVersions.value = d.versions || [];
        }
    } catch { /* 忽略:渠道本身的配置不依赖它 */ }
};

// ensure 而非 refresh:资源里有缓存就直接渲染,只有首次或超过 ttl 才真的请求
loadChannels();
loadTemplateVersions();
</script>
