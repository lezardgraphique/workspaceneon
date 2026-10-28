import { uid } from './types'
import type { Block, Section } from './types'

// Custom blocks: reusable sections (a card with its columns and blocks) saved
// in the library, offered in Structure > Ajouter next to the built-in blocks
// and created by Maily on request. Duplicates are detected by name (slug) and
// by structure (signature), never by ids.

export interface CustomBlock {
  id: string
  name: string
  description: string
  section: Section
  createdAt: string
}

export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

// JSON of the block without ids and field names, in a stable key order.
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => k !== 'id')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, strip(x)]),
    )
  }
  return v
}

// Same structure and content → same signature (FNV-1a over the stripped JSON).
export function signature(b: Block | Section): string {
  const json = JSON.stringify(strip(b))
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < json.length; i++) {
    h1 = Math.imul(h1 ^ json.charCodeAt(i), 0x01000193)
    h2 = Math.imul(h2 + json.charCodeAt(i), 0x85ebca6b) ^ h1
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}${json.length.toString(16)}`
}

// A copy with fresh ids, ready to be inserted without clashing with the module.
export function withNewIds<T extends Block>(b: T): T {
  if (b.type === 'section') return { ...b, id: uid(), cells: b.cells.map((c) => c.map((x) => withNewIds(x))) } as T
  return { ...b, id: uid() }
}
