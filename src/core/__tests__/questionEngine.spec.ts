import { describe, it, expect } from 'vitest'
import { assetsOf, buildQuestions, pickDistractors, shuffle } from '../questionEngine'
import { isStarterBird } from '../starterBirds'
import { TIER_LIST, TIERS } from '../difficulty'
import { suggestTier } from '../adaptive'
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

function sp(
  id: string,
  nameZh: string,
  family: string,
  has: { img?: boolean; aud?: boolean; commonness?: number } = {},
): BankSpecies {
  return {
    id,
    nameZh,
    nameSci: `${id} scientific`,
    family,
    commonness: has.commonness ?? 2,
    desc: '',
    location: '',
    habit: '',
    image: has.img === false ? null : asset(id, 'image'),
    audio: has.aud === false ? null : asset(id, 'audio'),
  }
}

const bank: BankSpecies[] = [
  sp('a', '甲鸟', '甲科'),
  sp('b', '乙鸟', '甲科'),
  sp('c', '丙鸟', '乙科'),
  sp('d', '丁鸟', '乙科'),
  sp('e', '戊鸟', '丙科'),
  sp('noimg', '无图鸟', '丁科', { img: false }),
]

describe('buildQuestions', () => {
  it('只使用具备所需媒体的物种', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 10 })
    expect(qs.every((q) => q.type === 'image')).toBe(true)
    expect(qs.find((q) => q.answer === '无图鸟')).toBeUndefined()
    expect(qs.length).toBe(5)
  })

  it('音频模式只取有音频的物种', () => {
    const qs = buildQuestions(bank, { type: 'audio', count: 10 })
    expect(qs.length).toBe(6)
  })

  it('每题选项包含正确答案且无重复，数量不超过档位配置', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 10, tier: 2 })
    for (const q of qs) {
      expect(q.options).toContain(q.answer)
      expect(new Set(q.options).size).toBe(q.options.length)
      expect(q.options.length).toBeLessThanOrEqual(TIERS[2].optionCount)
    }
  })

  it('携带学名与科，便于反馈展示', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 1 })
    expect(qs[0]!.sci).toContain('scientific')
    expect(qs[0]!.family).toBeTruthy()
  })

  it('数量受 count 限制', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 2 })
    expect(qs.length).toBe(2)
  })

  it('A2 speciesPool：只从指定集合出题，干扰项仍可来自全库', () => {
    const ids = new Set(['a', 'c'])
    const qs = buildQuestions(bank, { type: 'image', count: 10, speciesPool: ids })
    expect(qs.length).toBe(2)
    expect(qs.every((q) => ['a', 'c'].includes(q.media.speciesId))).toBe(true)
    // 干扰项不限于错题池（否则选项太少）
    const allOpts = qs.flatMap((q) => q.options)
    expect(allOpts.length).toBeGreaterThan(new Set(qs.map((q) => q.answer)).size)
  })

  it('A2 speciesPool 命中无素材物种时被过滤，可能为空', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 10, speciesPool: new Set(['noimg']) })
    expect(qs.length).toBe(0)
  })
})

/**
 * 036：地区档位（省级常见度）参与档位筛选。
 * 语义（2026-10-09 定稿，D-036-8）：表里有该物种 → 用地区档位；
 * 表里没有 → **视为本地罕见，不参与档位筛选**（排除式，不回退全局 commonness）；
 * 表内不足 count → 放宽到"表内任意档位"（仍排除表外物种）；表内全空才兜底整池（绝不出空）。
 */
describe('buildQuestions · regionTiers（036 地区档位）', () => {
  it('地区档位覆盖全局档位：本地稀有（5 档）不被 L1 选中（严格档位足够时）', () => {
    // 全部 5 种全局都是 commonness=2（L1 允许 [1,2]）→ 不加 regionTiers 时 L1 都有资格
    const noRegion = buildQuestions(bank, { type: 'image', count: 4, tier: 1 })
    expect(noRegion.length).toBeGreaterThan(0)

    // 表内 a..d 是 1–2 档（4 种 ≥ count），e 本地 5 档 → L1 严格池不含 e（不应放宽）
    const regionTiers = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 1],
      ['d', 2],
      ['e', 5],
    ])
    for (let i = 0; i < 12; i++) {
      const qs = buildQuestions(bank, { type: 'image', count: 4, tier: 1, regionTiers })
      expect(qs.some((q) => q.media.speciesId === 'e')).toBe(false)
    }
  })

  it('表外物种不回退全局档位：本地没有的鸟不出题（长尾鹦鹉场景）', () => {
    // 地区表只含 a/b/c；d/e 不在表里（= 该地区罕见/无记录）。
    // 旧语义下 d/e 会因全局 commonness=2 混进 L2；新语义必须排除。
    const regionTiers = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
    for (let i = 0; i < 20; i++) {
      const qs = buildQuestions(bank, { type: 'image', count: 3, tier: 2, regionTiers })
      const ids = qs.map((q) => q.media.speciesId)
      expect(ids.every((id) => ['a', 'b', 'c'].includes(id))).toBe(true)
      expect(ids).not.toContain('d')
      expect(ids).not.toContain('e')
    }
  })

  it('表内严格档位不足 count → 放宽到表内其余档位（仍不出表外物种）', () => {
    // L1 允许 [1,2]；表内只有 a(1)；b/c/d/e 不在表内 → 放宽到表内任意档位仍是 {a}
    const regionTiers = new Map([['a', 1]])
    const qs = buildQuestions(bank, { type: 'image', count: 4, tier: 1, regionTiers })
    expect(qs.length).toBe(1)
    expect(qs[0]!.media.speciesId).toBe('a')
  })

  it('地区表存在但全表为空 → 兜底整池（绝不出空）', () => {
    // 空 Map 走全局语义（与"无表"等价）
    const qs = buildQuestions(bank, { type: 'image', count: 4, tier: 2, regionTiers: new Map() })
    expect(qs.length).toBeGreaterThan(0)
  })

  it('regionTiers 把表内物种全标为稀有 → 放宽到表内任意档位，仍能出题（绝不出空）', () => {
    const regionTiers = new Map(bank.map((s) => [s.id, 5]))
    const qs = buildQuestions(bank, { type: 'image', count: 4, tier: 1, regionTiers })
    expect(qs.length).toBeGreaterThan(0) // 放宽到表内全部（不引入表外物种）
    expect(qs.every((q) => regionTiers.has(q.media.speciesId))).toBe(true)
  })

  it('null / 缺省等价于不使用地区档位', () => {
    const a = buildQuestions(bank, { type: 'image', count: 4, tier: 2, regionTiers: null })
    const b = buildQuestions(bank, { type: 'image', count: 4, tier: 2 })
    expect(a.length).toBe(b.length)
  })

  it('轮内不重复：同一轮里每只鸟最多出现一次', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 10, tier: 2 })
    const ids = qs.map((q) => q.media.speciesId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('分档取材 (mediaPoolSize)', () => {
  function multi(size: number): BankSpecies {
    return {
      ...sp('multi', '多材鸟', '甲科'),
      image: null,
      images: Array.from({ length: size }, (_, i) => asset(`multi-img-${i}`, 'image')),
    }
  }

  it('assetsOf 优先多素材数组', () => {
    expect(assetsOf(multi(5), 'image').length).toBe(5)
  })

  it('L1 只用首选素材（标准照）', () => {
    const qsBank = [multi(5)]
    for (let i = 0; i < 10; i++) {
      const qs = buildQuestions(qsBank, { type: 'image', count: 1, tier: 1 })
      expect(qs[0]!.media.id).toBe('multi-img-0')
    }
  })

  it('L4 只在前 5 个素材内随机（不会用到第 6 个及以后）', () => {
    const qsBank = [multi(8)]
    const allowed = new Set(Array.from({ length: 5 }, (_, i) => `multi-img-${i}`))
    for (let i = 0; i < 30; i++) {
      const qs = buildQuestions(qsBank, { type: 'image', count: 1, tier: 4 })
      expect(allowed.has(qs[0]!.media.id!)).toBe(true)
    }
  })

  it('素材不足时按实际数量，不报错', () => {
    const qs = buildQuestions([multi(2)], { type: 'image', count: 1, tier: 5 })
    expect(qs[0]!.media).toBeTruthy()
  })

  it('C3：题目带同种全部素材（画廊不按档位裁剪），且当前题面在其中', () => {
    // 即便 L1（出题只用第 1 个），画廊仍应拿到全部素材
    const qs = buildQuestions([multi(5)], { type: 'image', count: 1, tier: 1 })
    expect(qs[0]!.assets).toHaveLength(5)
    expect(qs[0]!.assets!.some((m) => m.url === qs[0]!.media.url)).toBe(true)
  })

  it('C3：跨类型素材也一并提供（看图听音 / 听音看图）', () => {
    const species: BankSpecies = {
      ...sp('dual', '双材鸟', '甲科'),
      image: null,
      audio: null,
      images: Array.from({ length: 5 }, (_, i) => asset(`dual-i${i}`, 'image')),
      audios: Array.from({ length: 5 }, (_, i) => asset(`dual-a${i}`, 'audio')),
    }
    const qs = buildQuestions([species], { type: 'image', count: 1, tier: 1 })
    expect(qs[0]!.assets).toHaveLength(5)
    expect(qs[0]!.crossAssets).toHaveLength(5)
  })
})

describe('难度梯度', () => {
  it('L1 选项数为 3、限时 25s', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 1 })
    expect(qs[0]!.options.length).toBe(3)
    expect(qs[0]!.timeLimitSec).toBe(25)
    expect(qs[0]!.tier).toBe(1)
  })

  it('L4 限时 10s，且选项数多于 L1', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 4 })
    expect(qs[0]!.timeLimitSec).toBe(10)
    expect(qs[0]!.options.length).toBeGreaterThan(3)
    expect(qs[0]!.options.length).toBeLessThanOrEqual(TIERS[4].optionCount)
  })

  it('常见度不足时回退到全部物种（不会空题）', () => {
    // bank 里都是 commonness=2，L4 只允许 3-4，应回退而不是返回空
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 4 })
    expect(qs.length).toBeGreaterThan(0)
  })

  it('L5 地狱：L4 规格（6 选项、8s 限时），题目正常生成', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 5 })
    expect(qs.length).toBeGreaterThan(0)
    expect(qs[0]!.tier).toBe(5)
    expect(qs[0]!.timeLimitSec).toBe(10)
    for (const q of qs) {
      expect(q.options.length).toBeLessThanOrEqual(TIERS[5].optionCount)
      expect(q.options).toContain(q.answer)
    }
  })
})

describe('pickDistractors', () => {
  it('mixed：优先放 1 个同科，且不含答案', () => {
    const target = bank[0]! // 甲鸟 / 甲科
    const names = pickDistractors(target, bank, 3, 'mixed')
    expect(names).not.toContain('甲鸟')
    expect(names[0]).toBe('乙鸟')
    expect(names.length).toBe(3)
  })

  it('cross：优先跨科（不同科在前）', () => {
    const target = bank[0]! // 甲科
    const names = pickDistractors(target, bank, 2, 'cross')
    // 乙鸟同科应排后，跨科的丙/丁/戊在前
    expect(names[0]).not.toBe('乙鸟')
  })

  it('same：同科优先', () => {
    const target = bank[0]!
    const names = pickDistractors(target, bank, 2, 'same')
    expect(names[0]).toBe('乙鸟')
  })
})

describe('options 与 optionIds 配对（015 #1）', () => {
  it('optionIds 与 options 等长且一一对应物种', () => {
    const qs = buildQuestions(bank, { type: 'image', count: 5, tier: 2 })
    for (const q of qs) {
      expect(q.optionIds).toHaveLength(q.options.length)
      const ai = q.options.indexOf(q.answer)
      expect(q.optionIds[ai]).toBe(bank.find((b) => b.nameZh === q.answer)?.id)
      for (let i = 0; i < q.options.length; i++) {
        expect(bank.find((b) => b.id === q.optionIds[i])).toBeDefined()
      }
    }
  })
})

describe('shuffle', () => {
  it('不改变元素集合', () => {
    const src = [1, 2, 3, 4, 5]
    expect([...shuffle(src)].sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('buildQuestions · starterOnly（新手福利，2026-10-09）', () => {
  const starterBank: BankSpecies[] = [
    sp('pica-serica', '喜鹊', '鸦科'),
    sp('passer-montanus', '麻雀', '雀科'),
    sp('pycnonotus-sinensis', '白头鹎', '鹎科'),
    sp('corvus-macrorhynchos', '大嘴乌鸦', '鸦科'),
    sp('egretta-garzetta', '小白鹭', '鹭科'),
    sp('nycticorax-nycticorax', '夜鹭', '鹭科'),
    sp('random-bird-a', '陌生鸟A', '某科'),
    sp('random-bird-b', '陌生鸟B', '某科'),
    sp('random-bird-c', '陌生鸟C', '某科'),
    sp('random-bird-d', '陌生鸟D', '某科'),
    sp('random-bird-e', '陌生鸟E', '某科'),
  ]

  it('L1 + starterOnly：只出新手池物种（喜鹊/麻雀/白头鹎…）', () => {
    for (let i = 0; i < 12; i++) {
      const qs = buildQuestions(starterBank, { type: 'image', count: 4, tier: 1, starterOnly: true })
      expect(qs.length).toBe(4)
      expect(qs.every((q) => isStarterBird(q.media.speciesId))).toBe(true)
    }
  })

  it('池内不足一轮 → 回退常规 L1（绝不出空）', () => {
    // 新手池只有 6 只，但要 7 题 → 收窄不成立，放行常规池
    const qs = buildQuestions(starterBank, { type: 'image', count: 7, tier: 1, starterOnly: true })
    expect(qs.length).toBe(7)
    expect(qs.some((q) => !isStarterBird(q.media.speciesId))).toBe(true)
  })

  it('仅 L1 生效：L2 带 starterOnly 不改变行为', () => {
    const a = buildQuestions(starterBank, { type: 'image', count: 6, tier: 2, starterOnly: true })
    const b = buildQuestions(starterBank, { type: 'image', count: 6, tier: 2 })
    expect(a.length).toBe(b.length)
  })

  it('与地区档位叠加：表内非新手鸟不因 starterOnly 泄漏，表外新手鸟仍被地区排除', () => {
    // 新手池 6 种；地区表只含 4 种（其中 1 只非新手鸟）→ 先收窄新手池，再按地区档位筛
    const regionTiers = new Map([
      ['pica-serica', 1],
      ['passer-montanus', 1],
      ['pycnonotus-sinensis', 2],
      ['corvus-macrorhynchos', 1],
    ])
    const qs = buildQuestions(starterBank, { type: 'image', count: 3, tier: 1, starterOnly: true, regionTiers })
    expect(qs.length).toBe(3)
    expect(qs.every((q) => ['pica-serica', 'passer-montanus', 'pycnonotus-sinensis', 'corvus-macrorhynchos'].includes(q.media.speciesId))).toBe(true)
  })

  it('本地新手鸟不足一轮 → 回退常规本地 L1（保 10 题，不出短轮）', () => {
    // 地区表只含 2 只新手鸟（AU-NT 场景）→ 新手池撑不满 10 题 → 用本地全池出满 10 题
    const regionTiers = new Map([
      ['pica-serica', 1],
      ['passer-montanus', 1],
      ['random-bird-a', 3],
      ['random-bird-b', 4],
      ['random-bird-c', 2],
      ['random-bird-d', 3],
      ['random-bird-e', 2],
    ])
    for (let i = 0; i < 10; i++) {
      const qs = buildQuestions(starterBank, { type: 'image', count: 7, tier: 1, starterOnly: true, regionTiers })
      expect(qs.length).toBe(7) // 仍是满轮
      // 且全部来自本地表（新手池不足时不得把表外新手鸟塞进来）
      expect(qs.every((q) => regionTiers.has(q.media.speciesId))).toBe(true)
    }
  })
})

/** 045：L6「非人级别 NOT-HUMAN Level」——选项与答案只用拉丁学名，其余设置同 L5 */
describe('L6 非人级别', () => {
  // 复用文件顶部的 bank 夹具（6 种、含中英文名与学名）
  const starterBank = bank

  it('选项与答案全部为拉丁学名，且不含任何中文/英文俗名', () => {
    const qs = buildQuestions(starterBank, { type: 'image', count: 5, tier: 6 })
    expect(qs.length).toBeGreaterThan(0)
    const sci = new Set(starterBank.map((s) => s.nameSci))
    for (const q of qs) {
      expect(q.nameMode).toBe('sci')
      expect(sci.has(q.answer)).toBe(true)
      expect(q.options.every((o) => sci.has(o))).toBe(true)
      expect(q.answer).toBe(q.sci) // 答案就是学名本身（不出现俗名）
      // 选项互不重复、答案必在其中
      expect(new Set(q.options).size).toBe(q.options.length)
      expect(q.options).toContain(q.answer)
    }
  })

  it('规格与 L5 一致：6 选项 / 10s 限时 / 同科干扰', () => {
    const q6 = buildQuestions(starterBank, { type: 'image', count: 1, tier: 6 })[0]!
    const q5 = buildQuestions(starterBank, { type: 'image', count: 1, tier: 5 })[0]!
    expect(q6.options.length).toBe(q5.options.length)
    expect(q6.timeLimitSec).toBe(q5.timeLimitSec)
    expect(TIERS[6].optionCount).toBe(TIERS[5].optionCount)
    expect(TIERS[6].distractor).toBe(TIERS[5].distractor)
    expect(TIERS[6].commonness).toEqual(TIERS[5].commonness)
  })

  it('L1–L5 不受影响：选项仍是俗名（nameMode 为 name）', () => {
    const q = buildQuestions(starterBank, { type: 'image', count: 1, tier: 2 })[0]!
    expect(q.nameMode).toBe('name')
    expect(q.answer).not.toBe(q.sci)
  })

  it('档位表含 L6，且自适应升档封顶 L5（不会自动升到 L6）', () => {
    expect(TIER_LIST.map((t) => t.tier)).toContain(6)
    const rounds = Array.from({ length: 5 }, (_, i) => ({
      at: Date.now() - i * 1000,
      mode: 'image' as const,
      tier: 5 as const,
      total: 10,
      correct: 10,
      items: [],
    })) as unknown as Parameters<typeof suggestTier>[0]
    expect(suggestTier(rounds, 'image', 5).tier).toBe(5)
  })
})
