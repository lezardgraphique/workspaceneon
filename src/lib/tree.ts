import { uid } from './types'
import type { Block, Columns, ModuleTree, Section } from './types'

// Immutable helpers over the recursive section/cell/block tree.

type Mapper = (blocks: Block[]) => Block[]

// Apply `fn` to every block list in the tree (top-level sections + every cell).
export function mapLists(tree: ModuleTree, fn: Mapper): ModuleTree {
  const walkSection = (s: Section): Section => ({
    ...s,
    cells: s.cells.map((cell) => fn(cell).map((b) => (b.type === 'section' ? walkSection(b) : b))),
  })
  const top = fn(tree.sections) as Section[]
  return { ...tree, sections: top.map(walkSection) }
}

export function findNode(tree: ModuleTree, id: string): Block | null {
  const search = (blocks: Block[]): Block | null => {
    for (const b of blocks) {
      if (b.id === id) return b
      if (b.type === 'section') {
        for (const cell of b.cells) {
          const hit = search(cell)
          if (hit) return hit
        }
      }
    }
    return null
  }
  return search(tree.sections)
}

// Ids from the root down to `id` (inclusive). Empty when not found.
export function findPath(tree: ModuleTree, id: string): string[] {
  const search = (blocks: Block[], trail: string[]): string[] | null => {
    for (const b of blocks) {
      const next = [...trail, b.id]
      if (b.id === id) return next
      if (b.type === 'section') {
        for (const cell of b.cells) {
          const hit = search(cell, next)
          if (hit) return hit
        }
      }
    }
    return null
  }
  return search(tree.sections, []) ?? []
}

export function updateNode(tree: ModuleTree, id: string, patch: Partial<Block>): ModuleTree {
  return mapLists(tree, (list) =>
    list.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)),
  )
}

export function removeNode(tree: ModuleTree, id: string): ModuleTree {
  return mapLists(tree, (list) => list.filter((b) => b.id !== id))
}

// Swap a block for several (e.g. a raw block converted into editable blocks).
export function replaceNode(tree: ModuleTree, id: string, blocks: Block[]): ModuleTree {
  return mapLists(tree, (list) => list.flatMap((b) => (b.id === id ? blocks : [b])))
}

// Convert every raw block of the tree at once.
export function expandRaw(tree: ModuleTree, convert: (html: string) => Block[], only?: Set<string>): ModuleTree {
  return mapLists(tree, (list) => list.flatMap((b) => (b.type === 'raw' && (!only || only.has(b.id)) ? convert(b.html) : [b])))
}

/** Every raw block (« Bloc HTML » or logic line) of the module, in document order. */
export function rawBlocks(tree: ModuleTree): Extract<Block, { type: 'raw' }>[] {
  const found: Extract<Block, { type: 'raw' }>[] = []
  mapLists(tree, (list) => {
    for (const b of list) if (b.type === 'raw') found.push(b)
    return list
  })
  return found
}

export function moveNode(tree: ModuleTree, id: string, dir: -1 | 1): ModuleTree {
  return mapLists(tree, (list) => {
    const i = list.findIndex((b) => b.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return list
    const copy = [...list]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  })
}

export type MoveTarget = { before: string } | { after: string } | { section: string; cell: number }

// Deepest nesting a module accepts (see sanitize-tree.ts): top-level = level 0.
const MAX_LEVEL = 4
const sectionHeight = (b: Block): number => (b.type === 'section' ? 1 + Math.max(0, ...b.cells.flat().map(sectionHeight)) : 0)

// Move a block (or a whole section) next to another block, or into a cell, at
// any depth. Returns the tree unchanged when the move is impossible: onto
// itself, inside its own content, or deeper than a module can nest.
export function moveNodeTo(tree: ModuleTree, id: string, target: MoveTarget): ModuleTree {
  const node = findNode(tree, id)
  if (!node) return tree
  const anchor = 'before' in target ? target.before : 'after' in target ? target.after : target.section
  if (anchor === id || findPath(tree, anchor).includes(id)) return tree
  // Level the moved block would sit at = number of sections around the spot.
  const around = 'section' in target ? findPath(tree, target.section).length : findPath(tree, anchor).length - 1
  if (node.type === 'section' && around + sectionHeight(node) - 1 > MAX_LEVEL) return tree
  const removed = removeNode(tree, id)
  if ('section' in target) return insertInCell(removed, target.section, target.cell, node)
  return mapLists(removed, (list) => {
    const i = list.findIndex((b) => b.id === anchor)
    if (i < 0) return list
    const copy = [...list]
    copy.splice('before' in target ? i : i + 1, 0, node)
    return copy
  })
}

function cloneWithIds<T extends Block>(b: T): T {
  if (b.type === 'section') {
    return { ...b, id: uid(), cells: b.cells.map((c) => c.map(cloneWithIds)) } as T
  }
  return { ...b, id: uid() }
}

export function duplicateNode(tree: ModuleTree, id: string): ModuleTree {
  return mapLists(tree, (list) => {
    const i = list.findIndex((b) => b.id === id)
    if (i < 0) return list
    const copy = [...list]
    copy.splice(i + 1, 0, cloneWithIds(list[i]))
    return copy
  })
}

export function insertInCell(
  tree: ModuleTree,
  sectionId: string,
  cellIndex: number,
  block: Block,
): ModuleTree {
  return mapLists(tree, (list) =>
    list.map((b) =>
      b.id === sectionId && b.type === 'section'
        ? { ...b, cells: b.cells.map((c, i) => (i === cellIndex ? [...c, block] : c)) }
        : b,
    ),
  )
}

// Change column count: extra cells are merged into the last kept one, so no
// content is ever lost when going from 3 → 1 columns.
export function setColumns(tree: ModuleTree, sectionId: string, columns: Columns): ModuleTree {
  return mapLists(tree, (list) =>
    list.map((b) => {
      if (b.id !== sectionId || b.type !== 'section') return b
      let cells = b.cells.slice(0, columns)
      if (b.cells.length > columns) {
        const overflow = b.cells.slice(columns).flat()
        cells = cells.map((c, i) => (i === columns - 1 ? [...c, ...overflow] : c))
      }
      while (cells.length < columns) cells.push([])
      return { ...b, columns, cells }
    }),
  )
}

export function countBlocks(tree: ModuleTree, type?: Block['type']): number {
  let n = 0
  mapLists(tree, (list) => {
    n += type ? list.filter((b) => b.type === type).length : list.length
    return list
  })
  return n
}
