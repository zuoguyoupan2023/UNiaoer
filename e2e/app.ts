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
    r.fulfill({
      json: { bySpecies: { 'sp-01': ['CN', 'US'], 'sp-02': ['CN', 'JP', 'US'], 'sp-03': ['US'] } },
    }),
  )
  await page.route('**/data/faq-changelog.json', (r) => r.fulfill({ json: [] }))
  // 省级层（021 M2/M3）：美国 CA/WA；中国 34 区划之一角（含港澳台标注名，铁律 6）
  await page.route('**/data/region-provinces.json', (r) =>
    r.fulfill({
      json: {
        schemaVersion: 1,
        generatedAt: 'e2e-fixture',
        method: 'gbif stateProvince → ISO 3166-2；CN 港澳台由 distribution 存在性并入',
        sources: [{ key: 'gbif', name: 'GBIF', url: 'https://www.gbif.org/', license: 'CC0', attribution: 'GBIF' }],
        countries: ['CN', 'US'],
        byCountry: {
          CN: { 'CN-11': '北京市', 'CN-44': '广东省', 'CN-71': '中国台湾', 'CN-91': '中国香港', 'CN-92': '中国澳门' },
          US: { 'US-CA': 'California', 'US-WA': 'Washington' },
        },
        byCountryAlt: {
          CN: { 'CN-11': 'Beijing', 'CN-44': 'Guangdong', 'CN-71': 'Taiwan, China', 'CN-91': 'Hong Kong, China', 'CN-92': 'Macao, China' },
        },
        bySpecies: {
          'sp-01': { CN: { 'CN-44': 500, 'CN-91': 1 }, US: { 'US-CA': 120, 'US-WA': 4 } },
          'sp-02': { CN: { 'CN-11': 30, 'CN-71': 1 }, US: { 'US-CA': 30 } },
          'sp-03': { US: { 'US-WA': 8 } },
        },
      },
    }),
  )
  // 季节性数据（021 M1/M3）：sp-01 有 12 月向量 + 权威居留型；其余物种无条目（块隐藏）
  await page.route('**/data/seasonality.json', (r) =>
    r.fulfill({
      json: {
        schemaVersion: 1,
        generatedAt: 'e2e-fixture',
        method: 'max monthly share across sources (0-100)',
        sources: ['GBIF'],
        speciesCount: 1,
        bySpecies: {
          'sp-01': {
            months: [0, 0, 0, 80, 100, 90, 60, 20, 0, 0, 0, 0],
            recordCount: 1234,
            sources: ['gbif'],
            range: ['resident'],
          },
        },
      },
    }),
  )
  // 观鸟点（021 M4 腿 B）：网格聚合统计层（US/CN 各若干点）
  await page.route('**/data/hotspots.json', (r) =>
    r.fulfill({
      json: {
        schemaVersion: 1,
        generatedAt: 'e2e-fixture',
        method: 'gbif occurrence grid aggregation',
        grid: 0.1,
        thresholds: { minRecords: 1, minSpecies: 1, minObservers: 0 },
        sources: [{ key: 'gbif', name: 'GBIF', url: 'https://www.gbif.org/', license: 'CC0', attribution: 'GBIF' }],
        countries: ['CN', 'US'],
        hotspotCount: 3,
        hotspots: [
          { id: 'US-g0.1-340_-1183', name: 'California', lat: 34.05, lng: -118.25, country: 'US', subnational1: 'California', speciesCount: 2, recordCount: 42, observerCount: 5, topSpecies: [{ id: 'sp-01', count: 20 }, { id: 'sp-02', count: 10 }], sources: ['gbif'] },
          { id: 'US-g0.1-476_-1223', name: 'Washington', lat: 47.6, lng: -122.3, country: 'US', subnational1: 'Washington', speciesCount: 1, recordCount: 21, observerCount: 3, topSpecies: [{ id: 'sp-03', count: 21 }], sources: ['gbif'] },
          { id: 'CN-g0.1-399_1164', name: 'Beijing', lat: 39.9, lng: 116.4, country: 'CN', subnational1: 'Beijing', speciesCount: 1, recordCount: 30, observerCount: 4, topSpecies: [{ id: 'sp-02', count: 30 }], sources: ['gbif'] },
        ],
      },
    }),
  )
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
