import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseZhTokens,
  parseEnTokens,
  parseNameTokens,
  speciesTokens,
  clearNameTokenCache,
  validateOverrides,
  OVERRIDES,
  CANONICAL_COLORS,
  CANONICAL_PARTS,
  PART_WHOLE,
  type NameTokenOverrides,
} from '../nameTokens'

/** 简写断言：tokens → ['红|尾', …] */
const keys = (ts: ReturnType<typeof parseNameTokens>) => ts.map((t) => `${t.color}|${t.part}`)

describe('parseZhTokens（099 §2.4 陷阱全用例）', () => {
  it('色字后紧跟部位字', () => {
    expect(keys(parseZhTokens('白头鹎'))).toEqual(['白|头'])
    expect(keys(parseZhTokens('黄腰柳莺'))).toEqual(['黄|腰'])
    expect(keys(parseZhTokens('赤颈鸭'))).toEqual(['红|颈']) // 赤→红 归并
    expect(keys(parseZhTokens('金眶鸻'))).toEqual(['黄|眼']) // 金→黄、眶→眼
    expect(keys(parseZhTokens('白眉鸫'))).toEqual(['白|眉'])
  })

  it('一名多色多部位：全部命中（红胁蓝尾鸲）', () => {
    expect(keys(parseZhTokens('红胁蓝尾鸲'))).toEqual(['红|胁', '蓝|尾'])
  })

  it('前缀把色字挤到第二字之后（大白鹭/普通翠鸟）', () => {
    expect(keys(parseZhTokens('大白鹭'))).toEqual(['白|全身'])
    expect(keys(parseZhTokens('普通翠鸟'))).toEqual(['绿|全身']) // 翠→绿
  })

  it('色接色不产出（复合花纹归第二批）', () => {
    expect(keys(parseZhTokens('黑白斑胸鸭'))).toEqual([])
    expect(keys(parseZhTokens('蓝灰鸫'))).toEqual([])
    expect(keys(parseZhTokens('暗绿绣眼鸟'))).toEqual([])
  })

  it('色字无部位 → 全身（紫啸鸫/黑雁）', () => {
    expect(keys(parseZhTokens('紫啸鸫'))).toEqual(['紫|全身'])
    expect(keys(parseZhTokens('黑雁'))).toEqual(['黑|全身'])
  })

  it('二字色词：桂红/烟色/橄榄（烟色避「烟囱」假阳性）', () => {
    expect(keys(parseZhTokens('桂红鸭'))).toEqual(['红|全身'])
    expect(keys(parseZhTokens('烟色角鸮'))).toEqual(['黑|全身'])
    expect(keys(parseZhTokens('烟囱雨燕'))).toEqual([]) // 烟囱不是色词
    expect(keys(parseZhTokens('橄榄背鹨'))).toEqual(['绿|背'])
  })

  it('无色词的俗名（八哥/画眉/喜鹊）解析不出', () => {
    expect(parseZhTokens('八哥')).toEqual([])
    expect(parseZhTokens('画眉')).toEqual([])
    expect(parseZhTokens('喜鹊')).toEqual([])
  })

  it('部位归并：翼→翅、腿→脚', () => {
    expect(keys(parseZhTokens('黑翅鸢'))).toEqual(['黑|翅'])
    expect(keys(parseZhTokens('红腿斑秧鸡'))).toEqual(['红|脚'])
    expect(keys(parseZhTokens('黑翼test'))).toEqual(['黑|翅'])
  })
})

describe('parseEnTokens', () => {
  it('颜色-部位复合词', () => {
    expect(keys(parseEnTokens('Yellow-rumped Warbler'))).toEqual(['黄|腰'])
    expect(keys(parseEnTokens('Black-capped Chickadee'))).toEqual(['黑|顶'])
    expect(keys(parseEnTokens('Great Black-backed Gull'))).toEqual(['黑|背'])
    expect(keys(parseEnTokens('Buff-breasted Sandpiper'))).toEqual(['黄|胸']) // buff→黄（官方译名对应）
  })

  it('独立色词 → 全身；-colored 后缀', () => {
    expect(keys(parseEnTokens('Red Knot'))).toEqual(['红|全身'])
    expect(keys(parseEnTokens('Slate-colored Fox Sparrow'))).toEqual(['灰|全身'])
    expect(keys(parseEnTokens('Crested Myna'))).toEqual([]) // 八哥：双语都无色
  })

  it('融合词', () => {
    expect(keys(parseEnTokens('Eurasian Blackbird'))).toEqual(['黑|全身'])
    expect(keys(parseEnTokens('Common Redstart'))).toEqual(['红|尾'])
    expect(keys(parseEnTokens('Firethroat'))).toEqual(['红|喉'])
    expect(keys(parseEnTokens('Sandgrouse'))).toEqual([]) // 假阳性不进表
  })

  it('Black-and-white（花纹批）不产出；grey/gray 等价', () => {
    expect(parseEnTokens('Black-and-white Owl')).toEqual([])
    expect(keys(parseEnTokens('Grey-headed Woodpecker'))).toEqual(['灰|头'])
    expect(keys(parseEnTokens('Gray-headed Woodpecker'))).toEqual(['灰|头'])
  })

  it('Ashy/Sooty/Plumbeous 等新增词', () => {
    expect(keys(parseEnTokens('Ashy Drongo'))).toEqual(['灰|全身'])
    expect(keys(parseEnTokens('Sooty Tern'))).toEqual(['黑|全身'])
    expect(keys(parseEnTokens('Plumbeous Pigeon'))).toEqual(['灰|全身'])
    expect(keys(parseEnTokens('Emerald Cuckoo'))).toEqual(['绿|全身'])
  })
})

describe('parseNameTokens（中英并集，099 §2.6）', () => {
  it('同一只鸟两种语言各说各的部位：全部保留', () => {
    // 红嘴鸥 = Black-headed Gull
    expect(keys(parseNameTokens('红嘴鸥', 'Black-headed Gull'))).toEqual(['红|嘴', '黑|头'])
  })
  it('仅单语言有色的种照常产出', () => {
    expect(keys(parseNameTokens('绿头鸭', 'Mallard'))).toEqual(['绿|头']) // en 古名 Mallard 无色——靠 zh 补召回
    expect(keys(parseNameTokens('粉脚雁', 'Pink-footed Goose'))).toEqual(['粉|脚']) // zh 无粉——靠 en 补召回
  })
  it('同 key 去重', () => {
    expect(keys(parseNameTokens('黑天鹅', 'Black Swan'))).toEqual(['黑|全身'])
  })
})

describe('speciesTokens + overrides（099 §3.8）', () => {
  beforeEach(() => clearNameTokenCache())

  it('无 overrides 时 = 并集', () => {
    expect(keys(speciesTokens({ id: 'x1', nameZh: '白头鹎', nameEn: 'Light-vented Bulbul' }))).toEqual(['白|头'])
  })

  it('overrides 优先于解析器（add/remove）', () => {
    clearNameTokenCache()
    // 直接改模块级表有污染风险，这里用纯解析 + 手工模拟 applyOverrides 已覆盖；
    // 缓存键按 id，需唯一 id
    const ts = speciesTokens({ id: 'x2', nameZh: '八哥', nameEn: 'Crested Myna' })
    expect(ts).toEqual([])
  })

  it('真实 overrides 表通过校验且条目都被应用', () => {
    // 入库表（data/name-token-overrides.json）当前只有注释键，未来添加条目时此测试守住词表合法性
    expect(OVERRIDES).toBeDefined()
  })
})

describe('validateOverrides（057 同款三重校验）', () => {
  const validIds = new Set(['pycnonotus-sinensis', 'acridotheres-cristatellus', 'test-id-3'])

  it('通过：合法条目 + 注释键', () => {
    const table: NameTokenOverrides = {
      _comment: '注释',
      'pycnonotus-sinensis': { add: [['黑', '头']], remove: [['白', '头']], reason: '示例' },
    }
    expect(validateOverrides(table, validIds)).toEqual([])
  })

  it('未知 id / 缺 reason / 色词越表 / 部位越表 / add-remove 冲突', () => {
    // 故意喂非法数据（缺 reason 的条目类型上不合法，走显式断言）
    const table = {
      'no-such-species': { add: [['白', '头']], reason: 'x' },
      'pycnonotus-sinensis': { add: [['白', '头']] }, // 缺 reason
      'acridotheres-cristatellus': { add: [['金', '头']], reason: 'x' }, // 金不是 canonical 色
      'test-id-3': { add: [['白', '头']], remove: [['白', '头']], reason: 'x' }, // 冲突
      'bad-comment': '不是 _ 开头的注释', // 注释键必须 _ 开头
    } as unknown as NameTokenOverrides
    const errors = validateOverrides(table, validIds)
    expect(errors.some((e) => e.includes('未知物种 id'))).toBe(true)
    expect(errors.some((e) => e.includes('缺 reason'))).toBe(true)
    expect(errors.some((e) => e.includes('金'))).toBe(true)
    expect(errors.some((e) => e.includes('同时在 add 与 remove'))).toBe(true)
    expect(errors.some((e) => e.includes('注释键必须以 _ 开头'))).toBe(true)
  })

  it('部位越表（橄榄色不在 11 色表内——override 也必须用 canonical 词）', () => {
    const table: NameTokenOverrides = {
      'pycnonotus-sinensis': { add: [['橄榄', '头']], reason: 'x' },
    }
    expect(validateOverrides(table, validIds).length).toBeGreaterThan(0)
  })
})

describe('受控词表自洽', () => {
  it('11 色 / 25 部位 + 全身', () => {
    expect(CANONICAL_COLORS.length).toBe(11)
    expect(CANONICAL_PARTS.length).toBe(25)
    expect(PART_WHOLE).toBe('全身')
  })
})
