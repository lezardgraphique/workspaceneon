import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { buttonBold, buttonBorder, buttonBorderColor, buttonFontSize } from '@/lib/vml'
import { ImageIcon } from 'lucide-react'
import type { CSSProperties, ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'

import { firstImage } from '@/lib/images'
import { isSafeUrl, sanitizeHtml } from '@/lib/sanitize'

import type { MoveTarget } from '@/lib/tree'
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
  // Long press + drag on a touch screen: move block `id` to `target`.
  onMove?: (id: string, target: MoveTarget) => void
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
      const clean = sanitizeHtml(latest.current)
      if (el.innerHTML !== clean) el.innerHTML = clean
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
      data-nid={id}
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
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.html) || '&nbsp;' }}
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
              padding: b.height ? '0 26px' : '12px 26px',
              ...(b.height ? { lineHeight: `${b.height - 2 * buttonBorder(b)}px` } : {}),
              background: b.bg,
              color: b.color,
              ...(buttonBorder(b) ? { border: `${buttonBorder(b)}px solid ${buttonBorderColor(b)}` } : {}),
              borderRadius: b.radius,
              fontFamily: font,
              fontSize: buttonFontSize(b),
              fontWeight: buttonBold(b) ? 700 : 400,
            }}
          />
        </div>,
        { marginBottom: 12 },
      )
    case 'image':
      return node(
        <div style={{ textAlign: b.align, lineHeight: 0 }}>
          {b.src ? (
            <img src={isSafeUrl(b.src, true) ? b.src : ''} alt={b.alt} style={{ display: 'inline-block', width: `${b.width}%`, maxWidth: '100%', height: 'auto' }} />
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
      // The tree reaching the preview is already interpreted: show the result.
      return node(
        b.html.trim() ? (
          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.html) }} />
        ) : (
          <div className="h-3" />
        ),
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
              data-cell={`${s.id}:${i}`}
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

// ── Touch drag ───────────────────────────────────────────────────────────────
// Long press on a block, then drag: a pink line shows where it will land, the
// view scrolls near the edges, releasing drops it. The arrows stay available.
interface DragView {
  label: string
  x: number
  y: number
  line: { top: number; left: number; width: number } | null
}
const HOLD_MS = 380
const HINT_KEY = 'nsp-drag-done'
const baseId = (id: string) => id.split('~')[0]

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY
    if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n
  }
  return null
}

// Where would a block dropped at (x, y) land? Also the line to draw.
function dropAt(root: HTMLElement, dragged: HTMLElement, x: number, y: number): { target: MoveTarget; line: NonNullable<DragView['line']> } | null {
  const hit = document.elementFromPoint(x, y)
  if (!hit || !root.contains(hit)) return null
  const free = (el: Element) => el !== dragged && !dragged.contains(el)
  const cell = hit.closest<HTMLElement>('[data-cell]')
  const node = hit.closest<HTMLElement>('[data-nid]')
  const line = (r: DOMRect, at: number) => ({ top: at, left: r.left, width: r.width })

  if (cell && (!node || node.contains(cell))) {
    // Between the blocks of a column (or in an empty one).
    const [sectionId, idx] = [cell.dataset.cell!.slice(0, cell.dataset.cell!.lastIndexOf(':')), Number(cell.dataset.cell!.slice(cell.dataset.cell!.lastIndexOf(':') + 1))]
    if (!free(cell)) return null
    const kids = [...cell.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute('data-nid') && free(c))
    if (!kids.length) {
      const r = cell.getBoundingClientRect()
      return { target: { section: sectionId, cell: idx }, line: line(r, r.top + 6) }
    }
    const next = kids.find((k) => y < k.getBoundingClientRect().top + k.getBoundingClientRect().height / 2)
    const k = next ?? kids[kids.length - 1]
    const r = k.getBoundingClientRect()
    return next
      ? { target: { before: baseId(k.dataset.nid!) }, line: line(r, r.top) }
      : { target: { after: baseId(k.dataset.nid!) }, line: line(r, r.bottom) }
  }
  if (!node || !free(node)) return null
  const r = node.getBoundingClientRect()
  return y < r.top + r.height / 2
    ? { target: { before: baseId(node.dataset.nid!) }, line: line(r, r.top) }
    : { target: { after: baseId(node.dataset.nid!) }, line: line(r, r.bottom) }
}

function useTouchDrag(root: React.RefObject<HTMLDivElement | null>, onMove: Props['onMove'], setView: (v: DragView | null) => void) {
  const move = useRef(onMove)
  move.current = onMove
  useEffect(() => {
    const el = root.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let start: { x: number; y: number; node: HTMLElement } | null = null
    let drag: { id: string; node: HTMLElement; label: string; scroller: HTMLElement | null } | null = null
    let point = { x: 0, y: 0 }
    let current: ReturnType<typeof dropAt> = null
    let raf = 0
    let swallowClick = false

    const update = () => {
      if (!drag) return
      current = dropAt(el, drag.node, point.x, point.y)
      setView({ label: drag.label, x: point.x, y: point.y, line: current?.line ?? null })
    }
    const tick = () => {
      if (!drag) return
      const sc = drag.scroller
      if (sc) {
        const r = sc.getBoundingClientRect()
        const edge = 72
        const dy = point.y < r.top + edge ? -Math.ceil((r.top + edge - point.y) / 5) : point.y > r.bottom - edge ? Math.ceil((point.y - (r.bottom - edge)) / 5) : 0
        if (dy) {
          sc.scrollTop += dy
          update()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    const stop = () => {
      clearTimeout(timer)
      start = null
      if (!drag) return
      cancelAnimationFrame(raf)
      drag.node.removeAttribute('data-dragging')
      el.classList.remove('neon-dragging')
      const done = drag
      drag = null
      setView(null)
      if (current) {
        move.current?.(done.id, current.target)
        try {
          localStorage.setItem(HINT_KEY, '1')
        } catch {
          /* ignore */
        }
      }
      current = null
      swallowClick = true
      setTimeout(() => (swallowClick = false), 400)
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !move.current) return stop()
      const t = e.target instanceof Element ? e.target : null
      if (!t || t.closest('[contenteditable="true"]')) return
      const node = t.closest<HTMLElement>('[data-nid]')
      if (!node || node.dataset.nid!.includes('~')) return
      const touch = e.touches[0]
      start = { x: touch.clientX, y: touch.clientY, node }
      point = { x: touch.clientX, y: touch.clientY }
      timer = setTimeout(() => {
        if (!start) return
        const n = start.node
        const tag = n.querySelector(':scope > .neon-tag')?.textContent?.split('·')[0].trim() ?? 'Bloc'
        drag = { id: n.dataset.nid!, node: n, label: tag, scroller: scrollParent(el) }
        n.setAttribute('data-dragging', 'true')
        el.classList.add('neon-dragging')
        navigator.vibrate?.(14)
        update()
        raf = requestAnimationFrame(tick)
      }, HOLD_MS)
    }
    const onMoveTouch = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      point = { x: touch.clientX, y: touch.clientY }
      if (drag) {
        e.preventDefault() // no scrolling while dragging
        update()
      } else if (start && Math.hypot(point.x - start.x, point.y - start.y) > 10) {
        clearTimeout(timer) // it is a scroll, not a long press
        start = null
      }
    }
    const onContext = (e: Event) => {
      if (drag || start) e.preventDefault() // no image / text menu during the press
    }
    const onClick = (e: Event) => {
      if (swallowClick) {
        e.stopPropagation()
        e.preventDefault()
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMoveTouch, { passive: false })
    el.addEventListener('touchend', stop)
    el.addEventListener('touchcancel', stop)
    el.addEventListener('contextmenu', onContext)
    el.addEventListener('click', onClick, true)
    return () => {
      stop()
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMoveTouch)
      el.removeEventListener('touchend', stop)
      el.removeEventListener('touchcancel', stop)
      el.removeEventListener('contextmenu', onContext)
      el.removeEventListener('click', onClick, true)
    }
  }, [root, setView])
}

export function Preview({ tree, ...p }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<DragView | null>(null)
  const [hint, setHint] = useState(false)
  useTouchDrag(root, p.onMove, setView)
  useEffect(() => {
    try {
      setHint(!!p.onMove && matchMedia('(pointer: coarse)').matches && !localStorage.getItem(HINT_KEY))
    } catch {
      /* ignore */
    }
  }, [p.onMove])
  return (
    <div
      ref={root}
      className="min-h-full py-6"
      style={{ background: tree.bg, color: '#3a3a52', fontFamily: tree.font }}
      onClick={() => p.onSelect(null)}
    >
      <div style={{ maxWidth: p.mobile ? 375 : tree.width, margin: '0 auto', transition: 'max-width 200ms' }}>
        {tree.sections.map((s) => (
          <SectionView key={s.id} s={s} font={tree.font} {...p} />
        ))}
      </div>
      {hint && !view && (
        <p className="mx-auto mt-4 max-w-xs px-4 text-center text-xs text-[#8a8aa8]">Astuce : maintiens un bloc appuyé, puis glisse-le pour le déplacer.</p>
      )}
      {view && (
        <>
          {view.line && <div className="pointer-events-none fixed z-50 h-[3px] rounded-full bg-[#ff007f] shadow-[0_0_10px_#ff007f]" style={{ top: view.line.top - 1.5, left: view.line.left, width: view.line.width }} />}
          <div className="pointer-events-none fixed z-50 -translate-x-1/2 rounded-full bg-[#ff007f] px-3 py-1 text-xs font-semibold text-white shadow-lg" style={{ left: Math.min(Math.max(view.x, 70), (typeof window === 'undefined' ? 400 : window.innerWidth) - 70), top: Math.max(8, view.y - 64) }}>
            {view.label}
          </div>
        </>
      )}
    </div>
  )
}
