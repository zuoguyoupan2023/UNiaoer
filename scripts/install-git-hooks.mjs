#!/usr/bin/env node
/**
 * F1（`docs/063 §1.5` 方案 C）：安装本地 git 钩子。
 *
 * 背景（2026-10-19 事故）：**Cloudflare Pages 不等待 GitHub Actions** ——
 * `git push` 一落地 Pages 就自己构建发布，CI 是并行跑的；所以 `check:layers`
 * 在 CI 里红了**也拦不住上线**。防线只能放在**推送前**。
 *
 * 本脚本写 `.git/hooks/pre-push`，让每次 push 前跑 `npm run verify:push`
 * （= `check:layers` + `check:traits`，秒级；产物类改动最关键的两道门禁）。
 *
 * `.git/hooks/` 不入库 → 换机/重新 clone 后重跑一次：`npm run hooks:install`。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const HOOK = `#!/bin/sh
# 由 scripts/install-git-hooks.mjs 生成（npm run hooks:install）。
# CI 不阻塞 Cloudflare Pages 部署（2026-10-19 事故，见 docs/063）→ 推送前必须本地跑门禁。
cd "$(git rev-parse --show-toplevel)" || exit 1
exec npm run verify:push
`

const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim()
const hookPath = path.resolve(gitDir, 'hooks', 'pre-push')
await fs.mkdir(path.dirname(hookPath), { recursive: true })
await fs.writeFile(hookPath, HOOK, { mode: 0o755 })
await fs.chmod(hookPath, 0o755)
console.log(`✅ 已安装 pre-push 钩子: ${hookPath}`)
console.log('   每次 git push 前会跑 `npm run verify:push`（check:layers + check:traits）。')
console.log('   跳过（不推荐）：git push --no-verify')
