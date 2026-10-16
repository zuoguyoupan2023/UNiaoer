/**
 * 本地端到端 smoke（一次性工具，跑完可删）
 *   node experiments/birdid/local_ui_smoke.mjs <baseUrl> <图片...> -- <音频...>
 * 走真实页面：打开 /identify → 选文件 → 等结果 → 打印候选。
 * 用于验证「模型能否下载 + 预处理是否正确 + 对表是否生效」三件事。
 */
import { chromium } from 'playwright'
import path from 'node:path'

const [base, ...rest] = process.argv.slice(2)
const i = rest.indexOf('--')
const images = i >= 0 ? rest.slice(0, i) : rest
const audios = i >= 0 ? rest.slice(i + 1) : []

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(`${base}/identify`, { waitUntil: 'networkidle' })

async function dump(title) {
  console.log(`\n──── ${title} ────`)
  const err = await page.locator('.err').first().textContent().catch(() => null)
  if (err) console.log('  页面报错:', err.trim())
  const cands = await page.locator('.cand').allTextContents()
  if (!cands.length) console.log('  （无候选卡片）')
  for (const c of cands) console.log('  ·', c.replace(/\s+/g, ' ').trim().slice(0, 110))
  const notes = await page.locator('.cNote').allTextContents()
  for (const n of notes) console.log('  备注:', n.trim().slice(0, 80))
}

for (const f of images) {
  await page.setInputFiles('#birdid-image-input', path.resolve(f))
  // 等结果卡片或报错，最多 180s（112MB 模型首次推理较慢）
  await page.waitForSelector('.cand, .err', { timeout: 180000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await dump(`图片 ${f}`)
  await page.reload({ waitUntil: 'networkidle' })
}

for (const f of audios) {
  await page.setInputFiles('input[type=file][accept="audio/*"]', path.resolve(f))
  await page.waitForSelector('.cand, .err', { timeout: 180000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await dump(`音频 ${f}`)
  await page.reload({ waitUntil: 'networkidle' })
}

console.log('\n控制台错误：', errors.length ? errors.slice(0, 8).join('\n  ') : '无')
await browser.close()