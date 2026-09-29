#!/usr/bin/env node
/**
 * i18n 质量门禁 · scan（015 i18n-5 / 010 §i18n-5）
 *
 * 扫描 src/** 的 .ts/.vue 源码中「用户可见」的 CJK 字面量：
 * - 剥离注释（// 、 /* *\/、<!-- -->）与 import/type 区域
 * - 检查剩余文本中的 CJK（含引号内字符串与模板文本节点）
 * - 排除测试、语言包（src/i18n/**）与下方白名单
 *
 * 命中即退出码 1（CI 失败）。白名单仅限已确认无法迁移的项，新增需写明理由。
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')

/** 排除目录/文件：测试与 i18n 语言包/数据本身（键或值含 CJK 是常态）。匹配相对 src 的路径 */
const EXCLUDE = [/^i18n[\\/]/, /__tests__/, /\.spec\.ts$/, /\.test\.ts$/]

/**
 * 白名单：{ file（相对 src 的路径）, line（1 起，0 = 任意行）, reason }
 * 迁移完成后应为空或极少；新增条目需要在 015/010 记录理由。
 */
const WHITELIST = [
  // 语言切换器里的语言名：各语言永远以自身文字显示（中文 不随 locale 翻译，i18n 惯例）
  { file: 'views/SettingsView.vue', line: 0, reason: '语言名按惯例以本语言显示，不翻译' },
]

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/

/** 剥离注释，保留字符串字面量内容（我们要找的就是字符串/模板里的 CJK）。
 * 统一状态栈：sq/dq/tpl 等子状态结束后回到进入前的状态，避免模板字符串里的
 * 引号（如 `${String(x, '0')}`）把状态机打回 code 导致后续注释被误判为代码。 */
function stripComments(code) {
  let out = ''
  let i = 0
  const n = code.length
  let state = 'code' // code | line | block | html | sq | dq | bt | tpl
  const stack = []
  const pop = () => stack.pop() ?? 'code'
  let braceDepth = 0 // tpl 内嵌套 { } 计数（进入 tpl 时清零）
  while (i < n) {
    const c = code[i]
    const next = code[i + 1]
    switch (state) {
      case 'code': {
        if (c === '/' && next === '/') {
          state = 'line'
          i += 2
        } else if (c === '/' && next === '*') {
          state = 'block'
          i += 2
        } else if (c === '<' && code.startsWith('<!--', i)) {
          state = 'html'
          i += 4
        } else if (c === "'" || c === '"') {
          stack.push(state)
          state = c === "'" ? 'sq' : 'dq'
          out += c
          i++
        } else if (c === '`') {
          state = 'bt'
          out += c
          i++
        } else {
          out += c
          i++
        }
        break
      }
      case 'line': {
        if (c === '\n') {
          state = pop()
          out += c
        }
        i++
        break
      }
      case 'block': {
        if (c === '*' && next === '/') {
          state = pop()
          i += 2
        } else {
          if (c === '\n') out += c // 保留换行以维持行号
          i++
        }
        break
      }
      case 'html': {
        if (code.startsWith('-->', i)) {
          state = pop()
          i += 3
        } else {
          if (c === '\n') out += c
          i++
        }
        break
      }
      case 'sq':
      case 'dq': {
        const quote = state === 'sq' ? "'" : '"'
        if (c === '\\') {
          out += code.slice(i, i + 2)
          i += 2
        } else if (c === quote) {
          state = pop()
          out += c
          i++
        } else {
          out += c
          i++
        }
        break
      }
      case 'bt': {
        if (c === '\\') {
          out += code.slice(i, i + 2)
          i += 2
        } else if (c === '`') {
          state = 'code'
          out += c
          i++
        } else if (c === '$' && next === '{') {
          stack.push('bt')
          state = 'tpl'
          braceDepth = 0
          out += c
          i += 2
        } else {
          out += c
          i++
        }
        break
      }
      case 'tpl': {
        if (c === '{') {
          braceDepth++
          out += c
          i++
        } else if (c === '}') {
          if (braceDepth > 0) braceDepth--
          else {
            state = pop() // 回到 bt
            out += c
          }
          i++
        } else if (c === "'" || c === '"') {
          stack.push(state)
          state = c === "'" ? 'sq' : 'dq'
          out += c
          i++
        } else if (c === '/' && next === '/') {
          stack.push(state)
          state = 'line'
          i += 2
        } else if (c === '/' && next === '*') {
          stack.push(state)
          state = 'block'
          i += 2
        } else {
          out += c
          i++
        }
        break
      }
      default:
        out += c
        i++
    }
  }
  return out
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      yield* walk(p)
    } else if (/\.(ts|vue)$/.test(e.name)) {
      yield p
    }
  }
}

const hits = []
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).replaceAll('\\', '/')
  if (EXCLUDE.some((re) => re.test(rel))) continue
  const src = fs.readFileSync(file, 'utf8')
  const stripped = stripComments(src)
  const lines = stripped.split('\n')
  const srcLines = src.split('\n')
  lines.forEach((line, idx) => {
    if (CJK.test(line)) {
      const entry = { file: rel, line: idx + 1, text: srcLines[idx]?.trim() ?? '' }
      if (
        !WHITELIST.some((w) => w.file === entry.file && (w.line === 0 || w.line === entry.line))
      ) {
        hits.push(entry)
      }
    }
  })
}

if (hits.length) {
  console.error(`✗ i18n-scan：发现 ${hits.length} 处未迁移的 CJK 字面量（015 §8）`)
  for (const h of hits) console.error(`  src/${h.file}:${h.line}  ${h.text}`)
  process.exit(1)
}
console.log('✓ i18n-scan：src/** 无未包裹的 CJK 字面量')
