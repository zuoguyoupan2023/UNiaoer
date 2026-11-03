import { describe, it, expect, beforeEach } from 'vitest'
import { pickDistractorPairs, buildNameQuestions, buildSimilarQuestions, clearColorIndexCache, clearS1PickState } from '../questionEngine'
import { clearNameTokenCache } from '../nameTokens'
import { TIERS, L6_TIERS, TIER_LIST, S1_ENABLED } from '../difficulty'
import type { BankSpecies } from '../bank'
import type { MediaAsset } from '@/types'

function asset(id: string, type: 'image' | 'audio'): MediaAsset {
  return {
    id,
    speciesId: id,
    type,
    url: `https://example.test/${id}.${type === 'image' ? 'jpg' : 'mp3'}`,
    license: 'CC-BY',
    licenseUrl: '',
    author: 'tester',
    source: 'iNaturalist',
    sourceUrl: '',
  }
}

function sp(id: string, nameZh: string, nameEn: string, family: string): BankSpecies {
  return {
    id,
    nameZh,
    nameEn,
    nameSci: `${id} scientific`,
    family,
    commonness: 2,
    desc: '',
    location: '',
    habit: '',
    image: asset(id, 'image'),
    audio: asset(id, 'audio'),
  }
}

// 099 §3.1 的回退链四层：同组(白头) / 同色异部位(白腹/白眉) / 同科无色 / 无关
const target = sp('target', '白头鹎', 'Light-vented Bulbul', '鹎科')
const bank: BankSpecies[] = [
  target,
  ...['g1', 'g2', 'g3'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, '其他科')), // 同 (白,头)
  sp('c1', '白腹鸟', 'White-bellied Bird', '其他科'), // 同色异部位
  sp('c2', '白眉鸟', 'White-browed Bird', '鹎科'), // 同色异部位 + 同科
  sp('f1', '鹎科鸟', 'Bulbul Bird', '鹎科'), // 同科无色
  ...['r1', 'r2'].map((id) => sp(id, `杂鸟${id}`, `Misc ${id}`, '杂科')),
]

describe('pickDistractorPairs（nameSimilar 策略 = 引擎能力，供 S1 系模式用）', () => {
  it('同组充足时全部来自同 (色,部位) 组', () => {
    const picked = pickDistractorPairs(target, bank, 3, 'nameSimilar')
    expect(picked.map((p) => p.id).sort()).toEqual(['g1', 'g2', 'g3'])
  })

  it('同组不足 3 → 回退同色，再同科，最后其余（桶间顺序确定）', () => {
    const pool = [target, sp('g0', '白头鸟', 'White-headed Bird', '其他科'), sp('c1', '白腹鸟', 'White-bellied Bird', '甲科'), sp('f1', '鹎科鸟', 'Bulbul Bird', '鹎科'), sp('r1', '杂鸟', 'Misc Bird', '杂科')]
    const picked = pickDistractorPairs(target, pool, 3, 'nameSimilar')
    const ids = picked.map((p) => p.id)
    expect(ids).toContain('g0') // 同组必进
    expect(ids.slice(1)).toEqual(expect.arrayContaining(['c1', 'f1'])) // 第二层同色 + 第三层同科
    expect(ids).not.toContain('r1') // 其余层只在前层不足时才被取到
  })

  it('组内按答案名去重（used 集合），不会推出同名干扰项', () => {
    const pool = [target, target, sp('dup', '白头鹎', 'Light-vented Bulbul', '鹎科'), sp('g1', '白头鸟', 'White-headed Bird', '其他科')]
    const picked = pickDistractorPairs(target, pool, 2, 'nameSimilar')
    expect(picked.map((p) => p.name)).not.toContain('白头鹎')
  })

  it('无 token 的种（八哥类）落回同科/其余层——解析不出不是错误', () => {
    const baghe = sp('myna', '八哥', 'Crested Myna', '椋鸟科')
    const pool = [baghe, sp('s1', '鹩哥', 'Common Hill Myna', '椋鸟科'), sp('r1', '杂鸟', 'Misc', '杂科')]
    const picked = pickDistractorPairs(baghe, pool, 1, 'nameSimilar')
    expect(picked.map((p) => p.id)).toEqual(['s1']) // 同科兜底
  })

  it('中英并集组身份：en 组员能被 zh 答案的组召回（099 §2.6）', () => {
    const zhTarget = sp('t2', '红嘴鸥', 'Black-headed Gull', '鸥科')
    const pool = [
      zhTarget,
      sp('en-mate', '无名氏', 'Black-headed Gull-lookalike', '鸻科'), // en (黑,头) 同组
      sp('zh-mate', '红嘴山鸦', 'Chough', '鸦科'), // zh (红,嘴) 同组
    ]
    const picked = pickDistractorPairs(zhTarget, pool, 2, 'nameSimilar')
    expect(picked.map((p) => p.id).sort()).toEqual(['en-mate', 'zh-mate'])
  })
})

describe('档位配置（2026-11-03 用户拍板：token 相似不混入 L1–L8）', () => {
  it('L1–L6 干扰项策略全部维持原状', () => {
    expect(TIERS[1].distractor).toBe('cross')
    expect(TIERS[2].distractor).toBe('mixed')
    expect(TIERS[3].distractor).toBe('same')
    expect(TIERS[4].distractor).toBe('same')
    expect(TIERS[5].distractor).toBe('same')
    expect(L6_TIERS.image.distractor).toBe('same')
    expect(L6_TIERS.audio.distractor).toBe('same')
  })

  it('S1 = 独立 tier 9，默认不上架、排在 L8 之后', () => {
    expect(TIERS[9].tier).toBe(9)
    expect(TIERS[9].labelKey).toBe('difficulty.s1.label')
    expect(S1_ENABLED).toBe(false)
    expect(TIER_LIST.some((t) => t.tier === 9)).toBe(false)
    expect(TIER_LIST.some((t) => t.tier === 8)).toBe(false) // L8 也未上架
  })

  it('L6 仍 same：token 组员不改变 L6 的同科优先', async () => {
    // 答案锁定 target；同科无色种 5 只 + 跨科同 token 组员 5 只 → L6 干扰项全来自同科。
    // L6 看图 2026-11-03 改为 4 选项（干扰项 3 个），所以不断言「5 个全入选」，
    // 而是断言本质：**干扰项数量按配置、且全部来自同科**（跨科同 token 的 g* 一个都不该出现）。
    const l6bank: BankSpecies[] = [
      target,
      ...['f1', 'f2', 'f3', 'f4', 'f5'].map((id) => sp(id, `鹎科鸟${id}`, `Bulbul ${id}`, '鹎科')),
      ...['g1', 'g2', 'g3', 'g4', 'g5'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, `科${id}`)),
    ]
    const qs = await buildNameQuestions(l6bank, { type: 'image', count: 1, speciesPool: new Set(['target']) })
    expect(qs.length).toBe(1)
    const distractorIds = qs[0]!.optionIds.filter((id) => id !== 'target')
    expect(distractorIds).toHaveLength(L6_TIERS.image.optionCount - 1)
    expect(distractorIds.every((id) => id.startsWith('f'))).toBe(true)
  })
})

describe('buildSimilarQuestions（S1 相似种挑战：色类分组，2026-11-03 用户定）', () => {
  // speciesTokens 按 id 缓存——各用例同 id 不同名会串缓存，先清。
  // 2026-11-03：另有色类索引缓存与跨轮选题状态（sessionStorage），一并清，
  // 否则上一个用例的答案计数会影响本用例的加权随机结果。
  beforeEach(() => {
    clearNameTokenCache()
    clearColorIndexCache()
    clearS1PickState()
  })

  it('大色类分组：全身或局部有某色都算；同色同部位优先回填', async () => {
    // 白组 7 种：6 只白头（同色同部位）+ 1 只白腹（同色异部位）
    // 4 选项门槛 = 同色同伴 ≥3，7 种全部够格当答案
    const s1bank: BankSpecies[] = [
      ...['g0', 'g1', 'g2', 'g3', 'g4', 'g5'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, `科${id}`)),
      sp('c1', '白腹鸟', 'White-bellied Bird', '杂科'),
      sp('x1', '杂鸟', 'Misc Bird', '杂科'), // 无白 token，永不入题
    ]
    const qs = await buildSimilarQuestions(s1bank, { type: 'image', count: 10 })
    expect(qs.length).toBe(7) // 白组 7 种全部可当答案
    for (const q of qs) {
      expect(q.tier).toBe(9)
      expect(q.options.length).toBe(4)
      expect(q.timeLimitSec).toBe(10) // 2026-11-03：4 选项 · 10s
      // 选项 ⊆ 白组（c1/g*），杂鸟绝不出现
      for (const id of q.optionIds) expect(id).not.toBe('x1')
      // 同色同部位优先（无条件断言，两种答案情形结论相同）：
      // 白头鸟答案 → 主 token 是最大的同色同部位组，其余选项全在 g*；
      // 白腹鸟答案 → 无同部位同伴，其余选项全由色组回填（也是 g*）。
      // 答案自身的 id 也在 optionIds 里，单独放行。
      const answerId = q.optionIds[q.options.indexOf(q.answer)] ?? ''
      expect(q.optionIds.every((id) => id === answerId || id.startsWith('g'))).toBe(true)
    }
  })

  it('同色同部位不足 → 同色异部位回填（红耳鹎和红身放一起也可）', async () => {
    const s1bank: BankSpecies[] = [
      sp('target', '红耳鹎', 'Red-whiskered Bulbul', '鹎科'),
      sp('pair1', '红耳鹎二', 'Red-whiskered Bulbul 2', '鹎科'), // 唯一同色同部位同伴
      ...['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => sp(id, `红身鸟${id}`, `Red Bird ${id}`, `科${id}`)), // (红,全身)
    ]
    // speciesPool 锁定答案为红耳鹎（色组 7 种都可当答案，shuffle 会抽别人）
    const qs = await buildSimilarQuestions(s1bank, {
      type: 'image',
      count: 1,
      speciesPool: new Set(['target']),
    })
    expect(qs.length).toBe(1)
    const q = qs[0]!
    expect(q.answer).toBe('红耳鹎')
    expect(q.options).toContain('红耳鹎二') // 同色同部位优先入选
    expect(q.options.length).toBe(4)
  })

  it('色组不足 optionCount 的种不出题（宁缺毋滥）', async () => {
    const smallBank: BankSpecies[] = [
      sp('a1', '白头鸟', 'White-headed Bird', '甲科'),
      sp('a2', '白头鸟二', 'White-headed Bird 2', '乙科'),
      sp('r1', '杂鸟', 'Misc', '杂科'),
    ]
    const qs = await buildSimilarQuestions(smallBank, { type: 'image', count: 10 })
    expect(qs).toEqual([])
  })

  it('nameMode 过滤在前：en 卷只用有英文名的种（051 S1）', async () => {
    const mixed: BankSpecies[] = [
      ...['g0', 'g1', 'g2', 'g3', 'g4', 'g5'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, `科${id}`)),
      sp('noen', '白头无名', '', '科x'), // 无英文名 → en 卷整体不可用
    ]
    const qs = await buildSimilarQuestions(mixed, { type: 'image', count: 1, nameMode: 'en' })
    expect(qs.length).toBe(1)
    for (const id of qs[0]!.optionIds) expect(id).not.toBe('noen')
  })

  it('speciesPool：答案只出池内，干扰项仍取全池同色（013 §4 同构）', async () => {
    const s1bank: BankSpecies[] = [
      ...['g0', 'g1', 'g2', 'g3', 'g4', 'g5'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, `科${id}`)),
      sp('x1', '白头圈外', 'White-headed Outsider', '外科'), // 同色但不在赛制池
    ]
    const pool = new Set(['g0', 'g1', 'g2', 'g3', 'g4', 'g5'])
    const qs = await buildSimilarQuestions(s1bank, { type: 'image', count: 10, speciesPool: pool })
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      const answerIdx = q.options.indexOf(q.answer)
      expect(pool.has(q.optionIds[answerIdx] ?? '')).toBe(true) // 答案必在池内
      for (const id of q.optionIds) expect(id === 'x1' || pool.has(id)).toBe(true) // 选项 ⊆ 池 ∪ 同色圈外
    }
  })

  it('看名选图（name-stem）：名字题干 + 4 张图选项，全部带真实素材', async () => {
    const s1bank: BankSpecies[] = [
      ...['g0', 'g1', 'g2', 'g3', 'g4', 'g5'].map((id) => sp(id, `白头鸟${id}`, `White-headed Bird ${id}`, `科${id}`)),
      // 有 token 但无图 → name-stem 跳过（sp() 默认带图，这里显式置空）
      { ...sp('noimg', '白头无图', 'White-headed Noimg', '科x'), image: null, images: [] },
    ]
    const qs = await buildSimilarQuestions(s1bank, { type: 'image', count: 2, form: 'name-stem' })
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.stemName).toBe(q.answer)
      expect(q.options.length).toBe(4)
      expect(q.optionsMedia?.length).toBe(4)
      for (const m of q.optionsMedia ?? []) expect(m.url).toBeTruthy()
      for (const id of q.optionIds) expect(id).not.toBe('noimg') // 无图候选被跳过
    }
  })

  it('4 选项 / 10s / 0.1s 不隐藏选项（2026-11-03 用户定）', () => {
    expect(TIERS[9].optionCount).toBe(4)
    expect(TIERS[9].timeLimitSec).toBe(10)
    expect(TIERS[9].optionRevealSec).toBe(0.1)
    expect(TIERS[9].timeLimitSecAudio).toBeUndefined() // S1 仅看图
  })
})

// ---------------------------------------------------------------------------
// 2026-11-03 选题策略：跨轮去重（降权不排除）/ 大组加权 / 组内轮换
//
// 这些是**统计性**行为（加权随机），单次抽样无法断言「一定不重复」，
// 所以用「多轮累积的分布」来验证方向性：被降权的一方出现频次应当降低，但**不为零**。
// ---------------------------------------------------------------------------
describe('S1 选题策略（2026-11-03：降权不排除 / 大组加权 / 组内轮换）', () => {
  beforeEach(() => {
    clearNameTokenCache()
    clearColorIndexCache()
    clearS1PickState()
  })

  /** 造一个纯白头组（n 只），保证全部够格当答案 */
  function whiteGroup(n: number): BankSpecies[] {
    return Array.from({ length: n }, (_, i) =>
      sp(`w${i}`, `白头鸟${i}`, `White-headed Bird ${i}`, `科${i}`),
    )
  }

  it('跨轮去重：刚出过的答案概率下降，但**不会被排除**（仍会出现）', async () => {
    const bank = whiteGroup(8) // 8 只全部够格（4 选项门槛=同色同伴≥3）
    // 第 1 轮只出 2 题 → 2 只被标记「刚出过」，另 6 只仍是新面孔，两者都可观察
    const r1 = await buildSimilarQuestions(bank, { type: 'image', count: 2 })
    const firstIds = r1.map((q) => q.optionIds[q.options.indexOf(q.answer)]!)
    expect(firstIds).toHaveLength(2)

    let seenLater = 0
    let freshLater = 0
    for (let k = 0; k < 12; k++) {
      const qs = await buildSimilarQuestions(bank, { type: 'image', count: 2 })
      for (const q of qs) {
        const id = q.optionIds[q.options.indexOf(q.answer)]!
        if (firstIds.includes(id)) seenLater++
        else freshLater++
      }
    }
    // 关键断言：**降权不等于排除**——第一轮出过的鸟后续仍然出现
    expect(seenLater).toBeGreaterThan(0)
    // 且被降权的一方应明显少于新面孔（权重降到 1/2 与 1/3 量级）
    expect(freshLater).toBeGreaterThan(0)
    expect(freshLater).toBeGreaterThan(seenLater)
  })

  it('组内轮换：同一色组连续出题时，答案不会永远是同一只', async () => {
    const bank = whiteGroup(5)
    const answers = new Set<string>()
    for (let k = 0; k < 8; k++) {
      const qs = await buildSimilarQuestions(bank, { type: 'image', count: 1 })
      for (const q of qs) answers.add(q.answer)
    }
    // 8 轮只出 1 题，5 只候选——轮换生效则至少覆盖 2 只以上
    expect(answers.size).toBeGreaterThan(1)
  })

  it('大组加权不会饿死小组：小组的鸟在多轮里仍然出现', async () => {
    // 大组（白 12 只）+ 另一小组（黑 4 只，刚好够 4 选项门槛）
    const bank: BankSpecies[] = [
      ...whiteGroup(12),
      ...['b0', 'b1', 'b2', 'b3'].map((id) => sp(id, `黑身鸟${id}`, `Black Bird ${id}`, `黑科${id}`)),
    ]
    let whiteHits = 0
    let blackHits = 0
    for (let k = 0; k < 20; k++) {
      const qs = await buildSimilarQuestions(bank, { type: 'image', count: 4 })
      for (const q of qs) {
        if (q.answer.startsWith('白头')) whiteHits++
        else if (q.answer.startsWith('黑身')) blackHits++
      }
    }
    // 小组必须有机会（不给它降权），只是概率低于大组
    expect(blackHits).toBeGreaterThan(0)
    expect(whiteHits).toBeGreaterThan(0)
  })
})
