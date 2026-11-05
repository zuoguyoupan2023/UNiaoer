/**
 * 云端写 / 发布类操作的**人工闸门**（2026-11-05 用户定，见 AGENTS.md 铁律 13）。
 *
 * ## 为什么需要它
 *
 * 2026-11 事故：省级档位分片重建为 10 档后**没有推 R2**，线上一直是 5 档旧版，而前端按
 * 10 档过滤 → 所有「×70/80/90%」标注与实际池子不符，持续 7 天无人发现。根因不是技术难，
 * 是**没有任何机制强制"改完产物必须推云端"**，且 `check:sync` 只看 HTTP 200、不比版本。
 *
 * ## 闸门怎么工作
 *
 * 所有会写云端或发布产物的脚本，第一件事调用 `guard()`：
 *
 *   1. **打印计划**（要写什么、影响范围、回滚方式）—— 任何时候都打印，供人审阅；
 *   2. **非 TTY 直接拒绝**（退出码 2）—— AI/CI/管道执行时 stdin 不是 TTY，**物理上无法越过**，
 *      不依赖"AI 自觉"。这满足铁律 13「一律先停下来问」；
 *   3. **TTY 下要求手输操作名**（如 `push province-commonness`）才继续 —— 防手滑，
 *      也让"批准"这个动作留下人机交互痕迹；
 *   4. `--dry` 永远只打印、不执行（默认推荐先跑）。
 *
 * ## 用法
 *
 * ```js
 * import { guard } from './lib/cloud-guard.mjs'
 *
 * await guard({
 *   op: 'push province-commonness',   // 用户需手输的确认词
 *   summary: '把 373 个省级档位分片推到 R2（Worker 出题时读）',
 *   targets: ['r2://uniaoerbucket/data/province-commonness/*'],
 *   impact: '线上出题地区档位立即变化；边缘缓存最长 1 天后全部生效',
 *   rollback: '重传上一版同名对象（R2 无版本）；或 git checkout 旧产物后重推',
 *   dryRunHint: 'node scripts/push-r2-data.mjs --dir public/data/province-commonness --dry',
 * })
 * ```
 */

import readline from 'node:readline'

/** 闸门拒绝时的退出码（与普通失败区分，便于 CI/脚本识别） */
export const EXIT_NEEDS_APPROVAL = 2

const BOLD = (s) => `\x1b[1m${s}\x1b[0m`
const DIM = (s) => `\x1b[2m${s}\x1b[0m`
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`
const RED = (s) => `\x1b[31m${s}\x1b[0m`

/**
 * 打印操作计划（不询问）。也被 `--dry` 路径直接复用。
 */
export function printPlan({ op, summary, targets, impact, rollback, dryRunHint }) {
  console.log('')
  console.log(BOLD('════ 云端 / 发布操作计划 ════'))
  console.log(`  操作　${BOLD(op)}`)
  if (summary) console.log(`  做什么　${summary}`)
  if (targets?.length) {
    console.log('  写入目标　')
    for (const t of targets) console.log(`    · ${t}`)
  }
  if (impact) console.log(`  影响范围　${impact}`)
  if (rollback) console.log(`  回滚方式　${rollback}`)
  if (dryRunHint) console.log(DIM(`  先干跑　${dryRunHint}`))
  console.log(BOLD('════════════════════════════'))
}

/**
 * 人工闸门。通过返回；否则 `process.exit(EXIT_NEEDS_APPROVAL)`。
 *
 * @param {object} opts
 * @param {string} opts.op            操作名（也用作手输确认词，如 'push province-commonness'）
 * @param {string} [opts.summary]     一句话说明做什么
 * @param {string[]} [opts.targets]   写入目标清单
 * @param {string} [opts.impact]      影响范围
 * @param {string} [opts.rollback]    回滚方式
 * @param {string} [opts.dryRunHint]  建议的干跑命令
 * @param {boolean} [opts.dry]        调用方已判定为 dry-run → 只打印不询问
 * @param {boolean} [opts.assumeYes]  显式跳过确认（仅限调用方已确认；不给 CLI 暴露此参数）
 * @returns {Promise<'dry' | 'approved'>}
 */
export async function guard(opts) {
  const { op, dry = false, assumeYes = false } = opts

  printPlan(opts)

  if (dry) {
    console.log(YELLOW('  [dry-run] 只打印计划，未写入任何云端资源。'))
    return 'dry'
  }
  if (assumeYes) {
    console.log(YELLOW('  [assumeYes] 已跳过人工确认（调用方负责）。'))
    return 'approved'
  }

  // ── 核心：非 TTY 一概拒绝 ──────────────────────────────────────
  // AI 的 Bash 工具、CI runner、`| tee`、`nohup` 都不是 TTY → 永远走这一支。
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('')
    console.error(RED('  ✗ 拒绝执行：这不是交互式终端（stdin/stdout 非 TTY）。'))
    console.error('')
    console.error('    云端写 / 发布类操作必须由**人在终端里**亲自批准执行（AGENTS.md 铁律 13）。')
    console.error('    自动化（AI、CI、管道、后台任务）不得代跑。')
    console.error('')
    console.error(`    请你在自己的终端里执行，并按要求手输确认词：`)
    console.error(`      ${BOLD(op)}`)
    console.error('')
    console.error(DIM('    只准备产物、不写云端 → 加 --dry 先看清单。'))
    process.exit(EXIT_NEEDS_APPROVAL)
  }

  // ── TTY：要求手输确认词 ───────────────────────────────────────
  const ok = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(
      `\n  ${BOLD('确认执行请输入')} ${YELLOW(op)} ${BOLD('（其它任何输入都会取消）：')}\n  > `,
      (answer) => {
        rl.close()
        resolve(String(answer ?? '').trim() === op)
      },
    )
  })

  if (!ok) {
    console.error(RED('\n  ✗ 确认词不匹配，已取消，未写入任何云端资源。'))
    process.exit(EXIT_NEEDS_APPROVAL)
  }
  console.log('')
  return 'approved'
}

/**
 * 便捷包装：解析 `--dry` 语义并调用 guard。
 * `--apply` 缺省即 dry（默认安全），避免"不小心就写了云端"。
 */
export async function guardFromArgs(args, opts) {
  const dry = !args.apply || !!args.dry
  return guard({ ...opts, dry })
}
