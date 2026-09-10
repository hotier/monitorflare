<template>
  <div ref="rootRef" class="app-dtp-root">
    <!-- 单日期输入 -->
    <div
      v-if="!range"
      class="app-dtp-trigger"
      :class="{ 'is-disabled': disabled, 'is-open': open }"
      @click="onTriggerClick"
    >
      <span v-if="displayValue" class="app-dtp-value">{{ displayValue }}</span>
      <span v-else class="app-dtp-ph">{{ placeholder }}</span>
      <button
        v-if="displayValue && !disabled"
        type="button"
        class="app-dtp-clear"
        :aria-label="t('common.clear')"
        @click.stop="clear"
      >
        <i class="fas fa-xmark"></i>
      </button>
      <i v-else class="fas fa-calendar app-dtp-icon"></i>
    </div>

    <!-- 范围输入 -->
    <div
      v-else
      class="app-dtp-trigger is-range"
      :class="{ 'is-disabled': disabled, 'is-open': open }"
      @click="onTriggerClick"
    >
      <span class="app-dtp-half" :class="{ 'app-dtp-ph': !startDisplay }">
        {{ startDisplay || t('dateTimePicker.startPlaceholder') }}
      </span>
      <span class="app-dtp-arrow"><i class="fas fa-arrow-right"></i></span>
      <span class="app-dtp-half" :class="{ 'app-dtp-ph': !endDisplay }">
        {{ endDisplay || t('dateTimePicker.endPlaceholder') }}
      </span>
      <button
        v-if="(rangeStart || rangeEnd) && !disabled"
        type="button"
        class="app-dtp-clear"
        :aria-label="t('common.clear')"
        @click.stop="clear"
      >
        <i class="fas fa-xmark"></i>
      </button>
      <i v-else class="fas fa-calendar app-dtp-icon"></i>
    </div>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        class="app-dtp-panel"
        :class="{ 'is-dark': isDark }"
        :style="panelStyle"
        @click.stop
      >
        <div class="app-dtp-body">
          <!-- 左:日历 -->
          <div class="app-dtp-calendar">
            <div class="app-dtp-cal-head">
              <button type="button" class="app-dtp-nav" @click="step(-1)">
                <i class="fas fa-chevron-left"></i>
              </button>
              <button type="button" class="app-dtp-title" @click="toggleView">
                {{ headerLabel }}
                <i class="fas fa-chevron-down app-dtp-title-caret"></i>
              </button>
              <button type="button" class="app-dtp-nav" @click="step(1)">
                <i class="fas fa-chevron-right"></i>
              </button>
            </div>

            <div v-if="viewMode === 'day'">
              <div class="app-dtp-weekdays">
                <span v-for="w in weekdays" :key="w">{{ w }}</span>
              </div>
              <div class="app-dtp-days">
                <button
                  v-for="cell in dayCells"
                  :key="cell.key"
                  type="button"
                  class="app-dtp-day"
                  :class="dayClass(cell)"
                  @mouseenter="hoverDate = cell.date"
                  @mouseleave="hoverDate = null"
                  @click="pickDay(cell)"
                >
                  {{ cell.date.date() }}
                </button>
              </div>
            </div>

            <div v-else class="app-dtp-months">
              <button
                v-for="m in monthCells"
                :key="m.value"
                type="button"
                class="app-dtp-month"
                :class="{ 'is-active': m.value === viewMonth.month() }"
                @click="pickMonth(m)"
              >
                {{ m.label }}
              </button>
            </div>
          </div>

          <!-- 右:时间 -->
          <div class="app-dtp-time">
            <div class="app-dtp-time-head">
              <template v-if="range">
                <button
                  type="button"
                  class="app-dtp-time-tab"
                  :class="{ 'is-active': activeEnd === 'start' }"
                  @click="activeEnd = 'start'"
                >
                  {{ t('dateTimePicker.startPlaceholder') }}
                </button>
                <button
                  type="button"
                  class="app-dtp-time-tab"
                  :class="{ 'is-active': activeEnd === 'end' }"
                  @click="activeEnd = 'end'"
                >
                  {{ t('dateTimePicker.endPlaceholder') }}
                </button>
              </template>
              <span v-else class="app-dtp-time-tab is-active">{{ t('dateTimePicker.time') }}</span>
            </div>

            <div class="app-dtp-time-cols">
              <div ref="hourListRef" class="app-dtp-time-col">
                <button
                  v-for="h in 24"
                  :key="h - 1"
                  type="button"
                  class="app-dtp-time-cell"
                  :class="{ 'is-active': currentHour === h - 1 }"
                  @click="pickHour(h - 1)"
                >
                  {{ pad(h - 1) }}
                </button>
              </div>
              <div ref="minuteListRef" class="app-dtp-time-col">
                <button
                  v-for="m in 60"
                  :key="m - 1"
                  type="button"
                  class="app-dtp-time-cell"
                  :class="{ 'is-active': currentMinute === m - 1 }"
                  @click="pickMinute(m - 1)"
                >
                  {{ pad(m - 1) }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="app-dtp-foot">
          <button type="button" class="app-dtp-link" @click="today">
            {{ t('dateTimePicker.today') }}
          </button>
          <button type="button" class="app-dtp-link" @click="now">
            {{ t('dateTimePicker.now') }}
          </button>
          <span class="app-dtp-preview">{{ previewText }}</span>
          <button type="button" class="app-dtp-confirm" @click="confirm">
            {{ t('dateTimePicker.ok') }}
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import dayjs from 'dayjs';

/**
 * 日期时间选择器(自定义实现,支持单日期与日期时间范围)
 * 布局:左侧日历,右侧时间(时/分),底部操作栏
 * v-model:
 *   - 单选:字符串 `YYYY-MM-DDTHH:mm`
 *   - 范围(range=true):数组 `[开始, 结束]`,元素格式同上;未完成时为 ['', '']
 */
const props = defineProps({
    modelValue:  { type: [String, Array], default: '' },
    placeholder: { type: String,  default: '' },
    disabled:    { type: Boolean, default: false },
    range:       { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'change']);

const { t, locale } = useI18n();

const isZh = computed(() => String(locale.value).toLowerCase().startsWith('zh'));
const placeholder = computed(() => props.placeholder || t('dateTimePicker.placeholder'));

/* ---------------------------------- 状态 ---------------------------------- */
const rootRef = ref(null);
const panelRef = ref(null);
const hourListRef = ref(null);
const minuteListRef = ref(null);

const open = ref(false);
const panelStyle = ref({});
const viewMode = ref('day');
const viewMonth = ref(dayjs().startOf('month'));

const selected = ref(null);      // dayjs | null (单选)
const rangeStart = ref(null);    // dayjs | null (范围开始)
const rangeEnd = ref(null);      // dayjs | null (范围结束)
const activeEnd = ref('start');  // 范围模式下当前编辑的一端

const hoverDate = ref(null);
const currentHour = ref(dayjs().hour());
const currentMinute = ref(dayjs().minute());

// 主题跟随 html.dark
const isDark = ref(true);
const syncTheme = () => { isDark.value = document.documentElement.classList.contains('dark'); };

/* ------------------------------ 数据同步 ------------------------------ */
const parse = (v) => {
    if (!v) return null;
    const d = dayjs(v);
    return d.isValid() ? d : null;
};

const syncFromModel = () => {
    if (props.range) {
        const arr = Array.isArray(props.modelValue) ? props.modelValue : [];
        rangeStart.value = parse(arr[0]);
        rangeEnd.value = parse(arr[1]);
        activeEnd.value = rangeStart.value && !rangeEnd.value ? 'end' : 'start';
    } else {
        selected.value = parse(props.modelValue);
    }
};
watch(() => props.modelValue, syncFromModel, { immediate: true, deep: true });

const fmtOut = (d) => (d ? d.format('YYYY-MM-DDTHH:mm') : '');
const emitValue = (v) => {
    emit('update:modelValue', v);
    emit('change', v);
};

const displayValue = computed(() => (selected.value ? selected.value.format('YYYY-MM-DD HH:mm') : ''));
const startDisplay = computed(() => (rangeStart.value ? rangeStart.value.format('YYYY-MM-DD HH:mm') : ''));
const endDisplay = computed(() => (rangeEnd.value ? rangeEnd.value.format('YYYY-MM-DD HH:mm') : ''));

const previewText = computed(() => {
    if (!props.range) return displayValue.value;
    if (!rangeStart.value) return '';
    return `${rangeStart.value.format('MM-DD HH:mm')} → ${rangeEnd.value ? rangeEnd.value.format('MM-DD HH:mm') : '...'}`;
});

/* ------------------------------ 日历渲染 ------------------------------ */
const weekdays = computed(() =>
    isZh.value ? ['一', '二', '三', '四', '五', '六', '日'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
);

const headerLabel = computed(() => {
    if (viewMode.value === 'month') return viewMonth.value.format('YYYY');
    return isZh.value ? viewMonth.value.format('YYYY年M月') : viewMonth.value.format('MMMM YYYY');
});

const dayCells = computed(() => {
    const start = viewMonth.value.startOf('month');
    const offset = (start.day() + 6) % 7; // 周一为一周第一天
    const first = start.subtract(offset, 'day');
    return Array.from({ length: 42 }, (_, i) => {
        const date = first.add(i, 'day');
        return {
            key: date.format('YYYY-MM-DD'),
            date,
            inMonth: date.month() === viewMonth.value.month(),
        };
    });
});

const monthCells = computed(() =>
    Array.from({ length: 12 }, (_, i) => {
        const d = viewMonth.value.month(i).startOf('month');
        return { value: i, label: isZh.value ? `${i + 1}月` : d.format('MMM') };
    }),
);

const isBetween = (d, a, b) => d.isAfter(a, 'day') && d.isBefore(b, 'day');

const dayClass = (cell) => {
    const d = cell.date;
    const cls = [];
    if (!cell.inMonth) cls.push('is-muted');
    if (d.isSame(dayjs(), 'day')) cls.push('is-today');

    if (!props.range) {
        if (selected.value && d.isSame(selected.value, 'day')) cls.push('is-selected');
        return cls;
    }

    const s = rangeStart.value;
    const e = rangeEnd.value;
    if (s && d.isSame(s, 'day')) cls.push('is-start');
    if (e && d.isSame(e, 'day')) cls.push('is-end');
    if (s && e && isBetween(d, s, e)) cls.push('is-in-range');
    if (s && !e && hoverDate.value && d.isAfter(s, 'day') && isBetween(d, s, hoverDate.value)) cls.push('is-in-range');
    if (s && !e && hoverDate.value && d.isSame(hoverDate.value, 'day') && d.isAfter(s, 'day')) cls.push('is-end');
    return cls;
};

/* ------------------------------ 时间同步 ------------------------------ */
const activeDate = computed(() =>
    props.range ? (activeEnd.value === 'start' ? rangeStart.value : rangeEnd.value) : selected.value,
);

const pad = (n) => String(n).padStart(2, '0');

const scrollToActive = () => {
    nextTick(() => {
        const center = (el, index) => {
            if (!el) return;
            const child = el.children[index];
            if (!child) return;
            el.scrollTop = child.offsetTop - el.clientHeight / 2 + child.clientHeight / 2;
        };
        center(hourListRef.value, currentHour.value);
        center(minuteListRef.value, currentMinute.value);
    });
};

const syncTime = () => {
    const target = activeDate.value;
    if (target) {
        currentHour.value = target.hour();
        currentMinute.value = target.minute();
    } else {
        const n = dayjs();
        currentHour.value = n.hour();
        currentMinute.value = n.minute();
    }
    scrollToActive();
};

const applyTime = () => {
    const target = activeDate.value;
    if (!target) return;
    const next = target.hour(currentHour.value).minute(currentMinute.value).second(0);
    if (!props.range) selected.value = next;
    else if (activeEnd.value === 'start') rangeStart.value = next;
    else rangeEnd.value = next;
};

const pickHour = (h) => {
    currentHour.value = h;
    applyTime();
    scrollToActive();
};

const pickMinute = (m) => {
    currentMinute.value = m;
    applyTime();
    scrollToActive();
};

/* ------------------------------ 交互逻辑 ------------------------------ */
const toggleView = () => {
    viewMode.value = viewMode.value === 'day' ? 'month' : 'day';
};

const step = (n) => {
    viewMonth.value = viewMonth.value.add(n, viewMode.value === 'day' ? 'month' : 'year');
};

const pickMonth = (m) => {
    viewMonth.value = viewMonth.value.month(m.value);
    viewMode.value = 'day';
};

const pickDay = (cell) => {
    const d = cell.date.hour(currentHour.value).minute(currentMinute.value).second(0);
    if (!cell.inMonth) viewMonth.value = d.startOf('month');

    if (!props.range) {
        selected.value = d;
        return;
    }

    const s = rangeStart.value;
    const e = rangeEnd.value;

    // 两端都已选中:点击端点切换编辑,点击其它日期重新开始
    if (s && e) {
        if (d.isSame(s, 'day')) { activeEnd.value = 'start'; syncTime(); return; }
        if (d.isSame(e, 'day')) { activeEnd.value = 'end'; syncTime(); return; }
        rangeStart.value = d;
        rangeEnd.value = null;
        activeEnd.value = 'end';
        syncTime();
        return;
    }

    if (!s) {
        rangeStart.value = d;
        activeEnd.value = 'end';
    } else if (!e) {
        if (d.isBefore(s, 'day')) {
            rangeStart.value = d;
            rangeEnd.value = null;
            activeEnd.value = 'end';
        } else {
            rangeEnd.value = d;
            activeEnd.value = 'end';
        }
    }
    syncTime();
};

const today = () => {
    const d = dayjs().hour(currentHour.value).minute(currentMinute.value).second(0);
    viewMonth.value = d.startOf('month');
    if (!props.range) {
        selected.value = d;
    } else if (activeEnd.value === 'start') {
        rangeStart.value = d;
    } else {
        rangeEnd.value = d;
    }
    scrollToActive();
};

const now = () => {
    const d = dayjs();
    viewMonth.value = d.startOf('month');
    currentHour.value = d.hour();
    currentMinute.value = d.minute();
    if (!props.range) {
        selected.value = d.second(0);
    } else if (activeEnd.value === 'start') {
        rangeStart.value = d.second(0);
    } else {
        rangeEnd.value = d.second(0);
    }
    scrollToActive();
};

const confirm = () => {
    if (!props.range) {
        if (!selected.value) return;
        emitValue(fmtOut(selected.value));
        open.value = false;
        return;
    }
    if (!rangeStart.value || !rangeEnd.value) return;
    emitValue([fmtOut(rangeStart.value), fmtOut(rangeEnd.value)]);
    open.value = false;
};

const clear = () => {
    if (!props.range) {
        selected.value = null;
        emitValue('');
        return;
    }
    rangeStart.value = null;
    rangeEnd.value = null;
    activeEnd.value = 'start';
    emitValue(['', '']);
};

/* ------------------------------ 弹层定位 ------------------------------ */
const updatePosition = () => {
    const el = rootRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const panelW = panelRef.value?.offsetWidth || 420;
    const panelH = panelRef.value?.offsetHeight || 380;

    let top = rect.bottom + 8;
    if (top + panelH > window.innerHeight - 8 && rect.top - panelH - 8 > 0) {
        top = rect.top - panelH - 8;
    }
    let left = rect.left;
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
    if (left < 8) left = 8;

    panelStyle.value = { top: `${top}px`, left: `${left}px` };
};

// 让右侧时间列的高度与左侧日历内容高度一致
const syncPanelHeight = () => {
    nextTick(() => {
        const panel = panelRef.value;
        if (!panel) return;
        const cal = panel.querySelector('.app-dtp-calendar');
        const head = panel.querySelector('.app-dtp-time-head');
        const cols = panel.querySelector('.app-dtp-time-cols');
        if (!cal || !cols) return;
        // 先把时间列压到 0,让日历回到内容自然高度,再按日历高度回填
        cols.style.height = '0px';
        const headH = head ? head.offsetHeight : 0;
        const target = cal.offsetHeight - headH;
        cols.style.height = target > 0 ? `${target}px` : '';
    });
};

const openPanel = () => {
    if (props.disabled) return;
    open.value = true;
    syncTime();
    nextTick(() => {
        updatePosition();
        syncPanelHeight();
    });
};

const onTriggerClick = (e) => {
    if (props.disabled) return;
    if (open.value) {
        open.value = false;
        return;
    }
    if (props.range) {
        const rect = e.currentTarget.getBoundingClientRect();
        activeEnd.value = e.clientX - rect.left < rect.width / 2 ? 'start' : 'end';
    }
    openPanel();
};

const onDocMouseDown = (e) => {
    if (!open.value) return;
    const target = e.target;
    if (panelRef.value?.contains(target)) return;
    if (rootRef.value?.contains(target)) return;
    open.value = false;
};

const onKeydown = (e) => {
    if (e.key === 'Escape' && open.value) open.value = false;
};

watch(activeEnd, () => syncTime());
watch(viewMode, () => { if (open.value) syncPanelHeight(); });

onMounted(() => {
    syncTheme();
    themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
});

let themeObserver = null;
onBeforeUnmount(() => {
    themeObserver?.disconnect();
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', updatePosition);
    window.removeEventListener('scroll', updatePosition, true);
});
</script>

<!-- 非 scoped:弹层被 teleport 到 body -->
<style>
.app-dtp-root {
  position: relative;
  width: 100%;
}

.app-dtp-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid #334155;
  border-radius: 12px;
  background-color: #1e293b;
  color: #ffffff;
  font-size: 0.875rem;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.app-dtp-trigger:hover { border-color: #475569; }
.app-dtp-trigger.is-open { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15); }
.app-dtp-trigger.is-disabled { opacity: 0.6; cursor: not-allowed; }

.app-dtp-value, .app-dtp-half, .app-dtp-ph {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-dtp-ph { color: #64748b; }
.app-dtp-icon { color: #94a3b8; flex-shrink: 0; }
.app-dtp-arrow { color: #64748b; flex-shrink: 0; font-size: 0.75rem; }
.app-dtp-range-sep { color: #64748b; }

.app-dtp-clear {
  flex-shrink: 0;
  color: #94a3b8;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 2px;
}
.app-dtp-clear:hover { color: #f87171; }

html:not(.dark) .app-dtp-trigger {
  background-color: #ffffff;
  border-color: #cbd5e1;
  color: #0f172a;
}
html:not(.dark) .app-dtp-trigger:hover { border-color: #94a3b8; }
html:not(.dark) .app-dtp-ph { color: #94a3b8; }

/* 弹层 */
.app-dtp-panel {
  position: fixed;
  z-index: 3000;
  width: 416px;
  border: 1px solid #334155;
  border-radius: 16px;
  background-color: #0f172a;
  color: #e2e8f0;
  box-shadow: 0 24px 48px -16px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  user-select: none;
}
.app-dtp-panel:not(.is-dark) {
  border-color: #e2e8f0;
  background-color: #ffffff;
  color: #0f172a;
  box-shadow: 0 20px 40px -16px rgba(15, 23, 42, 0.25);
}

.app-dtp-body {
  display: flex;
  align-items: stretch;
}

/* 日历 */
.app-dtp-calendar {
  flex: 1;
  min-width: 0;
  padding: 12px 12px 8px;
}
.app-dtp-cal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.app-dtp-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.app-dtp-nav:hover { background-color: rgba(148, 163, 184, 0.15); }
.app-dtp-title {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.app-dtp-title-caret { font-size: 0.625rem; opacity: 0.6; }

.app-dtp-weekdays,
.app-dtp-days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.app-dtp-weekdays { margin-bottom: 4px; }
.app-dtp-weekdays span {
  text-align: center;
  font-size: 0.6875rem;
  color: #64748b;
  padding: 4px 0;
}
.app-dtp-day {
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.app-dtp-day:hover { background-color: rgba(16, 185, 129, 0.18); }
.app-dtp-day.is-muted { color: #475569; }
.app-dtp-day.is-today { box-shadow: inset 0 0 0 1px #10b981; }
.app-dtp-day.is-in-range { background-color: rgba(16, 185, 129, 0.16); border-radius: 0; }
.app-dtp-day.is-start,
.app-dtp-day.is-end {
  background-color: #10b981;
  color: #ffffff;
  font-weight: 600;
}
.app-dtp-day.is-start { border-top-left-radius: 8px; border-bottom-left-radius: 8px; }
.app-dtp-day.is-end { border-top-right-radius: 8px; border-bottom-right-radius: 8px; }
.app-dtp-day.is-selected { background-color: #10b981; color: #ffffff; font-weight: 600; }

.app-dtp-months {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 4px 0 8px;
}
.app-dtp-month {
  height: 40px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}
.app-dtp-month:hover { background-color: rgba(16, 185, 129, 0.18); }
.app-dtp-month.is-active { background-color: #10b981; color: #ffffff; }

/* 时间 */
.app-dtp-time {
  width: 132px;
  flex-shrink: 0;
  border-left: 1px solid rgba(148, 163, 184, 0.2);
  display: flex;
  flex-direction: column;
}
.app-dtp-time-head {
  display: flex;
  padding: 10px 8px 6px;
  gap: 4px;
}
.app-dtp-time-tab {
  flex: 1;
  border: 0;
  background: transparent;
  color: #64748b;
  font-size: 0.6875rem;
  padding: 4px 2px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.app-dtp-time-tab.is-active { color: #10b981; background-color: rgba(16, 185, 129, 0.12); font-weight: 600; }

.app-dtp-time-cols {
  display: flex;
  gap: 4px;
  padding: 0 8px 8px;
  /* 兜底高度,打开弹层时由 JS 按左侧日历高度回填,保证左右两边内容等高 */
  height: 246px;
  min-height: 0;
  box-sizing: border-box;
}
.app-dtp-time-col {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px;
  scrollbar-width: none !important;      /* Firefox */
  -ms-overflow-style: none !important;   /* 旧版 Edge/IE */
}
/* 隐藏滚动条(Chrome/Safari/Edge),覆盖 base.css 的全局 ::-webkit-scrollbar */
.app-dtp-time-col::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
}
.app-dtp-time-col::-webkit-scrollbar-track,
.app-dtp-time-col::-webkit-scrollbar-thumb {
  display: none !important;
  background: transparent !important;
  border: 0 !important;
}
.app-dtp-time-cell {
  flex-shrink: 0;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.app-dtp-time-cell:hover { background-color: rgba(16, 185, 129, 0.18); }
.app-dtp-time-cell.is-active { background-color: #10b981; color: #ffffff; font-weight: 600; }

/* 底部 */
.app-dtp-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
}
.app-dtp-link {
  border: 0;
  background: transparent;
  color: #10b981;
  font-size: 0.8125rem;
  cursor: pointer;
  padding: 4px 2px;
}
.app-dtp-link:hover { text-decoration: underline; }
.app-dtp-preview {
  flex: 1;
  text-align: right;
  font-size: 0.75rem;
  color: #64748b;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-dtp-confirm {
  border: 0;
  border-radius: 8px;
  background-color: #10b981;
  color: #ffffff;
  font-size: 0.8125rem;
  font-weight: 600;
  padding: 6px 16px;
  cursor: pointer;
}
.app-dtp-confirm:hover { background-color: #059669; }
</style>
