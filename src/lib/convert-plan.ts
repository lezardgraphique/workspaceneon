// « Convertir en blocs »: what converting the module's « Blocs HTML » would
// give, before doing it. Logic lines ({% if %}, {% for %}, macros) are not
// candidates; a Bloc HTML whose code gives nothing but HTML again is listed as
// staying as it is.
import { isLogicBlock } from './hubl-render'
import { rawBlocks } from './tree'
import type { Block, ModuleTree } from './types'

const KIND: Partial<Record<Block['type'], [string, string]>> = {
  heading: ['titre', 'titres'],
  text: ['texte', 'textes'],
  button: ['bouton', 'boutons'],
  image: ['image', 'images'],
  divider: ['séparateur', 'séparateurs'],
  spacer: ['espace', 'espaces'],
  section: ['carte ou colonnes', 'cartes ou colonnes'],
  raw: ['ligne de logique ou de HTML', 'lignes de logique ou de HTML'],
}

export type Counts = Partial<Record<Block['type'], number>>

export interface PlanItem {
  id: string
  /** Start of the code, as text, to recognise the block. */
  excerpt: string
  /** What it becomes, nested cards counted with their content. */
  makes: Counts
  /** Gives at least one editable block (title, text, button, image…). */
  convertible: boolean
}

export interface Plan {
  items: PlanItem[]
  /** Logic lines, never converted. */
  logic: number
}

function count(blocks: Block[], into: Counts = {}): Counts {
  for (const b of blocks) {
    into[b.type] = (into[b.type] ?? 0) + 1
    if (b.type === 'section') for (const cell of b.cells) count(cell, into)
  }
  return into
}

const excerptOf = (html: string) => {
  const text = html
    .replace(/<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (text || html.replace(/\s+/g, ' ').trim()).slice(0, 60)
}

export function planConversion(tree: ModuleTree, convert: (html: string) => Block[]): Plan {
  const plan: Plan = { items: [], logic: 0 }
  for (const b of rawBlocks(tree)) {
    if (isLogicBlock(b)) {
      plan.logic++
      continue
    }
    const out = convert(b.html)
    const makes = count(out)
    const convertible = out.some((x) => x.type !== 'raw')
    plan.items.push({ id: b.id, excerpt: excerptOf(b.html), makes, convertible })
  }
  return plan
}

/** « 1 titre, 2 textes, 1 bouton » (editable kinds first, what stays HTML last). */
export function describe(c: Counts): string {
  const order: Block['type'][] = ['heading', 'text', 'button', 'image', 'section', 'divider', 'spacer', 'raw']
  return order
    .filter((t) => c[t])
    .map((t) => `${c[t]} ${KIND[t]![c[t]! > 1 ? 1 : 0]}`)
    .join(', ')
}

export function total(items: PlanItem[]): Counts {
  const sum: Counts = {}
  for (const it of items) for (const [k, n] of Object.entries(it.makes)) sum[k as Block['type']] = (sum[k as Block['type']] ?? 0) + (n ?? 0)
  return sum
}
