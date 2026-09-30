import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * 读取答疑专栏文案 data/species-notes.json（011 §9）。
 * 返回 { "<物种id>": { titleZh, titleEn, bodyZh, bodyEn } }；文件缺失返回 {}。
 */
export async function loadSpeciesNotes(root) {
  try {
    const raw = await fs.readFile(path.join(root, 'data/species-notes.json'), 'utf8')
    const d = JSON.parse(raw)
    return (d && d.notes) || {}
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw e
  }
}

/**
 * 把 notes 并入物种记录（就地修改）：命中则写 species[].notes，未命中则删除旧字段。
 * 返回应用的条数。
 */
export function applySpeciesNotes(species, notes) {
  let applied = 0
  for (const sp of species) {
    const n = notes[sp.id]
    if (n) {
      sp.notes = n
      applied++
    } else {
      delete sp.notes
    }
  }
  return applied
}

/** notes 里出现、但 manifest 中不存在的物种 id（多为拼写错误） */
export function unmatchedNoteIds(species, notes) {
  const ids = new Set(species.map((s) => s.id))
  return Object.keys(notes).filter((id) => !ids.has(id))
}
