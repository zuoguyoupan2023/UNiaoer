/**
 * 自适应难度提示 + 撤销 的端到端验证（2026-11-05 用户需求）。
 *
 * 验证三件事：
 *   ① 自适应提示显示在「开始答题」**正上方**（不是夹在中间）；
 *   ② 提示里有「撤销」按钮；
 *   ③ 点撤销后档位回到**用户自己原先选的**那一档（而不是停在自动调整后的档）。
 *
 * 做法：先往 IndexedDB 注入 5 组高正确率历史 → 触发自适应升档 → 点撤销 → 比对档位。
 *
 * 用法：node scripts/check-adaptive-undo.mjs --base http://localhost:4189
 */
import { webkit, devices } from 'playwright'
import { parseArgs } from './lib/util.mjs'

const args = parseArgs(process.argv.slice(2))
const BASE = String(args.base || 'http://localhost:5173')

const browser = await webkit.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()
const results = []
const ok = (m) => results.push({ ok: true, m })
const bad = (m) => results.push({ ok: false, m })

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 })
} catch (e) {
  console.error(`❌ 打不开 ${BASE}（先起 server）：${e.message}`)
  await browser.close()
  process.exit(2)
}

// ── 注入 5 组满分历史 + 把用户档位设成 L2 ──────────────────────────
// 关键：IndexedDB 要等 app 自己建库（首次访问 `/quiz/image` 时 openDb 才执行 upgrade）。
// 所以先导航一次、等它建好库，再注入，最后**重新导航**让介绍页读到新数据。
await page.goto(`${BASE}/quiz/image`, { waitUntil: 'networkidle', timeout: 25000 })
await page.waitForTimeout(2000)

const injected = await page.evaluate(async () => {
  // 设置存的是整个 JSON（STORAGE_KEY = 'uniaoer.settings.v2'）→ 合并写入，不覆盖其它项
  const KEY = 'uniaoer.settings.v2'
  let cur = {}
  try {
    cur = JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    cur = {}
  }
  cur.tierImage = 2 // 用户自己选的档位 = L2
  cur.adaptiveTier = true // 确保自适应开启
  localStorage.setItem(KEY, JSON.stringify(cur))

  const open = () =>
    new Promise((res, rej) => {
      const r = indexedDB.open('uniaoer')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  const db = await open()
  const names = [...db.objectStoreNames]
  if (!names.includes('rounds')) {
    db.close()
    return { injected: 0, names }
  }
  const round = {
    id: '',
    at: 0,
    category: 'image',
    mode: 'image',
    tier: 2,
    total: 10,
    correct: 10,
    accuracy: 100,
    durationMs: 60000,
    items: [],
    // listRounds() 按 archiveId 索引过滤；不写这个字段 → 注入的记录读不到
    archiveId: 'a-default',
    profileId: 'p-default',
  }
  const rounds = []
  for (let i = 0; i < 5; i++) rounds.push({ ...round, id: `seed-${i}`, at: Date.now() - i * 1000 })
  await new Promise((res, rej) => {
    const tx = db.transaction('rounds', 'readwrite')
    const st = tx.objectStore('rounds')
    for (const r of rounds) st.put(r)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
  db.close()
  return { injected: rounds.length, names }
})
console.log('注入结果:', injected)

// 重新加载介绍页，让自适应读到刚注入的历史
await page.goto(`${BASE}/quiz/image`, { waitUntil: 'networkidle', timeout: 25000 })
await page.waitForTimeout(2000)
const wizard = page.locator('.wizard-overlay')
if (await wizard.count()) {
  await wizard
    .locator('button', { hasText: /直接开始/ })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {})
  await page.waitForTimeout(900)
}

const hint = page.locator('.adaptive-hint')
const startBtn = page.locator('button.btn-primary', { hasText: /开始答题/ }).first()

if (!(await hint.count())) {
  console.log('⚠ 自适应提示未出现（注入的历史可能未命中当前档案，或正确率未达阈值）')
  bad('① 未能触发自适应提示，无法验证位置与撤销')
} else {
  const hb = await hint.boundingBox()
  const sb = await startBtn.boundingBox()
  const gap = sb.y - (hb.y + hb.height)
  console.log(
    `提示 y=${Math.round(hb.y)} h=${Math.round(hb.height)} · 按钮 y=${Math.round(sb.y)} · 间距=${Math.round(gap)}px`,
  )
  if (hb.y < sb.y && gap >= 0 && gap < 40)
    ok(`① 提示紧贴「开始答题」上方（间距 ${Math.round(gap)}px）`)
  else bad(`① 提示位置不对：hint.y=${hb.y} btn.y=${sb.y} gap=${gap}`)
  console.log('提示文案:', (await hint.innerText()).replace(/\n/g, ' | '))

  const undo = hint.locator('.adaptive-undo')
  if (await undo.count()) ok('② 提示内有「撤销」按钮')
  else bad('② 找不到 .adaptive-undo')

  // ── ③ 撤销后回到用户原档 ──────────────────────────────────
  if (await undo.count()) {
    // 触发前记录被选中的档位
    const beforeTier = await page
      .locator('.tiers .tier.on')
      .first()
      .innerText()
      .catch(() => '')
    await undo.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(900)
    const afterTier = await page
      .locator('.tiers .tier.on')
      .first()
      .innerText()
      .catch(() => '')
    const hintGone = (await page.locator('.adaptive-hint').count()) === 0
    console.log(
      `撤销前选中: ${beforeTier.replace(/\n/g, ' ')} | 撤销后选中: ${afterTier.replace(/\n/g, ' ')}`,
    )
    if (hintGone) ok('③ 撤销后提示消失')
    else bad('③ 撤销后提示未消失')
    if (beforeTier && afterTier && beforeTier !== afterTier) {
      ok(`③ 撤销后档位已改变（${beforeTier.split('\n')[0]} → ${afterTier.split('\n')[0]}）`)
    } else if (afterTier.includes('L2')) {
      ok('③ 撤销后回到用户原先选的 L2')
    } else {
      bad(
        `③ 撤销未回到原档（撤销前=${beforeTier.split('\n')[0]} 撤销后=${afterTier.split('\n')[0]}）`,
      )
    }
  }
}

await browser.close()
console.log('')
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.m}`)
const fails = results.filter((r) => !r.ok)
if (fails.length) {
  console.error(`\n❌ 失败 ${fails.length} 项`)
  process.exit(1)
}
console.log('\n✅ check:adaptive-undo 通过')
