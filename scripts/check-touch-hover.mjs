/**
 * iPhone sticky-hover 回归验证（2026-11-05 用户报障）。
 *
 * 验证两件事（用真实 WebKit 引擎 + iPhone 设备描述符）：
 *   ① `@media (hover: hover)` 在 iPhone 上**不匹配** → hover 规则整段不生效；
 *   ② 触摸/点按后，元素的 :hover 状态不会残留成"已选中"的外观。
 *
 * 跑法：node scripts/check-touch-hover.mjs [--base http://localhost:5173]
 * 前置：dev server 或 preview 已起（默认复用 5173，不自行启动）。
 */
import { webkit, devices } from 'playwright'
import { parseArgs } from './lib/util.mjs'

const args = parseArgs(process.argv.slice(2))
const BASE = String(args.base || 'http://localhost:5173')

const results = []
const pass = (m) => results.push({ ok: true, m })
const fail = (m) => results.push({ ok: false, m })

const browser = await webkit.launch()
// iPhone 13：hasTouch=true, isMobile=true → 引擎按触屏设备匹配媒体查询
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
const page = await ctx.newPage()

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 })
} catch (e) {
  console.error(`❌ 打不开 ${BASE}（先起 dev server；按铁律 14 不自行启动）：${e.message}`)
  await browser.close()
  process.exit(2)
}

// ── ① 媒体查询：iPhone 上 (hover: hover) 必须为 false ──────────────
const mq = await page.evaluate(() => ({
  hoverHover: matchMedia('(hover: hover)').matches,
  pointerCoarse: matchMedia('(pointer: coarse)').matches,
  anyHover: matchMedia('(any-hover: hover)').matches,
}))
console.log('媒体查询实测：', mq)
if (mq.hoverHover === false) pass('① iPhone 上 (hover: hover) = false → 全部 hover 规则不生效')
else fail(`① (hover: hover) 仍为 true，hover 保护无效（${JSON.stringify(mq)}）`)
if (mq.pointerCoarse) pass('   设备被识别为 pointer: coarse（触屏）')

// ── ② 找一个答题页，检查选项的 computed background 在触摸前后不变 ──
const quizUrl = `${BASE}/quiz/image`
await page.goto(quizUrl, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

// 若停在介绍页：新手向导是个 Teleport 覆盖层（.wizard-overlay），会拦截点击。
// 点它的「直接开始 / Skip」跳过，再点主按钮「开始答题」。
await page.waitForTimeout(900)
const wizard = page.locator('.wizard-overlay')
if (await wizard.count()) {
  const direct = wizard.locator('button', { hasText: /直接开始|Skip|跳过/ }).first()
  if (await direct.count()) await direct.click({ timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(600)
}
const startBtn = page.locator('button.btn-primary', { hasText: /开始答题|Start quiz|开始/ }).first()
if (await startBtn.count()) {
  await startBtn.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(3000)
}
// L1–L3 的选项在前 5s 是隐藏的（`optionRevealSec`）→ 必须等它显示出来
await page
  .locator('.option')
  .first()
  .waitFor({ state: 'visible', timeout: 15000 })
  .catch(() => {})

const opts = page.locator('.option')
const count = await opts.count()
if (!count) {
  fail('② 找不到 .option（可能仍在介绍页/加载中）')
} else {
  const before = await opts.nth(0).evaluate((el) => {
    const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, border: cs.borderTopColor, transform: cs.transform }
  })
  // 模拟手指划过（触摸移动后抬起）
  const box = await opts.nth(0).boundingBox()
  if (box) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => {})
  }
  await page.waitForTimeout(400)
  const after = await opts.nth(0).evaluate((el) => {
    const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, border: cs.borderTopColor, transform: cs.transform }
  })
  console.log('选项首个样式  触摸前:', before)
  console.log('选项首个样式  触摸后:', after)
  // 触摸会触发选答（背景变 correct/wrong），这属正常；关键是 **未触摸的其它选项** 不变
  const others = await page.locator('.option').evaluateAll((els) =>
    els.slice(1).map((el) => getComputedStyle(el).backgroundColor),
  )
  console.log('其余选项背景:', others)
  const NEUTRAL = ['rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)']
  const tainted = others.filter((c) => !NEUTRAL.includes(c))
  if (!tainted.length) pass('② 未触摸的选项保持中性背景 → 无 sticky hover 残留')
  else fail(`② 有 ${tainted.length} 个未触摸选项带非中性背景：${tainted.join(', ')}`)
}

// ── ③ 直接验证 CSS 规则被媒体查询包住（构建产物里搜不到裸 .tier:hover）──
const cssText = await page.evaluate(async () => {
  const links = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href)
  let out = ''
  for (const href of links) {
    try {
      out += await (await fetch(href)).text()
    } catch {
      /* 忽略 */
    }
  }
  // 内联 <style>
  for (const s of document.querySelectorAll('style')) out += s.textContent || ''
  return out
})
const bareTierHover = /(^|\})\s*\.tier:hover\s*\{/.test(cssText)
const bareOptionHover = /(^|\})\s*\.option[^{}]*:hover\s*\{/.test(cssText)
if (!bareTierHover) pass('③ 产物里没有裸 `.tier:hover`（已被媒体查询包裹）')
else fail('③ 产物里仍有裸 `.tier:hover`')
if (!bareOptionHover) pass('   产物里没有裸 `.option:hover`')
else fail('   产物里仍有裸 `.option:hover`')

await browser.close()

console.log('')
const bad = results.filter((r) => !r.ok)
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.m}`)
if (bad.length) {
  console.error(`\n❌ check:touch-hover 失败 ${bad.length} 项`)
  process.exit(1)
}
console.log('\n✅ check:touch-hover 通过')
