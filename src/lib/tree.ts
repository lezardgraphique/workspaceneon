import { uid } from './types'
import type { Block, Columns, ModuleTree, Section } from './types'

// Immutable helpers over the recursive section/cell/block tree.

type Mapper = (blocks: Block[]) => Block[]

// Apply `fn` to every block list in the tree (top-level sections + every cell).
function mapLists(tree: ModuleTree, fn: Mapper): ModuleTree {
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
export function expandRaw(tree: ModuleTree, convert: (html: string) => Block[]): ModuleTree {
  return mapLists(tree, (list) => list.flatMap((b) => (b.type === 'raw' ? convert(b.html) : [b])))
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
