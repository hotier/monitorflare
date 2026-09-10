import { ref, computed } from 'vue';
import { API_BASE, fetchT, ADMIN_TOKEN_KEY, ADMIN_PASSWORD_KEY } from '../utils/api';

const storedToken = ref(sessionStorage.getItem(ADMIN_TOKEN_KEY) || '');
const isAuthenticated = computed(() => !!storedToken.value && storedToken.value.length > 0);

/**
 * 管理端 token(模块级)
 *
 * 单独导出是为了让非组件场景(如 composables/resources.js 里的取数函数)也能读到,
 * 不必为拿一个 ref 去调用 useAuth() 再丢弃它创建的其余局部状态。
 */
export const adminToken = storedToken;

export function useAuth() {
    const inputPassword = ref('');
    const loginError = ref('');
    const loggingIn = ref(false);

    const login = async (onSuccess) => {
        if (!inputPassword.value) return;
        loggingIn.value = true;
        loginError.value = '';
        try {
            const res = await fetchT(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: inputPassword.value }),
            });
            if (!res.ok) {
                loginError.value = res.status === 503 ? 'login.notConfigured' : 'login.wrongPassword';
                return;
            }
            const data = await res.json();
            storedToken.value = data.token || '';
            sessionStorage.setItem(ADMIN_TOKEN_KEY, storedToken.value);
            sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
            inputPassword.value = '';
            onSuccess?.();
        } catch {
            loginError.value = 'login.requestFailed';
        } finally {
            loggingIn.value = false;
        }
    };

    const logout = () => {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
        storedToken.value = '';
        // 整页跳转会重建模块,模块级资源缓存随之清空,无需额外清理
        window.location.href = '/';
    };

    return {
        inputPassword,
        loginError,
        loggingIn,
        storedToken,
        isAuthenticated,
        login,
        logout,
    };
}
