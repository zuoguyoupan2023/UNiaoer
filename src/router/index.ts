import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { track } from '@/core/metrics'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/quiz/image',
      name: 'quiz-image',
      // 路由级 code-split：进入时才加载
      component: () => import('../views/QuizImageView.vue'),
    },
    {
      path: '/quiz/audio',
      name: 'quiz-audio',
      component: () => import('../views/QuizAudioView.vue'),
    },
    {
      path: '/result',
      name: 'result',
      component: () => import('../views/ResultView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
    },
    {
      // 答疑专栏（011 §9）：总览 + 单条详情
      path: '/faq',
      name: 'faq',
      component: () => import('../views/FaqView.vue'),
    },
    {
      path: '/faq/:speciesId',
      name: 'faq-detail',
      component: () => import('../views/FaqDetailView.vue'),
    },
    {
      // 029 数据透明度：全量名录目录（目→科→种；懒加载 catalog.json）
      path: '/catalog',
      name: 'catalog',
      component: () => import('../views/CatalogView.vue'),
    },
    {
      // 028 公开统计看板：匿名汇总数据（无需登录）
      path: '/stats',
      name: 'stats',
      component: () => import('../views/StatsView.vue'),
    },
    {
      // 039 P1：按位置找附近观鸟点（文本列表 + 距离；无地图）
      path: '/nearby',
      name: 'nearby',
      component: () => import('../views/NearbyView.vue'),
    },
    {
      // C7 地区浏览（017）：国家/地区 → 鸟种
      path: '/region',
      name: 'region',
      component: () => import('../views/RegionView.vue'),
    },
    {
      // 普通鸟种详情（地区浏览点击进入；有答疑说明时一并展示）
      path: '/species/:speciesId',
      name: 'species',
      component: () => import('../views/SpeciesDetailView.vue'),
    },
    {
      // B6 大众评审：公开报错列表 + 投票
      path: '/reports',
      name: 'reports',
      component: () => import('../views/ReportsView.vue'),
    },
    {
      // B6 管理入口（隐藏；需 ADMIN_KEY 解锁后调用受保护接口）
      path: '/admin',
      name: 'admin',
      component: () => import('../views/AdminView.vue'),
    },
    {
      // 035 单轮成绩分享：公开只读（任何人持链接可见）；不可猜 id + 可撤回（docs/035）
      path: '/s/:id',
      name: 'share',
      component: () => import('../views/ShareView.vue'),
    },
    {
      // 错题本并入 /profile/wrong 后保留旧路径重定向（导航入口已移除，R31）
      path: '/wrong',
      redirect: { name: 'profile-wrong' },
    },
    {
      // 轮次复盘并入 /profile/history 后保留旧路径重定向（E5，013 §5.5）
      path: '/history',
      redirect: { name: 'profile-history' },
    },
    {
      path: '/profile',
      name: 'profile',
      // 布局壳：身份卡 + 标签导航 + <RouterView/>；内容由二级路由切换（013 §5.5）
      component: () => import('../views/ProfileView.vue'),
      children: [
        { path: '', redirect: { name: 'profile-data' } },
        {
          path: 'data',
          name: 'profile-data',
          component: () => import('../views/profile/ProfileDataView.vue'),
        },
        {
          path: 'titles',
          name: 'profile-titles',
          component: () => import('../views/profile/ProfileTitlesView.vue'),
        },
        {
          path: 'badges',
          name: 'profile-badges',
          component: () => import('../views/profile/ProfileBadgesView.vue'),
        },
        {
          path: 'wrong',
          name: 'profile-wrong',
          component: () => import('../views/WrongBookView.vue'),
        },
        {
          path: 'history',
          name: 'profile-history',
          component: () => import('../views/RoundHistoryView.vue'),
        },
      ],
    },
    {
      // ⚠️ 临时预览页（2026-10-09，A3 新手池实测用）——**用完即删**：
      // 删除本路由 + src/views/DevStarterPreviewView.vue + scripts/i18n-scan.mjs 白名单条目。
      path: '/dev/starter',
      name: 'dev-starter',
      component: () => import('../views/DevStarterPreviewView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

/**
 * 035：分享页不鼓励搜索引擎收录（个人成绩，仅凭链接传播）。
 * 无 head 管理库，故在路由钩子里动态增删 robots meta。
 */
const ROBOTS_META_ID = 'uniaoer-robots-noindex'

/**
 * 028 计量：路径前缀 → page_view category（白名单枚举，与 worker METRIC_EVENTS 一致）。
 * 分享页（/s/:id）不计——那是别人的成绩页，计入会污染"本站使用"口径。
 */
function pageCategory(path: string): string {
  if (path.startsWith('/quiz') || path === '/result') return 'quiz'
  if (path.startsWith('/region')) return 'region'
  if (path.startsWith('/nearby')) return 'region'
  if (path.startsWith('/catalog')) return 'catalog'
  if (path.startsWith('/stats')) return 'stats'
  if (path.startsWith('/species')) return 'species'
  if (path.startsWith('/profile')) return 'profile'
  if (path.startsWith('/faq')) return 'faq'
  if (path.startsWith('/reports')) return 'reports'
  return 'other'
}

/** 上一次计入的类目：同 category 连续切换不重复计（docs/028 §3.1 的 SPA 去重语义） */
let lastCategory: string | null = null

router.afterEach((to) => {
  const existing = document.getElementById(ROBOTS_META_ID)
  if (to.name === 'share') {
    if (!existing) {
      const meta = document.createElement('meta')
      meta.id = ROBOTS_META_ID
      meta.name = 'robots'
      meta.content = 'noindex'
      document.head.appendChild(meta)
    }
  } else {
    existing?.remove()
  }
  // 028 计量：页面访问（同 category 连续切换不重复计；分享页不计）
  if (to.name !== 'share') {
    const category = pageCategory(to.path)
    if (category !== lastCategory) {
      lastCategory = category
      track('page_view', { category })
    }
  }
})

export default router
