import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Code,
  Copy,
  Heading,
  Image,
  Layers,
  Minus,
  MousePointerClick,
  MoveVertical,
  Plus,
  Trash2,
  Type,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { withNewIds } from '@/lib/custom-blocks'
import { isLogicBlock } from '@/lib/hubl-render'
import { useCustomBlocks } from './useCustomBlocks'
import { BLOCK_LABELS, createBlock, createSection } from '@/lib/types'
import type { Block, BlockType, Columns, ModuleTree, Section } from '@/lib/types'
import { duplicateNode, insertInCell, moveNode, removeNode } from '@/lib/tree'

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
      return `${b.columns} colonne${b.columns > 1 ? 's' : ''}`
    default:
      return ''
  }
}

function Row({ b, depth, p, nested }: { b: Block; depth: number; p: Props; nested?: boolean }) {
  const Icon = BLOCK_ICONS[b.type]
  const selected = p.selectedId === b.id
  const act = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation()
    fn()
  }
  return (
    <div
      onClick={() => p.onSelect(b.id)}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={`group flex cursor-pointer items-center gap-2 rounded-md py-2.5 pr-1 text-sm lg:py-1.5 ${
        selected ? 'bg-pink/15 text-white ring-1 ring-pink/60' : 'text-[#c9c9de] hover:bg-white/5'
      }`}
    >
      <Icon className={`size-3.5 shrink-0 ${b.type === 'section' ? 'text-cyan' : 'text-mute'}`} />
      <span className="shrink-0 font-medium">{b.type === 'section' && !nested ? 'Section' : isLogicBlock(b) ? 'Logique' : BLOCK_LABELS[b.type]}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-mute">{preview(b)}</span>
      <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
        {[
          { icon: ArrowUp, label: 'Monter', fn: () => p.commit(moveNode(p.tree, b.id, -1)) },
          { icon: ArrowDown, label: 'Descendre', fn: () => p.commit(moveNode(p.tree, b.id, 1)) },
          { icon: Copy, label: 'Dupliquer', fn: () => p.commit(duplicateNode(p.tree, b.id)) },
          { icon: Trash2, label: 'Supprimer', fn: () => p.commit(removeNode(p.tree, b.id), null) },
        ].map((a) => (
          <button
            key={a.label}
            title={a.label}
            aria-label={a.label}
            onClick={(e) => act(e, a.fn)}
            className="rounded p-1 text-mute hover:bg-white/10 hover:text-white"
          >
            <a.icon className="size-3" />
          </button>
        ))}
      </span>
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
          {custom.length > 0 && (
            <>
              <p className="col-span-2 px-2 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-mute/70">Mes blocs</p>
              {custom.map((c) => (
                <button
                  key={c.id}
                  title={c.description || c.name}
                  onClick={() => {
                    const block = withNewIds(c.section)
                    p.commit(insertInCell(p.tree, section.id, cell, block), block.id)
                    setOpen(false)
                  }}
                  className="flex items-center gap-1.5 rounded px-2 py-2.5 text-left text-sm text-[#c9c9de] hover:bg-pink/15 hover:text-white lg:py-1 lg:text-xs"
                >
                  <Layers className="size-3 shrink-0 text-pink" /> <span className="truncate">{c.name}</span>
                </button>
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
  return (
    <div>
      <Row b={s} depth={depth} p={p} nested={nested} />
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
            ) : (
              <Row key={b.id} b={b} depth={depth + 1} p={p} />
            ),
          )}
          <AddMenu section={s} cell={i} depth={depth + 1} p={p} />
        </div>
      ))}
    </div>
  )
}

export function Structure(p: Props) {
  const addSection = (n: Columns) => {
    const s = createSection(n)
    p.commit({ ...p.tree, sections: [...p.tree.sections, s] }, s.id)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {p.tree.sections.map((s) => (
          <SectionTree key={s.id} s={s} depth={0} p={p} />
        ))}
        {p.tree.sections.length === 0 && <p className="p-4 text-center text-sm text-mute">Ajoute ta première section.</p>}
      </div>
      <div className="border-t border-line p-3">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-mute">Nouvelle section</p>
        <div className="grid grid-cols-3 gap-2">
          {([1, 2, 3] as Columns[]).map((n) => (
            <button
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
  )
}
