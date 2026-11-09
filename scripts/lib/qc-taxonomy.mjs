/**
 * QC 判定口径 · 唯一真源（2026-11-09 用户定）
 *
 * 对应 SOP `docs/000-SOP-媒体纠错标准流程.md` §S3.1 / §S3.1a / §S3.1c。
 * **任何 QC 脚本都必须 import 这里，不许各写一套标签**——2026-11-09 发现
 * 批次 1（首图）与批次 2（2~5 张）脚本各有一份 rubric，口径已经开始漂移。
 *
 * 核心原则：**AI 只有一种处置权 —— 判定「画面里没有一只可辨认的鸟」。**
 * 其余一切（模糊、低像素、主体小、水印、构图）都只记录，交人判定。
 *
 * 四态（bucket）：
 *   exclude  机器可直接排除（S3.1 的 6 条，全是「没有可辨认的鸟」）
 *   human    必须交用户判定（S3.1a 的 5 条 + S3.1c 列表）
 *   species  怀疑不是这个物种（S3.1c，只报告，绝不排除）
 *   pass     无明显问题
 * 另有两个非判定态：`missing`（取不到图，运维问题）、`error`（调用失败，可重试）
 */

/** 机器标签 → 分桶。顺序即优先级：一条图命中多个标签时取最靠前的桶。 */
export const LABEL_BUCKET = {
  // —— exclude：S3.1 六条（画面里没有可辨认的鸟）——
  non_bird: 'exclude',
  with_human: 'exclude',
  egg: 'exclude',
  specimen: 'exclude',
  occluded: 'exclude',
  blurry_severe: 'exclude',
  // 手绘图/插图/图鉴扫描：不是「这只鸟的照片」，作为辨识题面会教错人
  // （2026-11-09 实测：大海雀首图是一张有画家签名的水彩插图，旧 rubric 判了 pass）
  illustration: 'exclude',

  // —— human：S3.1a 五条 + S3.1c 列表（AI 不许判排除）——
  low_res: 'human',
  blurry: 'human',
  tiny_bird: 'human',
  crop_bad: 'human',
  watermark: 'human',

  // —— species：S3.1c 只报告 ——
  wrong_species: 'species',
}

/** 桶的优先级：一条图同时命中多个标签时，用最靠前的桶定性。 */
export const BUCKET_ORDER = ['exclude', 'human', 'species', 'pass', 'missing', 'error']

/**
 * 旧标签 → 新标签的迁移映射（批次 1 回填用，避免重跑 API）。
 * 语义变化处一律往「更保守」的方向走：原本 reject 的现在可能变 human。
 */
export const LEGACY_LABEL = {
  non_bird: 'non_bird',
  occluded: 'occluded',
  blurry: 'blurry', // 旧脚本里 blurry 混杂了「严重」和「一般」，统一降为 human
  tiny_bird: 'tiny_bird',
  crop_bad: 'crop_bad',
  watermark: 'watermark',
  wrong_species: 'wrong_species',
}

/** 新标签（旧 rubric 完全没有，需要重判才能拿到） */
export const NEW_LABELS = ['specimen', 'illustration', 'egg', 'with_human', 'blurry_severe', 'low_res']

/** 把一组标签归到一个桶；空标签 = pass。 */
export function bucketOf(labels) {
  let best = 'pass'
  for (const l of labels || []) {
    const b = LABEL_BUCKET[l]
    if (!b) continue
    if (BUCKET_ORDER.indexOf(b) < BUCKET_ORDER.indexOf(best)) best = b
  }
  return best
}

/**
 * 最终定桶：在 bucketOf 之上加一条 `occluded` 专用规则。
 *
 * `occluded` 是唯一一个「判据靠主观」的排除标签——「被挡到什么程度才算看不出鸟形」没有客观阈值。
 * 2026-11-09 校准验收：12 张 exclude 里挑 6 张亲自看，其中 1 张是误杀
 * （`amaurolimnas-concolor` #3：鸟的身体轮廓和红腿都清楚，只是头部被叶子挡住、画质差）。
 * 按这个比例，全量 4 万张里会有上千张被 AI 错误排除。
 *
 * 所以：
 *   - `occluded` **单独出现**时，降为 human（交人判，不自动排除）
 *   - `occluded` 与硬标签同时出现（non_bird / with_human / specimen / egg / illustration）时，
 *     按硬标签排除（那种情况下 AI 已经确认「画面里没有鸟」）
 *
 * 这条规则不影响其它标签：`non_bird` / `with_human` / `specimen` / `illustration` /
 * `egg` / `blurry_severe` 单独出现仍然直接排除。
 */
const HARD_EXCLUDE = ['non_bird', 'with_human', 'specimen', 'illustration', 'egg', 'blurry_severe']

export function finalBucket(labels) {
  const clean = cleanLabels(labels)
  if (!clean.length) return 'pass'
  const hasHard = clean.some((l) => HARD_EXCLUDE.includes(l))
  const hasOccluded = clean.includes('occluded')
  if (hasOccluded && !hasHard) return 'human' // 只有 occluded → 交人判
  return bucketOf(clean)
}

/** 统计用的桶中文名（只给人看，不进 UI）。 */
export const BUCKET_LABEL_ZH = {
  exclude: '可排除',
  human: '待你判',
  species: '种疑',
  pass: '通过',
  missing: '取不到',
  error: '调用失败',
  pending: '未判',
}

/** 老 verdict（pass/suspect/reject）→ 桶。suspect 一律进 human（AI 没把握就不排除）。 */
export function bucketOfLegacy(verdict, reasons) {
  if (verdict === 'missing') return 'missing'
  if (verdict === 'error') return 'error'
  if (verdict === 'pass') return 'pass'
  if (verdict === 'suspect') return 'human'
  // reject：按理由重新归位
  const mapped = (reasons || []).map((r) => LEGACY_LABEL[r]).filter(Boolean)
  if (!mapped.length) return 'human' // 理由认不出 → 不排除，交人
  return bucketOf(mapped)
}

/** 给模型的判定指令（两批共用；只有「出题用图 / 展示首图」这一句不同）。 */
export function rubric({ zh, sci, slot, purpose }) {
  const who = `${zh || sci}${zh && sci ? `（${sci}）` : ''}`
  return `你是鸟类图片质检员。判断这张图是否适合作为「${who}」的${purpose}${slot ? `（第 ${slot} 张素材）` : ''}。

**第一步：判断这张图是什么来源。这是最重要的一步，先做它。**
- A. 相机拍的活鸟 → 继续第二步
- B. 博物馆标本 / 剥制标本 / 骨骼 / 标本架 / 标本柜 → verdict="exclude"，labels=["specimen"]，**到此为止**
- C. 手绘图 / 水彩 / 版画 / 图鉴插图 / 邮票 / 卡通 → verdict="exclude"，labels=["illustration"]，**到此为止**
- D. 画面里根本没有鸟（风景/空枝/梗图/毛绒玩具/截图）→ verdict="exclude"，labels=["non_bird"]，**到此为止**

**为什么 B 和 C 也算「没有鸟」**：标本是死鸟的皮囊或骨头，插画是画出来的，两者都不是「这只鸟活着时的样子」。
用来出题会让人把标本的僵硬姿态、插画师的艺术处理当成识别特征。**哪怕拍得再清楚、画得再逼真，也要排除。**

**第二步（只有 A 才做）：这只鸟看得清吗？**
- tiny_bird：占比小、距离远，但看得清是一只鸟（能指认头/身/尾）
- blurry：能看出轮廓/头身尾，但对焦软、有噪点、看不清羽色细节
- crop_bad：头或尾被画框切掉，但整体还认得出
- watermark：明显水印、文字贴图、截图边框
- low_res：分辨率不足

**这些一律不算排除**（只记录，交人判）：
- 鸟很小、很模糊、被枝叶挡了一部分、带水印 → labels 照写，但 verdict="human"
- 生境照、剪影、逆光、幼鸟、雌鸟、非繁殖羽、洞穴巢群 → verdict="pass" 或 "human"，**不要 exclude**

**第三步：怀疑不是这个物种**
- wrong_species：**仅当你确信**主体明显不是 ${sci}。亚种、羽色、雌雄异型、幼鸟、换羽个体一律不要给。不确定不要给。
- 此时 verdict="species"（只报告，不排除）

**只有这四种情况才可以 exclude**（判据是「画面里没有一只能认出来的鸟」）：
- with_human：人和鸟同框（手抓、手持、环志特写、自拍、人腿人身入画）
- egg：鸟蛋、巢中蛋、无壳蛋，或**只有鸟巢没有鸟**
- occluded：**枝叶把鸟切到只剩零星色块 / 一小段身体 / 只露尾羽，认不出这是一只鸟**。
  ⚠️ 判据是「还能不能看出这是一只鸟」，**不是「被挡了多少」**：
  - 鸟站在植物间、枝条穿过画面但鸟的**头、身、尾都能指认** → **不是 occluded**，最多给 tiny_bird
  - 金丝燕类在洞穴里的巢群照、只露尾羽的个体 → **不是 occluded**（SOP §S3.1a 明确允许这类降级采用），给 human
  - 真要 exclude，应该是「整张图里我只能看到一块不知是什么的羽毛/色块」
- blurry_severe：虚化到只剩一团色斑，**连轮廓都没有**

**自检（给 exclude 之前必做）**：
1. 如果你的 note 里出现了「主体清晰」「能识别」「可见」「可辨」「能指认」这类词，
   那就**不能给 exclude** —— 说明你看得见鸟，应该给 pass 或 human。
2. 如果这张图属于「鸟在洞穴/巢群/生境里、主体小、被枝叶穿插」，**先想 SOP §S3.1a**：
   这些是允许降级采用的素材，不是坏图。给 human。
3. 问自己：「我能指着画面说『这里有一只鸟』吗？」
   - 能 → 不是 exclude
   - 不能（只看到一片羽毛、一个色块、一个巢）→ 可以 exclude

（2026-11-09 校准实测：旧版措辞下 occluded 占了 exclude 的 2/3，抽查 4 张有 2 张是误杀——
鸟清晰可辨但站在植物间、金丝燕巢只露尾羽，都被判了排除。以上自检条款即为此加。）

**输出格式**：verdict 必须是 exclude / human / species / pass 之一，**不要写标签名**。
- 一开始判成 B/C/D → verdict="exclude"
- 只查出第二步的问题（小/模糊/裁切/水印）→ verdict="human"
- 什么都没有 → verdict="pass"

只输出严格 JSON，无其它文字：
{"verdict":"exclude|human|species|pass","labels":["…"],"note":"不超过20字"}`
}

/** 过滤掉非标签内容（模型偶尔把 rubric 说明文字填进 labels）。 */
export function cleanLabels(labels) {
  return (labels || []).filter((l) => typeof l === 'string' && LABEL_BUCKET[l])
}

/**
 * 自相矛盾检测：模型给的 note 明显在说「这是活鸟、主体清晰」，
 * 却同时给了 specimen / illustration / non_bird 这类「画面里没有真鸟」的标签。
 *
 * 2026-11-09 实测（批次 2 校准）：`aquila-chrysaetos` #3 标了 `specimen`，
 * note 却写「相机拍摄的活鸟，主体清晰可辨」；`artamus-leucorynchus` 同样。
 *
 * 处理：**不信标签，信 note**——把这类标签剔掉，并把整条记录降级为 human（交人看一眼），
 * 因为这种情况下模型自己也没拿准，不该由它定排除。
 *
 * @returns {{labels: string[], conflicted: boolean}}
 */
export function reconcileWithNote(labels, note) {
  const clean = cleanLabels(labels)
  const n = String(note || '')
  // note 里出现这些词 = 模型承认画面里有一只清楚的真鸟
  // 必须先排除否定式（「非活鸟」「不是活鸟」），否则「剥制标本，非活鸟」会被误判成矛盾
  const negated = /非活鸟|不是活鸟|非鸟|没有鸟|无鸟|不是鸟|非相机拍摄|非照片|并非活体|看不到鸟|认不出/.test(n)
  const saysRealBird =
    !negated &&
    /相机拍摄的活鸟|活鸟|主体清晰|清晰可辨|清晰可见|可识别|能识别|能指认|指认主体|可辨|recognizable|identifiable|can be identified/i.test(n)
  if (!saysRealBird) return { labels: clean, conflicted: false }
  // 只跟「画面里没有真鸟/看不出鸟形」这类标签冲突
  const contradicts = ['specimen', 'illustration', 'non_bird', 'egg', 'occluded', 'blurry_severe', 'with_human']
  const kept = clean.filter((l) => !contradicts.includes(l))
  return { labels: kept, conflicted: kept.length !== clean.length }
}

/** 合并主判与复判。
 *
 * **取严，但只对 exclude 取严。**（2026-11-09 第二轮修正）
 *
 * 背景：`glm-4v-flash` 对「柔焦/浅景深」极度敏感，几乎每张图都给 `blurry`；
 * 实测一张鸟占画面 40%、羽色锐利的雪地朱顶雀也被它判 blurry。
 * 如果 human 也取严，这批噪声会把 80% 的图推进 human 桶，等于没筛。
 *
 * 规则：
 *   - 任一方判 exclude → exclude（漏掉坏图的代价最大，宁严）
 *   - 否则任一方判 species → species（种疑只报告，不影响可用性）
 *   - 否则任一方判 human → human（交人判，但仅当另一方不是 pass 时）
 *     若一方 pass、一方 human：以 **pass 为准**，但把 human 的标签留在 labels 里
 *     供人工复核页筛选 —— 不进 human 桶，不占用户时间。
 *   - 双方都 pass → pass
 */
export function mergeBuckets(primaryBucket, primaryLabels, secondaryBucket, secondaryLabels) {
  const labels = [...new Set([...(primaryLabels || []), ...(secondaryLabels || [])])].filter(
    (l) => typeof l === 'string' && LABEL_BUCKET[l],
  )
  if (primaryBucket === 'exclude' || secondaryBucket === 'exclude') {
    // 同上：只有 occluded、没有硬标签 → 交人判（见 finalBucket 的注释）
    const hard = labels.filter((l) => HARD_EXCLUDE.includes(l))
    if (!hard.length && labels.includes('occluded')) return { bucket: 'human', labels: ['occluded'] }
    return { bucket: 'exclude', labels: labels.filter((l) => LABEL_BUCKET[l] === 'exclude') }
  }
  if (primaryBucket === 'species' || secondaryBucket === 'species') {
    return { bucket: 'species', labels: labels.filter((l) => LABEL_BUCKET[l] === 'species') }
  }
  // human vs pass → pass（只留标签供筛选，不占用户时间）
  // human vs human → human（两个模型都觉得有问题，那确实值得看一眼）
  if (primaryBucket === 'human' && secondaryBucket === 'human') {
    return { bucket: 'human', labels: labels.filter((l) => LABEL_BUCKET[l] === 'human') }
  }
  // pass：保留 human 类标签（复核页可筛选「被一方判过模糊的」，但默认不占时间）
  return { bucket: 'pass', labels: labels.filter((l) => LABEL_BUCKET[l] === 'human') }
}

/** 从模型返回的 verdict + labels 里挑出最终桶（模型可能自相矛盾，用标签说了算）。 */
export function resolveBucket(verdict, labels) {
  // 只认已知标签：模型偶尔会把 rubric 里的说明文字当标签填进来
  // （实测批次 2：labels 里出现 "相机拍的活鸟"，那是第一步的选项描述，不是标签）
  const clean = cleanLabels(labels)
  // 模型常把标签名填进 verdict 字段（实测 glm-4v-flash 会返回 {"verdict":"specimen"}）
  if (LABEL_BUCKET[verdict]) return finalBucket([verdict, ...clean])
  if (verdict === 'pass') return clean.length ? finalBucket(clean) : 'pass'
  if (verdict === 'missing' || verdict === 'error') return verdict
  // 只要 labels 里有排除类标签，就以它为准（模型 verdict 写 pass 也不放过）
  if (clean.length) return finalBucket(clean)
  if (verdict === 'species') return 'species'
  return 'human'
}
