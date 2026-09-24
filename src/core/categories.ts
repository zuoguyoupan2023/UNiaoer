/**
 * 类群（category）注册表 —— 扩展性的核心抽象。
 * 加新类群（动物/植物/蘑菇/昆虫/岩石…）= 加数据 + 加配置，不改核心代码。
 */
export type CategoryId = 'bird' | 'animal' | 'plant' | 'fungus' | 'insect' | 'rock'

export interface Category {
  id: CategoryId
  label: string
  emoji: string
  status: 'active' | 'planned'
  description: string
  /** 题库文件名（相对 /data/） */
  bankFile: string
}

export const CATEGORIES: Category[] = [
  {
    id: 'bird',
    label: '鸟类',
    emoji: '🐦',
    status: 'active',
    description: '听声辨鸟 · 看图识鸟',
    bankFile: 'manifest.bird.json',
  },
  { id: 'animal', label: '动物', emoji: '🦊', status: 'planned', description: '兽类 · 两栖爬行 · 水生', bankFile: 'manifest.animal.json' },
  { id: 'plant', label: '植物', emoji: '🌿', status: 'planned', description: '乔木 · 灌木 · 草本 · 野花', bankFile: 'manifest.plant.json' },
  { id: 'fungus', label: '蘑菇', emoji: '🍄', status: 'planned', description: '真菌 · 大型子实体', bankFile: 'manifest.fungus.json' },
  { id: 'insect', label: '昆虫', emoji: '🦋', status: 'planned', description: '蝶蛾 · 甲虫 · 蜻蜓', bankFile: 'manifest.insect.json' },
  { id: 'rock', label: '岩石矿物', emoji: '🪨', status: 'planned', description: '岩石 · 矿物 · 化石', bankFile: 'manifest.rock.json' },
]

export const DEFAULT_CATEGORY: CategoryId = 'bird'

export function getCategory(id: CategoryId | string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]!
}

export const ACTIVE_CATEGORIES = CATEGORIES.filter((c) => c.status === 'active')
