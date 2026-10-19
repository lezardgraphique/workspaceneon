import type { Block, ButtonBlock, HeadingBlock, ImageBlock, ModuleTree, TextBlock } from './types'

// Module fields, as in a design manager: every heading, text, button and image
// is a field whose value is the block content. Names are what the exported
// module.html references ({{ module.<name> }}) and the fields.json keys.

export type FieldBlock = HeadingBlock | TextBlock | ButtonBlock | ImageBlock

export interface ModuleField {
  block: FieldBlock
  name: string
  label: string
  // Automatic name/label (no custom definition on the block)
  auto: boolean
}

export const FIELD_KIND: Record<FieldBlock['type'], { prefix: string; label: string; type: string }> = {
  heading: { prefix: 'heading', label: 'Titre', type: 'Texte' },
  text: { prefix: 'text', label: 'Texte', type: 'Texte enrichi' },
  button: { prefix: 'button', label: 'Bouton', type: 'Texte + lien' },
  image: { prefix: 'image', label: 'Image', type: 'Image' },
}

export const isFieldBlock = (b: Block): b is FieldBlock =>
  b.type === 'heading' || b.type === 'text' || b.type === 'button' || b.type === 'image'

// snake_case identifier usable in HuBL: no accents, starts with a letter.
export function toFieldName(s: string): string {
  const n = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return /^[a-z]/.test(n) ? n : n ? `f_${n}` : ''
}

// All fields in document order, with unique names (duplicates get _2, _3…).
export function collectFields(tree: ModuleTree): ModuleField[] {
  const out: ModuleField[] = []
  const counters: Record<string, number> = {}
  const used = new Set<string>()
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type === 'section') b.cells.forEach(walk)
      else if (isFieldBlock(b)) {
        const kind = FIELD_KIND[b.type]
        const n = (counters[b.type] = (counters[b.type] ?? 0) + 1)
        const custom = b.field && toFieldName(b.field.name)
        let name = custom || `${kind.prefix}_${n}`
        for (let i = 2; used.has(name); i++) name = `${custom || `${kind.prefix}_${n}`}_${i}`
        used.add(name)
        out.push({ block: b, name, label: b.field?.label.trim() || `${kind.label} ${n}`, auto: !custom })
      }
    }
  }
  tree.sections.forEach((s) => walk([s]))
  return out
}
