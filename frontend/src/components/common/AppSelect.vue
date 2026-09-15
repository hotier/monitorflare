<template>
  <div class="relative" :class="variant === 'compact' ? 'inline-block' : 'w-full'" ref="rootRef">
    <button
      ref="triggerRef"
      type="button"
      :disabled="disabled"
      :title="currentLabel"
      @click="toggle"
      class="app-select-trigger flex items-center justify-between gap-1.5 cursor-pointer transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
      :class="[sizeClass, colorClass, triggerClass]">
      <span class="truncate">{{ currentLabel }}</span>
      <i class="fas fa-chevron-down text-[8px] shrink-0"></i>
    </button>

    <!-- 浮层挂到 body:避免被弹窗滚动容器裁切 -->
    <Teleport to="body">
      <div v-if="open"
        ref="panelRef"
        :style="panelStyle"
        class="fixed z-[9999] max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl"
        :class="[panelClass, optionClass]">
        <button
          v-for="opt in normalizedOptions"
          :key="opt.value"
          type="button"
          @click="pick(opt)"
          class="w-full flex items-center justify-between gap-3 px-3 py-2 text-left whitespace-nowrap cursor-pointer text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05]"
          :class="{ 'font-bold text-emerald-600 dark:text-emerald-400': opt.value === modelValue }">
          {{ opt.label }}
          <i v-if="showCheck && opt.value === modelValue" class="fas fa-check text-[9px]"></i>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';

/**
 * 通用下拉(与语言切换器同款:触发器 + 圆角浮层列表)
 * variant: field(表单字段) | field-md(中等表单字段) | field-sm(紧凑表单字段) | compact(小胶囊/工具栏)
 * showCheck: 选中项是否显示对钩,默认不显示(语言切换器请自行传 true)
 * mono: 选项值是代码味的东西(HTTP 方法、DNS 记录类型)时再开;可读文案不要开
 * options: [{ value, label }] 或原始值数组
 */
const props = defineProps({
    modelValue:   { type: [String, Number], default: '' },
    options:      { type: Array,  required: true },
    variant:      { type: String, default: 'field' },
    showCheck:    { type: Boolean, default: false },
    mono:         { type: Boolean, default: false },
    align:        { type: String, default: 'left' },
    disabled:     { type: Boolean, default: false },
    triggerClass: { type: String, default: '' },
    panelClass:   { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue', 'change']);

const open = ref(false);
const rootRef = ref(null);
const triggerRef = ref(null);
const panelRef = ref(null);
const panelStyle = ref({});

const SIZE_CLASS = {
    field:        'w-full px-4 py-3 rounded-xl text-sm',
    'field-md':   'w-full px-3 py-2.5 rounded-xl text-sm',
    'field-sm':   'w-full px-3 py-2 rounded-lg text-sm',
    compact:      'h-8 px-2 rounded-lg text-xs font-medium',
};
const COLOR_CLASS = {
    field:        'border border-slate-700 bg-slate-800/80 text-white',
    compact:      'border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-emerald-500/60',
};
// 浮层选项跟触发器同字号同字体:否则展开后同一个值在框里和列表里像两种东西
const OPTION_SIZE_CLASS = {
    field:        'text-sm',
    'field-md':   'text-sm',
    'field-sm':   'text-sm',
    compact:      'text-xs',
};

const sizeClass = computed(() => SIZE_CLASS[props.variant] || SIZE_CLASS.field);
const colorClass = computed(() => (COLOR_CLASS[props.variant] || COLOR_CLASS.field) + (props.mono ? ' font-mono' : ''));
const optionClass = computed(() => (OPTION_SIZE_CLASS[props.variant] || OPTION_SIZE_CLASS.field) + (props.mono ? ' font-mono' : ''));

const normalizedOptions = computed(() => props.options.map((o) => (
    o !== null && typeof o === 'object'
        ? { value: o.value, label: o.label ?? String(o.value) }
        : { value: o, label: String(o) }
)));

const currentLabel = computed(() => normalizedOptions.value.find(o => o.value === props.modelValue)?.label ?? '');

const toggle = () => { if (!props.disabled) open.value = !open.value; };

const pick = (opt) => {
    open.value = false;
    if (opt.value === props.modelValue) return;
    emit('update:modelValue', opt.value);
    emit('change', opt.value);
};

/** 依据触发器位置计算浮层坐标,空间不足时向上翻转 */
const updatePosition = () => {
    const el = triggerRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 6;
    const panelHeight = panelRef.value?.offsetHeight ?? 0;
    const flipUp = rect.bottom + gap + panelHeight > window.innerHeight && rect.top - gap - panelHeight > 0;

    const style = {
        top:       flipUp ? 'auto' : (rect.bottom + gap) + 'px',
        bottom:    flipUp ? (window.innerHeight - rect.top + gap) + 'px' : 'auto',
        left:      props.align === 'right' ? 'auto' : rect.left + 'px',
        right:     props.align === 'right' ? (window.innerWidth - rect.right) + 'px' : 'auto',
        minWidth:  rect.width + 'px',
    };
    panelStyle.value = style;
};

watch(open, async (isOpen) => {
    if (!isOpen) return;
    panelStyle.value = {};                 // 先渲染再测量,避免使用上一次的尺寸
    await nextTick();
    updatePosition();
});

const onClickOutside = (e) => {
    if (!open.value) return;
    if (rootRef.value?.contains(e.target)) return;
    if (panelRef.value?.contains(e.target)) return;
    open.value = false;
};
const onKeydown = (e) => { if (e.key === 'Escape') open.value = false; };

onMounted(() => {
    document.addEventListener('click', onClickOutside);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
});
onBeforeUnmount(() => {
    document.removeEventListener('click', onClickOutside);
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('scroll', updatePosition, true);
    window.removeEventListener('resize', updatePosition);
});
</script>
