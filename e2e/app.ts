/**
 * E2E 共享夹具：拦截所有外部依赖（manifest / 媒体 / 环境音目录 / 分布数据），
 * 让关键路径测试完全离线、确定。每个测试独享全新 BrowserContext（IndexedDB/localStorage 干净）。
 */
import { test as base, expect, type Page, type Route } from '@playwright/test'
import { buildBank, TINY_MP3, TINY_PNG } from './bank'

const bank = buildBank()

async function fulfillMedia(route: Route) {
  const url = route.request().url()
  await route.fulfill({
    body: url.endsWith('.mp3') ? TINY_MP3 : TINY_PNG,
    contentType: url.endsWith('.mp3') ? 'audio/mpeg' : 'image/png',
    headers: { 'access-control-allow-origin': '*' },
  })
}

/** 拦截全部外部数据源；必须在 goto 之前调用 */
export async function stubApp(page: Page) {
  await page.route('**/api/manifest**', (r) => r.fulfill({ json: bank }))
  await page.route('**/data/manifest.json', (r) => r.fulfill({ json: bank }))
  await page.route('**/data/distribution.json', (r) =>
    r.fulfill({ json: { bySpecies: { 'sp-01': ['CN'], 'sp-02': ['CN', 'JP'] } } }),
  )
  await page.route('**/data/faq-changelog.json', (r) => r.fulfill({ json: [] }))
  // 环境鸟鸣目录（外部站）：404 → 应用按「无音轨」降级，不播放
  await page.route('**whitenoise.earthtrip.online/**', (r) => r.fulfill({ status: 404, body: '' }))
  await page.route('**cdn.e2e.invalid/**', fulfillMedia)
}

/** 把自动切换设为「都手动」：作答反馈固定落在下方常驻块，断言不依赖 3s/4s 浮窗 */
export async function setManualAutoNext(page: Page) {
  await page.goto('/settings')
  await page.getByRole('button', { name: '都手动' }).click()
}

export interface StartOptions {
  /** 是否先设置「都手动」（默认 true） */
  manual?: boolean
}

/** 走完首次向导 + 选 L1 + 开始答题，停在第一题的选项隐藏期 */
export async function startImageQuiz(page: Page, opts: StartOptions = {}) {
  if (opts.manual !== false) await setManualAutoNext(page)
  await page.goto('/quiz/image')
  // 全新上下文必弹首启向导：确定性地等待并跳过（isVisible 立即返回有竞态）
  const wizard = page.locator('.wizard-panel')
  await expect(wizard).toBeVisible()
  await page.getByRole('button', { name: '直接开始' }).click()
  await expect(wizard).toBeHidden()
  await page.getByRole('button', { name: /L1 入门/ }).click()
  await page.getByRole('button', { name: '开始答题' }).click()
  await expect(page.locator('.status-bar')).toBeVisible()
}

/** 等选项显示并点第 n 个（1-based） */
export async function answerOption(page: Page, n = 1) {
  // L1 前 5s 隐藏选项
  await expect(page.locator('.option').first()).toBeVisible({ timeout: 10_000 })
  await page.locator('.option').nth(n - 1).click()
}

export const test = base.extend<{ stubbed: void }>({
  stubbed: [
    async ({ page }, use) => {
      await stubApp(page)
      await use()
    },
    { auto: true },
  ],
})

export { expect, bank }
