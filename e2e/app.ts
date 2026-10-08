/**
 * E2E 共享夹具：拦截所有外部依赖（manifest / 媒体 / 环境音目录 / 分布数据），
 * 让关键路径测试完全离线、确定。每个测试独享全新 BrowserContext（IndexedDB/localStorage 干净）。
 */
import { test as base, expect, type Page, type Route } from '@playwright/test'
import { buildBank, TINY_MP3, TINY_PNG } from './bank'

/** 可安装路由的目标：页面或浏览器上下文（035 分享桩跨上下文共享时需后者） */
type Routable = Page | import('@playwright/test').BrowserContext

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
export async function stubApp(page: Routable, opts?: { shares?: ShareStubStore }) {
  await page.route('**/api/manifest**', (r) => r.fulfill({ json: bank }))
  await page.route('**/data/manifest.json', (r) => r.fulfill({ json: bank }))
  // 029 M1:前端优先请求分层 core(夹具直接复用同一份 bank;分片请求回 404 → 走 core 首图首音回退)
  await page.route('**/data/manifest-core.json', (r) => r.fulfill({ json: bank }))
  await page.route('**/data/assets/*.json', (r) => r.fulfill({ status: 404, body: '' }))
  // 029 M2:全球池与区系层不加载真实产物（e2e 纯夹具,保持离线与速度）
  await page.route('**/data/manifest-global.min.json', (r) => r.fulfill({ status: 404, body: '' }))
  await page.route('**/data/species-distribution.json', (r) =>
    r.fulfill({ json: { schemaVersion: 1, sources: [], counts: {}, byCountry: {} } }),
  )
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
  // 025 M2/M3:全球骨架与区系夹具(1 个 bank 种回桥 + 1 个全球未收录种)
  await page.route('**/data/species-index.json', (r) =>
    r.fulfill({
      json: {
        schemaVersion: 1,
        checklistVersion: 'v2025b',
        citation: 'AviList Core Team. 2026. https://doi.org/10.2173/avilist.v2025b',
        sources: [
          { key: 'avilist', name: 'AviList v2025b', url: 'https://www.avilist.org/', license: 'CC BY 4.0', attribution: 'AviList Core Team', citation: 'AviList Core Team. 2026.' },
        ],
        counts: { species: 2 },
        species: [
          { taxonKey: 'avibase-TEST0001', nameSci: 'Testus birdus 1', order: 'Testiformes', family: 'Testidae', nameEn: 'Test Bird 1', nameZh: '测试鸟1', ebirdCode: 'tesbir1', backboneTaxonId: 900001, inatTaxonId: 700001 },
          { taxonKey: 'avibase-GLOB0001', nameSci: 'Globus testus', order: 'Testiformes', family: 'Testidae', nameEn: 'Global Testbird', nameZh: '全球测试鸟', ebirdCode: 'globtes1', backboneTaxonId: 900002 },
        ],
      },
    }),
  )
  await page.route('**/data/species-distribution.json', (r) =>
    r.fulfill({
      json: {
        schemaVersion: 1,
        generatedAt: 'e2e-fixture',
        method: 'e2e fixture',
        sources: [{ key: 'gbif', name: 'GBIF', url: 'https://www.gbif.org/', license: 'CC0', attribution: 'GBIF' }],
        counts: { countries: 2, pairs: 3, unmatchedNames: 0, badCountry: 0, deniedCountry: 0 },
        byCountry: { CN: ['GLOB0001', 'TEST0001'], BR: ['GLOB0001'] },
      },
    }),
  )
  // 名录目录（031 D-031-2）：小型确定性夹具（真实产物 1.5MB，e2e 只验证排序/跳转接线）
  await page.route('**/data/catalog.json', (r) =>
    r.fulfill({
      json: {
        schemaVersion: 1,
        generatedAt: 'e2e-fixture',
        counts: { total: 4, withImage: 4, withAudio: 4, orders: 2, families: 2 },
        orders: [
          {
            sci: 'Strigiformes',
            zh: '鸮形目',
            families: [
              {
                sci: 'Strigidae',
                species: [
                  { id: 'bubo-bubo', sci: 'Bubo bubo', zh: '雕鸮', py: 'diaoxiao', cm: 3, image: true, audio: true },
                  { id: 'athene-noctua', sci: 'Athene noctua', zh: '纵纹腹小鸮', py: 'zongwenfuxiaoxiao', cm: 1, image: true, audio: true },
                ],
              },
            ],
          },
          {
            sci: 'Passeriformes',
            zh: '雀形目',
            families: [
              {
                sci: 'Hirundinidae',
                species: [
                  { id: 'hirundo-rustica', sci: 'Hirundo rustica', zh: '家燕', py: 'jiayan', cm: 4, image: true, audio: true },
                  { id: 'delichon-dasypus', sci: 'Delichon dasypus', zh: '烟腹毛脚燕', py: 'yanfumaojiaoyan', cm: 1, image: true, audio: true },
                ],
              },
            ],
          },
        ],
      },
    }),
  )
  // 环境鸟鸣目录（外部站）：404 → 应用按「无音轨」降级，不播放
  await page.route('**whitenoise.earthtrip.online/**', (r) => r.fulfill({ status: 404, body: '' }))
  // 035 分享：内存桩（创建 → 读取 → 撤回，全离线可验证）
  await stubShares(page, opts?.shares)
  await page.route('**cdn.e2e.invalid/**', fulfillMedia)
}

/** 035 分享桩的跨上下文共享存储（创建方与"扫码方"各在新上下文，需共用同一份数据） */
export interface ShareStubStore {
  map: Map<string, { token: string; revoked: boolean; body: Record<string, unknown> }>
  /** 自增序号（生成 id） */
  seq: number
}
export function newShareStore(): ShareStubStore {
  return { map: new Map(), seq: 0 }
}

/**
 * 035 分享接口的内存桩：POST 建、GET 读、DELETE 撤回（撤回后 GET 404）。
 * 兼容 Page 与 BrowserContext（桩要按上下文装，"扫码方"是新上下文）。
 */
export async function stubShares(pageOrCtx: Routable, shared?: ShareStubStore) {
  const store = shared?.map ?? new Map<string, { token: string; revoked: boolean; body: Record<string, unknown> }>()
  const counter = shared ?? { map: store, seq: 0 }
  await pageOrCtx.route('**/api/shares', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON() as Record<string, unknown>
    counter.seq += 1
    const id = `E2Eshare${String(counter.seq).padStart(4, '0')}`
    const token = `tok-${counter.seq}-abcdef012345`
    store.set(id, { token, revoked: false, body })
    await route.fulfill({ status: 201, json: { ok: true, id, token } })
  })
  await pageOrCtx.route('**/api/shares/*', async (route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split('/').pop() ?? ''
    const hit = store.get(id)
    const method = route.request().method()
    if (method === 'DELETE') {
      const body = route.request().postDataJSON() as { token?: string }
      if (!hit || body.token !== hit.token) {
        return route.fulfill({ status: 401, json: { error: 'unauthorized' } })
      }
      hit.revoked = true
      return route.fulfill({ json: { ok: true, id, hidden: true } })
    }
    if (!hit || hit.revoked) return route.fulfill({ status: 404, json: { error: 'not_found' } })
    const payload = hit.body
    await route.fulfill({
      json: {
        ok: true,
        share: {
          id,
          at: Date.now(),
          mode: payload.mode,
          tier: payload.tier,
          total: payload.total,
          correct: payload.correct,
          accuracy: Math.round((Number(payload.correct) / Number(payload.total)) * 100),
          nickname: payload.nickname ?? null,
          payload: {
            v: 1,
            mode: payload.mode,
            tier: payload.tier,
            total: payload.total,
            correct: payload.correct,
            accuracy: Math.round((Number(payload.correct) / Number(payload.total)) * 100),
            locale: payload.locale ?? 'zh-CN',
            items: payload.items,
          },
        },
      },
    })
  })
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
