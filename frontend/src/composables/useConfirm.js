import { ref } from 'vue';

/**
 * 全局唯一的确认弹窗状态。
 *
 * 用法:`const ok = await confirmDialog('确定删除?')`,确认返回 true,取消返回 false。
 * 渲染点只有一个 —— App.vue 里的 <ConfirmDialog>,所有视图和弹窗共用同一个实例,
 * 所以「删除 / 退出」这类操作不需要各自复制一套弹窗状态。
 *
 * 状态与 Vue 应用实例无关(模块级单例),因此在任何组件之外调用也安全。
 */
const confirmState = ref({ show: false, message: '', confirmText: '', resolve: null });

export function useConfirm() {
    const confirmDialog = (message, options = {}) => new Promise((resolve) => {
        // 理论上不会出现:上个弹窗没关闭就再弹一个。真发生就把旧的按「取消」结掉,
        // 否则那个 await 会永远挂着。
        confirmState.value.resolve?.(false);
        confirmState.value = { show: true, message, confirmText: options.confirmText || '', resolve };
    });

    const resolveConfirm = (result) => {
        const { resolve } = confirmState.value;
        confirmState.value = { show: false, message: '', confirmText: '', resolve: null };
        resolve?.(!!result);
    };

    return { confirmState, confirmDialog, resolveConfirm };
}
