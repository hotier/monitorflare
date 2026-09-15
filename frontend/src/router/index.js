import { createRouter, createWebHistory } from 'vue-router';

const routes = [
    {
        path: '/',
        name: 'Status',
        component: () => import('../views/StatusPage.vue'),
    },
    {
        path: '/monitor/:id',
        name: 'MonitorDetail',
        component: () => import('../views/MonitorDetail.vue'),
    },
    {
        path: '/magic',
        name: 'MagicLink',
        component: () => import('../components/admin/MagicLinkHandler.vue'),
    },
    {
        path: '/admin',
        name: 'Admin',
        component: () => import('../views/AdminPage.vue'),
    },
    {
        path: '/deploy',
        name: 'Deploy',
        component: () => import('../views/DeployPage.vue'),
    },
    {
        // 全站 API 调用说明:公开路由,不要求登录,方便直接把链接发给对接方
        path: '/api-docs',
        name: 'ApiDocs',
        component: () => import('../views/ApiDocsPage.vue'),
    },
];

const router = createRouter({
    history: createWebHistory(),
    routes,

    /**
     * 必须显式声明:Vue Router 4 默认不改动滚动位置。
     * 没有它时,从滚到底部的首页点进详情页,pushState 后文档仍停在原来的滚动偏移,
     * 表现就是"详情页一打开直接定位到延迟趋势那一屏"。
     *
     * - 新导航(点卡片进详情、切路由):回到顶部
     * - 浏览器前进/后退:savedPosition 存在,恢复离开前的位置(首页滚到底再返回不会丢位置)
     */
    scrollBehavior(to, from, savedPosition) {
        if (savedPosition) return savedPosition;
        return { top: 0, left: 0 };
    },
});

export default router;
