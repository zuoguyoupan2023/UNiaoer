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

# 1) 本地产物门禁（type-check / layers / index / traits / changelog / tiers 本地版）
npm run verify:push || exit 1

# 2) R2 发布通道版本核对（2026-11-05 事故，见 docs/105）
#    档位分片曾停留在旧 5 档制而无人察觉 → 推送前顺带核对 R2 与本地索引是否同版本。
#    设计为**只警告不阻塞**：前端改动与云端产物同步节奏不同步（见 AGENTS.md 铁律 8），
#    因 R2 落后就拦住代码推送会把两件事绑死。真正的拦截靠人在终端手跑。
echo ""
echo "── R2 发布通道版本核对（只提示，不阻塞）──"
npm run check:tiers -- --verbose >/tmp/uniaoer-check-tiers.log 2>&1
TIERS_RC=$?
if [ "$TIERS_RC" -ne 0 ]; then
  echo "⚠️  R2 与本地索引不一致（详见 /tmp/uniaoer-check-tiers.log）"
  echo "    修：node scripts/push-r2-data.mjs --dir public/data/province-commonness --apply"
  echo "    （云端写，需你在自己的终端里手输确认词；本次推送继续）"
fi
exit 0
`

const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim()
const hookPath = path.resolve(gitDir, 'hooks', 'pre-push')
await fs.mkdir(path.dirname(hookPath), { recursive: true })
await fs.writeFile(hookPath, HOOK, { mode: 0o755 })
await fs.chmod(hookPath, 0o755)
console.log(`✅ 已安装 pre-push 钩子: ${hookPath}`)
console.log('   每次 git push 前会跑 `npm run verify:push`（check:layers + check:traits）。')
console.log('   跳过（不推荐）：git push --no-verify')
