import { createElement, useLayoutEffect, useRef } from 'react'
import { ImageIcon } from 'lucide-react'
import type { CSSProperties, ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'

import { firstImage } from '@/lib/images'

import { BLOCK_LABELS } from '@/lib/types'
import type { Block, ModuleTree, Section } from '@/lib/types'

// React mirror of the generated email HTML (same metrics as src/lib/hubl.ts),
// with click-to-select on every node. Once selected, headings, texts and
// button labels are edited in place. Image files dropped on an image replace
// it; dropped on another block or a column, they add a new image block.

interface Props {
  tree: ModuleTree
  selectedId: string | null
  onSelect: (id: string | null) => void
  onEdit: (id: string, patch: Partial<Block>) => void
  mobile: boolean
  onDropImage: (target: DropTarget, file: File) => void
}

export type DropTarget = { block: string } | { section: string; cell: number }

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
const dropProps = (target: DropTarget, onDropImage: Props['onDropImage']) => ({
  onDragOver: (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  },
  onDrop: (e: DragEvent) => {
    const file = firstImage(e.dataTransfer.files)
    if (!file) return
    e.preventDefault()
    e.stopPropagation()
    onDropImage(target, file)
  },
})

// contentEditable kept uncontrolled while focused so the caret never jumps;
// it is resynced from the tree whenever it isn't being typed into.
function Editable({
  as,
  value,
  rich,
  active,
  placeholder,
  style,
  onChange,
}: {
  as: string
  value: string
  rich?: boolean
  active: boolean
  placeholder: string
  style: CSSProperties
  onChange: (v: string) => void
}) {
  const ref = useRef<HTMLElement>(null)
  const latest = useRef(value)
  latest.current = value
  const sync = () => {
    const el = ref.current
    if (!el || document.activeElement === el) return
    if (rich) {
      if (el.innerHTML !== latest.current) el.innerHTML = latest.current
    } else if (el.textContent !== latest.current) el.textContent = latest.current
  }
  useLayoutEffect(sync)
  return createElement(as, {
    ref,
    style,
    className: 'neon-editable',
    'data-placeholder': placeholder,
    contentEditable: active,
    suppressContentEditableWarning: true,
    spellCheck: active,
    onInput: (e: { currentTarget: HTMLElement }) =>
      onChange(rich ? e.currentTarget.innerHTML : (e.currentTarget.textContent ?? '')),
    onBlur: () => setTimeout(sync),
    // Paste as plain text: no foreign styles or markup in the email.
    onPaste: (e: ClipboardEvent) => {
      e.preventDefault()
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Escape') e.currentTarget.blur()
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (rich) document.execCommand('insertLineBreak')
        else e.currentTarget.blur()
      }
    },
  })
}

function Node({
  id,
  label,
  editable,
  selectedId,
  onSelect,
  style,
  children,
  onDropImage,
}: {
  id: string
  label: string
  editable?: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  style?: CSSProperties
  children: ReactNode
  onDropImage?: Props['onDropImage']
}) {
  return (
    <div
      className="neon-node"
      {...(onDropImage ? dropProps({ block: id }, onDropImage) : {})}
      data-selected={selectedId === id}
      style={style}
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
        onSelect(id)
      }}
    >
      <span className="neon-tag">
        {label}
        {editable && selectedId === id && ' · clique pour écrire'}
      </span>
      {children}
    </div>
  )
}

function BlockView({ b, font, ...p }: { b: Block; font: string } & Omit<Props, 'tree'>) {
  const active = p.selectedId === b.id
  const edit = (patch: Partial<Block>) => p.onEdit(b.id, patch)
  const node = (children: ReactNode, style?: CSSProperties) => (
    <Node
      id={b.id}
      label={b.type !== 'section' && 'field' in b && b.field?.label ? b.field.label : BLOCK_LABELS[b.type]}
      editable={b.type === 'heading' || b.type === 'text' || b.type === 'button'}
      selectedId={p.selectedId} onSelect={p.onSelect} style={style} onDropImage={p.onDropImage}>
      {children}
    </Node>
  )
  switch (b.type) {
    case 'heading': {
      const Tag = `h${b.level}` as 'h2'
      return node(
        <Tag style={{ margin: 0, fontFamily: font, fontSize: b.size, lineHeight: 1.25, fontWeight: 700, color: b.color, textAlign: b.align }}>
          {b.text || ' '}
        </Tag>,
        { marginBottom: 12 },
      )
    }
    case 'text':
      return node(
        <div
          style={{ fontFamily: font, fontSize: b.size, lineHeight: 1.6, color: b.color, textAlign: b.align }}
          dangerouslySetInnerHTML={{ __html: b.html || '&nbsp;' }}
        />,
        { marginBottom: 12 },
      )
    case 'button':
      return node(
        <div style={{ textAlign: b.align }}>
          <Editable
            as="span"
            value={b.label}
            active={active}
            placeholder="Bouton"
            onChange={(label) => edit({ label })}
            style={{
              display: 'inline-block',
              padding: '12px 26px',
              background: b.bg,
              color: b.color,
              borderRadius: b.radius,
              fontFamily: font,
              fontSize: 15,
              fontWeight: 700,
            }}
          />
        </div>,
        { marginBottom: 12 },
      )
    case 'image':
      return node(
        <div style={{ textAlign: b.align, lineHeight: 0 }}>
          {b.src ? (
            <img src={b.src} alt={b.alt} style={{ display: 'inline-block', width: `${b.width}%`, maxWidth: '100%', height: 'auto' }} />
          ) : (
            <div
              style={{ width: `${b.width}%`, display: 'inline-flex' }}
              className="aspect-[2/1] items-center justify-center gap-2 rounded border-2 border-dashed border-[#c8c8dc] bg-[#f4f4fa] text-xs leading-none text-[#8a8aa8]"
            >
              <ImageIcon className="size-4" /> {active ? 'Dépose ou téléverse une image' : 'Ajoute une image'}
            </div>
          )}
        </div>,
        { marginBottom: 12 },
      )
    case 'divider':
      return node(<hr style={{ border: 0, borderTop: `1px solid ${b.color}`, margin: 0 }} />, { padding: '16px 0' })
    case 'spacer':
      return node(<div style={{ height: b.height }} />)
    case 'raw':
      return node(
        <code className="block rounded border border-dashed border-[#bc13fe]/50 bg-[#bc13fe]/5 px-2 py-1 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-[#7a0fb0]">
          {b.html}
        </code>,
        { marginBottom: 12 },
      )
    case 'section':
      return <SectionView s={b} font={font} nested {...p} />
  }
}

function SectionView({ s, font, nested, ...p }: { s: Section; font: string; nested?: boolean } & Omit<Props, 'tree'>) {
  const stacked = p.mobile && s.behavior === 'stack'
  return (
    <Node
      id={s.id}
      label={`${nested ? 'Card' : 'Section'} · ${s.columns} col`}
      selectedId={p.selectedId}
      onSelect={p.onSelect}
      style={{ background: s.bg, borderRadius: s.radius, marginBottom: nested ? 12 : 0 }}
    >
      <div style={{ display: 'flex', flexDirection: stacked ? 'column' : 'row' }}>
        {s.cells.map((cell, i) => {
          const last = i === s.cells.length - 1
          const left = stacked || i === 0 ? s.padding : s.padding / 2
          const right = stacked || last ? s.padding : s.padding / 2
          return (
            <div
              key={i}
              {...dropProps({ section: s.id, cell: i }, p.onDropImage)}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                padding: `${stacked && i > 0 ? 0 : s.padding}px ${right}px ${s.padding}px ${left}px`,
              }}
            >
              {cell.length === 0 && (
                <div className="rounded border border-dashed border-[#c8c8dc] p-3 text-center text-xs text-[#8a8aa8]">
                  Colonne vide
                </div>
              )}
              {cell.map((b) => (
                <BlockView key={b.id} b={b} font={font} {...p} />
              ))}
            </div>
          )
        })}
      </div>
    </Node>
  )
}

export function Preview({ tree, ...p }: Props) {
  return (
    <div
      className="min-h-full py-6"
      style={{ background: tree.bg }}
      onClick={() => p.onSelect(null)}
    >
      <div style={{ maxWidth: p.mobile ? 375 : tree.width, margin: '0 auto', transition: 'max-width 200ms' }}>
        {tree.sections.map((s) => (
          <SectionView key={s.id} s={s} font={tree.font} {...p} />
        ))}
      </div>
    </div>
  )
}
