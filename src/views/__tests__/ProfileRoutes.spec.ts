import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import type { ArchiveRow, ProfileRow, RoundRecord, Stats } from '@/core/historyDb'

vi.mock('@/core/historyDb', () => ({
  getStats: vi.fn<() => Promise<Stats>>(async () => emptyStats),
  listRounds: vi.fn<() => Promise<RoundRecord[]>>(async () => []),
  getBadges: vi.fn<() => Promise<unknown[]>>(async () => []),
  getWrongBook: vi.fn<() => Promise<unknown[]>>(async () => []),
  listWrongHistory: vi.fn<() => Promise<unknown[]>>(async () => []),
  clearAll: vi.fn<() => Promise<void>>(async () => undefined),
  clearWrong: vi.fn<() => Promise<void>>(async () => undefined),
  removeWrong: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  exportAll: vi.fn<() => Promise<unknown>>(),
  importBackup: vi.fn<() => Promise<unknown>>(),
  isBackupFile: vi.fn<() => boolean>(() => false),
  // 档案（013 A3-lite）
  getActiveProfile: vi.fn<() => Promise<ProfileRow>>(async () => ({
    id: 'p',
    nickname: '',
    createdAt: 0,
    activeArchiveId: 'a',
    updatedAt: 0,
  })),
  getActiveArchive: vi.fn<() => Promise<ArchiveRow>>(async () => ({
    id: 'a',
    profileId: 'p',
    name: '2026-01-01, 00-00',
    nickname: '',
    createdAt: 0,
  })),
  listArchives: vi.fn<() => Promise<ArchiveRow[]>>(async () => [
    { id: 'a', profileId: 'p', name: '2026-01-01, 00-00', nickname: '', createdAt: 0 },
  ]),
  activateArchive: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  createArchive: vi.fn<(name?: string, nickname?: string) => Promise<ArchiveRow>>(async () => ({
    id: 'a2',
    profileId: 'p',
    name: '2026-01-02, 00-00',
    nickname: '',
    createdAt: 0,
  })),
  setProfileNickname: vi.fn<(n: string) => Promise<void>>(async () => undefined),
  setActiveArchiveNickname: vi.fn<(n: string) => Promise<void>>(async () => undefined),
}))
vi.mock('@/core/bank', () => ({
  loadBank: vi.fn<() => Promise<unknown>>(async () => ({})),
  speciesNameById: vi.fn<() => string | undefined>(() => undefined),
  speciesNameByStoredName: vi.fn<() => string | undefined>(() => undefined),
}))

import ProfileView from '../ProfileView.vue'

/** 挂 RouterView 桩：布局本身是 /profile 的路由组件，直接 mount 会经 RouterView 嵌套自身 */
const RouterViewStub = { template: '<RouterView />' }

function mountApp(r: Router) {
  return mount(RouterViewStub, { global: { plugins: [r, createPinia()] } })
}

const emptyStats: Stats = {
  rounds: 0,
  totalQuestions: 0,
  totalCorrect: 0,
  bestAccuracy: 0,
  perfectRounds: 0,
  distinctSpecies: 0,
  audioRounds: 0,
  maxTier: 0,
  bestStreak: 0,
  wrongCount: 0,
  hellRounds: 0,
  hellQuestions: 0,
  hellCorrect: 0,
  hellPerfectRounds: 0,
  audioCorrect: 0,
  wrongPracticeRounds: 0,
  wrongPracticeCorrect: 0,
  imagePerfectRounds: 0,
  audioPerfectRounds: 0,
  maxCrossStreak: 0,
  distinctCorrect: 0,
  nightRound: false,
  dawnRound: false,
  escapedQuitPerfect: false,
}

/** 与 src/router/index.ts 的 /profile 子树保持一致 */
function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/profile',
        component: ProfileView,
        children: [
          { path: '', redirect: { name: 'profile-data' } },
          { path: 'data', name: 'profile-data', component: () => import('../profile/ProfileDataView.vue') },
          { path: 'titles', name: 'profile-titles', component: () => import('../profile/ProfileTitlesView.vue') },
          { path: 'badges', name: 'profile-badges', component: () => import('../profile/ProfileBadgesView.vue') },
          { path: 'wrong', name: 'profile-wrong', component: () => import('../WrongBookView.vue') },
          { path: 'history', name: 'profile-history', component: () => import('../RoundHistoryView.vue') },
        ],
      },
      { path: '/wrong', redirect: { name: 'profile-wrong' } },
      { path: '/history', redirect: { name: 'profile-history' } },
    ],
  })
}

describe('「我的」页二级路由（013 §5.5）', () => {
  let router: Router
  beforeEach(async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    router = makeRouter()
  })

  it('/profile 重定向到 /profile/data，5 个标签指向各自二级路径', async () => {
    await router.push('/profile')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('profile-data')

    const wrapper = mountApp(router)
    // 无数据时「历史 / 错题本」置灰不可点，只有 3 个可点标签
    const tabs = wrapper.findAll('.section-tabs a')
    expect(tabs.map((a) => a.attributes('href'))).toEqual([
      '/profile/data',
      '/profile/titles',
      '/profile/badges',
    ])
    expect(wrapper.findAll('.section-tabs .tab-off')).toHaveLength(2)
    // 默认渲染数据子页（含 6 张统计卡）
    await flushPromises()
    expect(wrapper.findAll('.stat')).toHaveLength(6)
  })

  it('旧一级路径 /history、/wrong 重定向到 profile 子路由', async () => {
    await router.push('/history')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('profile-history')

    await router.push('/wrong')
    expect(router.currentRoute.value.name).toBe('profile-wrong')
  })

  it('切换标签渲染对应子页（称号墙 8 轨道）', async () => {
    await router.push('/profile/titles')
    await router.isReady()
    const wrapper = mountApp(router)
    await flushPromises()
    expect(wrapper.findAll('.badge-grid .badge')).toHaveLength(8) // 8 条称号轨道
    // 高亮 tab 与当前路径一致
    const on = wrapper.findAll('.section-tabs a').find((a) => a.classes().includes('on'))
    expect(on?.text()).toContain('称号')
  })
})
