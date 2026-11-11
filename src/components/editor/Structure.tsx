import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BookmarkCheck,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code,
  Crosshair,
  Copy,
  Heading,
  Image,
  Layers,
  Minus,
  MousePointerClick,
  MoveVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  Type,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { fromLibrary, withNewIds } from '@/lib/custom-blocks'
import { removeBlock } from '@/lib/data'
import { isLogicBlock } from '@/lib/hubl-render'
import { refreshCustomBlocks, useCustomBlocks } from './useCustomBlocks'
import { BLOCK_LABELS, createBlock, createSection } from '@/lib/types'
import { PRESETS } from '@/lib/presets'
import type { Block, BlockType, Columns, ModuleTree, Section } from '@/lib/types'
import { duplicateNode, findNode, findPath, insertInCell, moveNode, moveNodeTo, removeNode, updateNode } from '@/lib/tree'
import { getPref, setPref, SETTINGS_EVENT } from '@/lib/settings-sync'

export const BLOCK_ICONS: Record<BlockType, LucideIcon> = {
  heading: Heading,
  text: Type,
  button: MousePointerClick,
  image: Image,
  divider: Minus,
  spacer: MoveVertical,
  raw: Code,
  section: Layers,
}

const ADDABLE: BlockType[] = ['heading', 'text', 'button', 'image', 'divider', 'spacer', 'raw', 'section']

interface Props {
  tree: ModuleTree
  selectedId: string | null
  onSelect: (id: string | null) => void
  commit: (t: ModuleTree, select?: string | null) => void
  /** Module id: the folded sections are remembered per module. */
  storageKey?: string
}

const preview = (b: Block) => {
  switch (b.type) {
    case 'heading':
      return b.text
    case 'text':
      return b.html.replace(/<[^>]+>/g, ' ')
    case 'button':
      return b.label
    case 'image':
      return b.alt || b.src
    case 'raw':
      return b.html
    case 'spacer':
      return `${b.height}px`
    case 'section':
      return `${b.name ? 'Section · ' : ''}${b.columns} colonne${b.columns > 1 ? 's' : ''}`
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Tree state shared by every row: folded sections, search, drag and drop,
// section being renamed. Folded sections are remembered per module.

interface TreeState {
  collapsed: Set<string>
  toggle: (id: string, open?: boolean) => void
  query: string
  shown: Set<string> | null
  drop: { id: string; where: 'before' | 'after' | 'inside' } | null
  setDrop: (d: TreeState['drop']) => void
  dragging: React.MutableRefObject<string | null>
  renaming: string | null
  setRenaming: (id: string | null) => void
}
const TreeCtx = createContext<TreeState | null>(null)
const useTree = () => useContext(TreeCtx)!

const countIn = (s: Section): number => s.cells.reduce((n, c) => n + c.reduce((m, b) => m + 1 + (b.type === 'section' ? countIn(b) : 0), 0), 0)

const labelOf = (b: Block, nested?: boolean) =>
  b.type === 'section' ? (b.name ? b.name : nested ? BLOCK_LABELS.section : 'Section') : isLogicBlock(b) ? 'Logique' : BLOCK_LABELS[b.type]

function Row({ b, depth, p, nested }: { b: Block; depth: number; p: Props; nested?: boolean }) {
  const t = useTree()
  const Icon = BLOCK_ICONS[b.type]
  const selected = p.selectedId === b.id
  const isSection = b.type === 'section'
  const open = isSection && !t.collapsed.has(b.id)
  const searching = !!t.query
  const act = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation()
    fn()
  }
  const drop = t.drop?.id === b.id ? t.drop.where : null

  // Drag and drop in the tree (desktop): before / after a row, or into a section
  // (a block dropped on a top-level section goes at the end of its first column).
  const onDragOver = (e: React.DragEvent) => {
    const from = t.dragging.current
    if (!from || from === b.id || findPath(p.tree, b.id).includes(from)) return
    const dragged = findNode(p.tree, from)
    if (!dragged) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const where = !nested && depth === 0 && dragged.type !== 'section' ? 'inside' : e.clientY < r.top + r.height / 2 ? 'before' : 'after'
    if (t.drop?.id !== b.id || t.drop.where !== where) t.setDrop({ id: b.id, where })
  }
  const onDrop = (e: React.DragEvent) => {
    const from = t.dragging.current
    const d = t.drop
    t.dragging.current = null
    t.setDrop(null)
    if (!from || !d || d.id !== b.id) return
    e.preventDefault()
    const next = moveNodeTo(p.tree, from, d.where === 'inside' ? { section: b.id, cell: 0 } : d.where === 'before' ? { before: b.id } : { after: b.id })
    if (next !== p.tree) {
      p.commit(next, from)
      if (d.where === 'inside') t.toggle(b.id, true)
    }
  }

  return (
    <div
      data-row={b.id}
      draggable={t.renaming !== b.id}
      onDragStart={(e) => {
        t.dragging.current = b.id
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', labelOf(b, nested))
      }}
      onDragEnd={() => {
        t.dragging.current = null
        t.setDrop(null)
      }}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node) && t.drop?.id === b.id) t.setDrop(null)
      }}
      onDrop={onDrop}
      style={{ paddingLeft: 4 + depth * 14 }}
      className={`group relative flex items-center gap-1 rounded-md pr-1 text-sm ${
        selected ? 'bg-pink/15 text-white ring-1 ring-pink/60' : drop === 'inside' ? 'bg-cyan/10 ring-1 ring-cyan' : 'text-[#c9c9de] hover:bg-white/5'
      }`}
    >
      {drop === 'before' && <span aria-hidden className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded bg-cyan shadow-[0_0_6px_var(--color-cyan)]" />}
      {drop === 'after' && <span aria-hidden className="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded bg-cyan shadow-[0_0_6px_var(--color-cyan)]" />}
      {isSection ? (
        <button
          type="button"
          aria-expanded={searching || open}
          aria-controls={`tree-${b.id}`}
          aria-label={`${open ? 'Replier' : 'Déplier'} ${labelOf(b, nested)}`}
          title={open ? 'Replier' : 'Déplier'}
          disabled={searching}
          onClick={(e) => act(e, () => t.toggle(b.id))}
          className="shrink-0 rounded p-1 text-mute hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <ChevronRight className={`size-3.5 transition-transform ${searching || open ? 'rotate-90' : ''}`} />
        </button>
      ) : (
        <span className="w-[22px] shrink-0" aria-hidden />
      )}
      {t.renaming === b.id && isSection ? (
        <RenameField
          value={b.name ?? ''}
          onDone={(name) => {
            t.setRenaming(null)
            if (name !== undefined) p.commit(updateNode(p.tree, b.id, { name: name || undefined } as Partial<Block>), b.id)
          }}
        />
      ) : (
        <button
          type="button"
          data-row-select={b.id}
          onClick={() => p.onSelect(b.id)}
          onDoubleClick={() => isSection && t.setRenaming(b.id)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left lg:py-1.5"
        >
          <Icon className={`size-3.5 shrink-0 ${isSection ? 'text-cyan' : 'text-mute'}`} aria-hidden />
          <span className={`shrink-0 font-medium ${isSection && b.name ? 'max-w-[9rem] truncate' : ''}`}>{labelOf(b, nested)}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-mute">
            {isSection && !open && !searching ? `${countIn(b)} élément${countIn(b) > 1 ? 's' : ''} · replié` : preview(b)}
          </span>
        </button>
      )}
      <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
        {[
          ...(isSection ? [{ icon: Pencil, label: 'Renommer', fn: () => t.setRenaming(b.id) }] : []),
          { icon: ArrowUp, label: 'Monter', fn: () => p.commit(moveNode(p.tree, b.id, -1)) },
          { icon: ArrowDown, label: 'Descendre', fn: () => p.commit(moveNode(p.tree, b.id, 1)) },
          { icon: Copy, label: 'Dupliquer', fn: () => p.commit(duplicateNode(p.tree, b.id)) },
          { icon: Trash2, label: 'Supprimer', fn: () => p.commit(removeNode(p.tree, b.id), null) },
        ].map((a) => (
          <button
            type="button"
            key={a.label}
            title={a.label}
            aria-label={a.label}
            onClick={(e) => act(e, a.fn)}
            className="rounded p-1.5 text-mute hover:bg-white/10 hover:text-white"
          >
            <a.icon className="size-3" />
          </button>
        ))}
      </span>
    </div>
  )
}

// Inline name field: Enter or leaving saves, Escape cancels.
function RenameField({ value, onDone }: { value: string; onDone: (name?: string) => void }) {
  const [v, setV] = useState(value)
  const done = useRef(false)
  const finish = (name?: string) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  return (
    <input
      autoFocus
      aria-label="Nom de la section"
      placeholder="Nom de la section (ex. En-tête)"
      maxLength={40}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(v.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(v.trim())
        if (e.key === 'Escape') finish(undefined)
      }}
      className="my-1 min-w-0 flex-1 rounded border border-cyan bg-void px-2 py-1 text-sm text-white outline-none"
    />
  )
}

// « Mes blocs »: everything saved with « Enregistrer dans Mes blocs », always
// within reach at the bottom of the Structure tab (opened state remembered).
// A saved block goes after the selected section, or at the end of the module.
function MyBlocks({ p }: { p: Props }) {
  const custom = useCustomBlocks()
  const [open, setOpen] = useState(() => store.get('nsp-my-blocks') === '1')
  const toggle = () => {
    setOpen(!open)
    store.set('nsp-my-blocks', open ? '0' : '1')
  }
  const insert = (section: Section) => {
    const copy = withNewIds(section)
    const top = p.selectedId ? p.tree.sections.findIndex((s) => s.id === p.selectedId || !!findNode({ ...p.tree, sections: [s] }, p.selectedId!)) : -1
    const at = top >= 0 ? top + 1 : p.tree.sections.length
    p.commit({ ...p.tree, sections: [...p.tree.sections.slice(0, at), copy, ...p.tree.sections.slice(at)] }, copy.id)
  }
  return (
    <div className="border-t border-line">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5">
        <BookmarkCheck className="size-4 shrink-0 text-pink" aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-wider text-mute">Mes blocs</span>
        <span className="rounded-full bg-pink/15 px-1.5 text-[10px] font-semibold text-pink">{custom.length}</span>
        <ChevronDown className={`ml-auto size-3.5 text-mute transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="max-h-56 space-y-1 overflow-y-auto px-2 pb-2">
          {custom.length === 0 ? (
            <p className="px-1 pb-1 text-xs text-mute">
              Rien d'enregistré pour l'instant. Sélectionne un élément, une card ou une section, puis l'icône « Enregistrer dans Mes blocs » (marque-page) en haut des Réglages : il apparaîtra ici, dans tous tes modules.
            </p>
          ) : (
            <>
              <p className="px-1 text-[11px] text-mute">Clique pour l'ajouter {p.selectedId ? 'après la section sélectionnée' : 'à la fin du module'}. Disponibles dans tous tes modules.</p>
              {custom.map((c) => (
                <div key={c.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    title={c.description || c.name}
                    onClick={() => insert(c.section)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-2 text-left text-sm text-[#c9c9de] hover:bg-pink/15 hover:text-white lg:py-1 lg:text-xs"
                  >
                    <Plus className="size-3 shrink-0 text-pink" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.name}</span>
                      {c.description && <span className="block truncate text-[10px] text-mute">{c.description}</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Supprimer « ${c.name} » de Mes blocs`}
                    title="Supprimer de Mes blocs"
                    onClick={async () => {
                      if (!confirm(`Supprimer « ${c.name} » de Mes blocs ? Les modules qui l'utilisent ne changent pas.`)) return
                      try {
                        await removeBlock(c.id)
                        refreshCustomBlocks()
                      } catch (e) {
                        alert(e instanceof Error ? e.message : 'Suppression impossible')
                      }
                    }}
                    className="rounded p-1.5 text-mute hover:bg-pink/10 hover:text-pink"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function AddMenu({ section, cell, depth, p }: { section: Section; cell: number; depth: number; p: Props }) {
  const [open, setOpen] = useState(false)
  const custom = useCustomBlocks()
  return (
    <div style={{ paddingLeft: 8 + depth * 14 }} className="py-0.5">
      {open ? (
        <div className="grid grid-cols-2 gap-1 rounded-md border border-line bg-void p-1.5">
          {ADDABLE.map((t) => {
            const Icon = BLOCK_ICONS[t]
            return (
              <button
                key={t}
                onClick={() => {
                  const block = createBlock(t)
                  p.commit(insertInCell(p.tree, section.id, cell, block), block.id)
                  setOpen(false)
                }}
                className="flex items-center gap-1.5 rounded px-2 py-2.5 text-left text-sm text-[#c9c9de] hover:bg-pink/15 hover:text-white lg:py-1 lg:text-xs"
              >
                <Icon className="size-3 text-cyan" /> {BLOCK_LABELS[t]}
              </button>
            )
          })}
          <p className="col-span-2 px-2 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-mute/70">Blocs prêts à l'emploi</p>
          {PRESETS.map((pr) => (
            <button
              key={pr.id}
              title={pr.hint}
              style={{ gridColumn: 'span 2' }}
              onClick={() => {
                const block = pr.build()
                p.commit(insertInCell(p.tree, section.id, cell, block), block.id)
                setOpen(false)
              }}
              className="flex items-center gap-1.5 rounded px-2 py-2.5 text-left text-sm text-[#c9c9de] hover:bg-pink/15 hover:text-white lg:py-1 lg:text-xs"
            >
              <Layers className="size-3 shrink-0 text-violet" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{pr.label}</span>
                <span className="block truncate text-[10px] text-mute">{pr.hint}</span>
              </span>
            </button>
          ))}
          {custom.length > 0 && (
            <>
              <p className="col-span-2 px-2 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-mute/70">Mes blocs</p>
              {custom.map((c) => (
                <div key={c.id} className="col-span-2 flex items-center gap-1">
                  <button
                    title={c.description || c.name}
                    onClick={() => {
                      // A saved element comes back as itself; a saved card or section as a card.
                      const blocks = fromLibrary(c.section)
                      const next = blocks.reduce((t, b) => insertInCell(t, section.id, cell, b), p.tree)
                      p.commit(next, blocks[0]?.id ?? null)
                      setOpen(false)
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-2.5 text-left text-sm text-[#c9c9de] hover:bg-pink/15 hover:text-white lg:py-1 lg:text-xs"
                  >
                    <Layers className="size-3 shrink-0 text-pink" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.name}</span>
                      {c.description && <span className="block truncate text-[10px] text-mute">{c.description}</span>}
                    </span>
                  </button>
                  <button
                    aria-label={`Supprimer « ${c.name} » de Mes blocs`}
                    title="Supprimer de Mes blocs"
                    onClick={async () => {
                      if (!confirm(`Supprimer « ${c.name} » de Mes blocs ? Les modules qui l'utilisent ne changent pas.`)) return
                      try {
                        await removeBlock(c.id)
                        refreshCustomBlocks()
                      } catch (e) {
                        alert(e instanceof Error ? e.message : 'Suppression impossible')
                      }
                    }}
                    className="shrink-0 rounded p-1.5 text-mute hover:bg-white/10 hover:text-pink"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </>
          )}
          <button onClick={() => setOpen(false)} className="col-span-2 py-2 text-xs text-mute hover:text-white lg:py-0.5 lg:text-[11px]">
            Annuler
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 rounded px-1.5 py-2 text-sm text-mute hover:text-cyan lg:py-0.5 lg:text-xs"
        >
          <Plus className="size-3" /> Ajouter
        </button>
      )}
    </div>
  )
}

function SectionTree({ s, depth, p, nested }: { s: Section; depth: number; p: Props; nested?: boolean }) {
  const t = useTree()
  if (t.shown && !t.shown.has(s.id)) return null
  const open = !!t.query || !t.collapsed.has(s.id)
  return (
    <div>
      <Row b={s} depth={depth} p={p} nested={nested} />
      {open && (
        <div id={`tree-${s.id}`}>
          {s.cells.map((cell, i) => (
            <div key={i}>
              {s.columns > 1 && (
                <p style={{ paddingLeft: 8 + (depth + 1) * 14 }} className="pt-1 font-mono text-[10px] uppercase tracking-wider text-mute/70">
                  Colonne {i + 1}
                </p>
              )}
              {cell.map((b) =>
                b.type === 'section' ? (
                  <SectionTree key={b.id} s={b} depth={depth + 1} p={p} nested />
                ) : !t.shown || t.shown.has(b.id) ? (
                  <Row key={b.id} b={b} depth={depth + 1} p={p} />
                ) : null,
              )}
              {!t.query && <AddMenu section={s} cell={i} depth={depth + 1} p={p} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Synced with the account's other devices (settings-sync.ts).
const store = { get: getPref, set: setPref }

const sectionIds = (blocks: Block[]): string[] => blocks.flatMap((b) => (b.type === 'section' ? [b.id, ...b.cells.flatMap(sectionIds)] : []))

export function Structure(p: Props) {
  const key = p.storageKey ? `nsp-folded-${p.storageKey}` : null
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [focus, setFocus] = useState(false)
  const [query, setQuery] = useState('')
  const [drop, setDrop] = useState<TreeState['drop']>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const dragging = useRef<string | null>(null)
  const list = useRef<HTMLDivElement>(null)

  // Remembered per module (and the « suivre la sélection » choice for all),
  // re-read when another device changed them.
  const [synced, setSynced] = useState(0)
  useEffect(() => {
    const on = (e: Event) => {
      const keys = (e as CustomEvent<string[]>).detail ?? []
      if (keys.includes('nsp-structure-focus') || (key && keys.includes(key))) setSynced((n) => n + 1)
    }
    window.addEventListener(SETTINGS_EVENT, on)
    return () => window.removeEventListener(SETTINGS_EVENT, on)
  }, [key])
  useEffect(() => {
    if (key) {
      try {
        setCollapsed(new Set(JSON.parse(store.get(key) ?? '[]') as string[]))
      } catch {
        /* unreadable: everything open */
      }
    }
    setFocus(store.get('nsp-structure-focus') === '1')
  }, [key, synced])
  const save = (next: Set<string>) => {
    setCollapsed(next)
    if (key) store.set(key, JSON.stringify([...next]))
  }
  const toggle = (id: string, open?: boolean) => {
    const next = new Set(collapsed)
    if (open ?? next.has(id)) next.delete(id)
    else next.add(id)
    save(next)
  }
  const all = sectionIds(p.tree.sections)

  // The selected element is always visible: its sections open (« suivre la
  // sélection »: the other top-level sections fold), and its row scrolls into view.
  useEffect(() => {
    if (!p.selectedId) return
    const path = findPath(p.tree, p.selectedId)
    if (!path.length) return
    const ancestors = path.slice(0, -1)
    let next = collapsed
    if (focus) next = new Set([...collapsed, ...p.tree.sections.map((s) => s.id).filter((id) => id !== path[0])])
    if (ancestors.some((id) => next.has(id)) || next !== collapsed) {
      next = new Set(next)
      ancestors.forEach((id) => next.delete(id))
      if ([...next].sort().join() !== [...collapsed].sort().join()) save(next)
    }
    requestAnimationFrame(() => list.current?.querySelector(`[data-row="${p.selectedId}"]`)?.scrollIntoView({ block: 'nearest' }))
  }, [p.selectedId, focus])

  // Search: matching rows and the sections around them.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const ids = new Set<string>()
    const visit = (b: Block, trail: string[], nested: boolean): void => {
      const text = `${labelOf(b, nested)} ${preview(b)}`.toLowerCase()
      if (text.includes(q)) [...trail, b.id].forEach((id) => ids.add(id))
      if (b.type === 'section') b.cells.forEach((c) => c.forEach((x) => visit(x, [...trail, b.id], true)))
    }
    p.tree.sections.forEach((s) => visit(s, [], false))
    return ids
  }, [query, p.tree])

  // Keyboard: ↑/↓ between rows, → opens and ← folds a section, F2 renames it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement
    const id = el.getAttribute('data-row-select')
    if (!id || !list.current) return
    const rows = [...list.current.querySelectorAll<HTMLElement>('[data-row-select]')]
    const i = rows.indexOf(el)
    const node = findNode(p.tree, id)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
    } else if (node?.type === 'section' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      toggle(id, e.key === 'ArrowRight')
    } else if (node?.type === 'section' && e.key === 'F2') {
      e.preventDefault()
      setRenaming(id)
    }
  }

  const addSection = (n: Columns) => {
    const s = createSection(n)
    p.commit({ ...p.tree, sections: [...p.tree.sections, s] }, s.id)
  }
  const folded = all.filter((id) => collapsed.has(id)).length
  return (
    <TreeCtx.Provider value={{ collapsed, toggle, query, shown, drop, setDrop, dragging, renaming, setRenaming }}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-1.5 border-b border-line p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-mute" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chercher un élément…"
              aria-label="Chercher dans la structure"
              className="w-full rounded-md border border-line bg-void py-1.5 pl-7 pr-2 text-sm text-white outline-none placeholder:text-mute focus:border-cyan lg:text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <button type="button" disabled={!!query || folded === all.length} onClick={() => save(new Set(all))} className="flex items-center gap-1 rounded px-1.5 py-1 text-mute hover:bg-white/5 hover:text-white disabled:opacity-40">
              <ChevronsDownUp className="size-3.5" aria-hidden /> Tout replier
            </button>
            <button type="button" disabled={!!query || folded === 0} onClick={() => save(new Set())} className="flex items-center gap-1 rounded px-1.5 py-1 text-mute hover:bg-white/5 hover:text-white disabled:opacity-40">
              <ChevronsUpDown className="size-3.5" aria-hidden /> Tout déplier
            </button>
            <button
              type="button"
              aria-pressed={focus}
              title="Ne garder ouverte que la section de l'élément sélectionné"
              onClick={() => {
                setFocus(!focus)
                store.set('nsp-structure-focus', focus ? '0' : '1')
              }}
              className={`ml-auto flex items-center gap-1 rounded px-1.5 py-1 ${focus ? 'bg-cyan/15 text-cyan' : 'text-mute hover:bg-white/5 hover:text-white'}`}
            >
              <Crosshair className="size-3.5" aria-hidden /> Suivre<span className="sr-only"> la sélection</span>
            </button>
          </div>
        </div>
        <div ref={list} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto p-2">
          {p.tree.sections.map((s) => (
            <SectionTree key={s.id} s={s} depth={0} p={p} />
          ))}
          {p.tree.sections.length === 0 && <p className="p-4 text-center text-sm text-mute">Ajoute ta première section.</p>}
          {query && shown?.size === 0 && <p className="p-4 text-center text-sm text-mute">Aucun élément ne contient « {query} ».</p>}
        </div>
        <MyBlocks p={p} />
        <div className="border-t border-line p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-mute">Nouvelle section</p>
          <div className="grid grid-cols-3 gap-2">
            {([1, 2, 3] as Columns[]).map((n) => (
              <button
                type="button"
                key={n}
                onClick={() => addSection(n)}
                className="flex flex-col items-center gap-1.5 rounded-md border border-line py-3 text-xs hover:border-cyan hover:text-cyan lg:py-2"
              >
                <span className="flex h-4 w-10 gap-0.5">
                  {Array.from({ length: n }, (_, i) => (
                    <span key={i} className="flex-1 rounded-sm bg-current opacity-60" />
                  ))}
                </span>
                {n} col
              </button>
            ))}
          </div>
        </div>
      </div>
    </TreeCtx.Provider>
  )
}
