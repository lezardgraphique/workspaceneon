import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Copy, CornerLeftUp, GripVertical, Trash2 } from 'lucide-react'
import type { DragEvent, MouseEvent } from 'react'

import { PATH_ATTR, canPlace, duplicateAt, factsOf, moveAt, removeAt, setAttr, setInner, stampPaths, stepAt, steppedPath } from '@/lib/html-block'
import { isSafeUrl, sanitizeHtml } from '@/lib/sanitize'

// The selected "Bloc HTML", rendered from its own code and editable in place:
// a click picks an element (outlined, with a small toolbar), a text is typed
// into directly, an image or a link gets its address fields, and elements are
// dragged among the others of the block (or moved with the arrows). Every
// change rewrites the block's code at that element only (src/lib/html-block.ts).

const NAMES: Record<string, string> = {
  A: 'Lien',
  IMG: 'Image',
  P: 'Paragraphe',
  H1: 'Titre 1',
  H2: 'Titre 2',
  H3: 'Titre 3',
  H4: 'Titre 4',
  TABLE: 'Tableau',
  TR: 'Ligne',
  TD: 'Cellule',
  TH: 'Cellule',
  UL: 'Liste',
  OL: 'Liste',
  LI: 'Élément de liste',
  DIV: 'Bloc',
  SPAN: 'Texte',
  BUTTON: 'Bouton',
  HR: 'Séparateur',
  STRONG: 'Gras',
  B: 'Gras',
  EM: 'Italique',
}

type Drop = { path: string; where: 'before' | 'after'; box: { top: number; left: number; width: number; height: number }; horizontal: boolean }

export function HtmlBlockEditor({ html, font, onChange }: { html: string; font: string; onChange: (html: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const stamped = useMemo(() => stampPaths(html), [html])
  const shown = useMemo(() => sanitizeHtml(stamped.html), [stamped.html])
  const [sel, setSel] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  // The toolbar floats over the page (the e-mail frame would cut it): screen position under the block.
  const [bar, setBar] = useState<{ top: number; left: number } | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const [moving, setMoving] = useState(false)
  const dragging = useRef<string | null>(null)
  const facts = useMemo(() => (sel ? factsOf(html, sel) : null), [html, sel])

  const elAt = (path: string) => box.current?.querySelector<HTMLElement>(`[${PATH_ATTR}="${path}"]`) ?? null
  const relRect = (el: Element) => {
    const b = box.current!.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return { top: r.top - b.top, left: r.left - b.left, width: r.width, height: r.height }
  }

  // Outline and toolbar follow the selected element (also after each change).
  useLayoutEffect(() => {
    const root = box.current
    if (!root) return
    root.querySelectorAll('[data-nsp-sel]').forEach((e) => e.removeAttribute('data-nsp-sel'))
    root.querySelectorAll<HTMLElement>(`[${PATH_ATTR}]`).forEach((e) => {
      e.draggable = stamped.ok && editing !== e.getAttribute(PATH_ATTR)
    })
    const el = sel ? elAt(sel) : null
    if (el) {
      el.setAttribute('data-nsp-sel', '')
      setRect(relRect(el))
    } else setRect(null)
  }, [sel, shown, editing, stamped.ok])

  useEffect(() => {
    if (!sel) return setBar(null)
    const place = () => {
      const b = box.current?.getBoundingClientRect()
      const el = elAt(sel)?.getBoundingClientRect()
      if (!b || !el) return setBar(null)
      const top = Math.min(b.bottom + 6, window.innerHeight - 90)
      setBar({ top, left: Math.max(8, Math.min(el.left, window.innerWidth - 340)) })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [sel, shown])

  // A text being typed is saved when it loses focus (the caret never jumps).
  useEffect(() => {
    if (!editing) return
    const el = elAt(editing)
    if (!el) return
    el.contentEditable = 'true'
    el.focus()
    const save = () => {
      el.contentEditable = 'false'
      const path = editing
      setEditing(null)
      onChange(setInner(html, path, sanitizeHtml(el.innerHTML)))
    }
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') el.blur()
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        document.execCommand('insertLineBreak')
      }
    }
    // Paste as plain text: no foreign styles in the e-mail.
    const paste = (e: ClipboardEvent) => {
      e.preventDefault()
      document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '')
    }
    el.addEventListener('blur', save, { once: true })
    el.addEventListener('keydown', keys)
    el.addEventListener('paste', paste)
    return () => {
      el.removeEventListener('blur', save)
      el.removeEventListener('keydown', keys)
      el.removeEventListener('paste', paste)
    }
  }, [editing])

  if (!stamped.ok)
    return (
      <div>
        <div style={{ fontFamily: font }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) || '&nbsp;' }} />
        <p className="mt-1 rounded bg-[#fff4d6] px-2 py-1 font-sans text-[11px] text-[#7a5a00]">
          Ce code ne peut pas être modifié dans l'aperçu (balises de tableau isolées, par exemple) : modifie-le dans les Réglages.
        </p>
      </div>
    )

  const pick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest(`[${PATH_ATTR}]`)
    if (!t || !box.current?.contains(t)) return
    // Links never navigate while editing.
    e.preventDefault()
    const path = t.getAttribute(PATH_ATTR)!
    if (editing === path) return
    if (sel === path && factsOf(html, path)?.text) setEditing(path)
    else setSel(path)
  }

  const onDragStart = (e: DragEvent) => {
    let t = (e.target as HTMLElement).closest(`[${PATH_ATTR}]`)
    if (!t) return
    // Dragging from inside the selected element moves the selected element
    // (select a cell or a box with « Parent », then drag it by any of its content).
    const chosen = sel ? elAt(sel) : null
    if (chosen && chosen.contains(t)) t = chosen
    e.stopPropagation()
    dragging.current = t.getAttribute(PATH_ATTR)
    setMoving(true)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-nsp-html', dragging.current!)
  }
  const onDragOver = (e: DragEvent) => {
    const from = dragging.current
    if (!from) return
    // The first element around the pointer that can take it (a cell next to a cell…).
    let t = (e.target as HTMLElement).closest(`[${PATH_ATTR}]`)
    const fromTag = elAt(from)?.tagName ?? ''
    while (t && !canPlace(from, fromTag, t.getAttribute(PATH_ATTR)!, t.tagName)) t = t.parentElement?.closest(`[${PATH_ATTR}]`) ?? null
    const to = t?.getAttribute(PATH_ATTR)
    if (!t || !to || !box.current?.contains(t)) return setDrop(null)
    e.preventDefault()
    e.stopPropagation()
    const r = t.getBoundingClientRect()
    const display = getComputedStyle(t).display
    const horizontal = /table-cell|inline/.test(display)
    const where = horizontal ? (e.clientX < r.left + r.width / 2 ? 'before' : 'after') : e.clientY < r.top + r.height / 2 ? 'before' : 'after'
    setDrop({ path: to, where, box: relRect(t), horizontal })
  }
  const onDrop = (e: DragEvent) => {
    const from = dragging.current
    dragging.current = null
    setMoving(false)
    const d = drop
    setDrop(null)
    if (!from || !d) return
    e.preventDefault()
    e.stopPropagation()
    setSel(null)
    onChange(moveAt(html, from, d.path, d.where))
  }

  const change = (next: string, nextSel: string | null = sel) => {
    setSel(nextSel)
    onChange(next)
  }

  return (
    <div className="relative">
      <div
        ref={box}
        className="neon-html"
        style={{ fontFamily: font }}
        onClick={pick}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!box.current?.contains(e.relatedTarget as Node)) setDrop(null)
        }}
        onDrop={onDrop}
        onDragEnd={() => {
          dragging.current = null
          setMoving(false)
          setDrop(null)
        }}
        dangerouslySetInnerHTML={{ __html: shown }}
      />
      {drop && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 rounded bg-cyan shadow-[0_0_8px_var(--color-cyan)]"
          style={
            drop.horizontal
              ? { top: drop.box.top, height: drop.box.height, width: 3, left: drop.where === 'before' ? drop.box.left - 2 : drop.box.left + drop.box.width - 1 }
              : { left: drop.box.left, width: drop.box.width, height: 3, top: drop.where === 'before' ? drop.box.top - 2 : drop.box.top + drop.box.height - 1 }
          }
        />
      )}
      {sel && rect && bar && facts && !editing && !moving && createPortal(
        <div
          role="toolbar"
          aria-label={`${NAMES[facts.tag] ?? facts.tag.toLowerCase()} du bloc HTML`}
          className="fixed z-50 flex max-w-[min(520px,calc(100vw-16px))] flex-wrap items-center gap-1 rounded-lg border border-line bg-night/95 p-1 font-sans text-[11px] text-white shadow-lg"
          // Under the block, never over its content (which stays clickable and draggable).
          style={{ top: bar.top, left: bar.left }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="flex items-center gap-1 px-1 text-mute">
            <GripVertical className="size-3" aria-hidden /> {NAMES[facts.tag] ?? facts.tag.toLowerCase()}
          </span>
          {sel.includes('.') && (
            <button type="button" aria-label="Sélectionner l'élément parent" title="Sélectionner l'élément parent" className="rounded p-1.5 hover:bg-white/10" onClick={() => setSel(sel.split('.').slice(0, -1).join('.'))}>
              <CornerLeftUp className="size-3" />
            </button>
          )}
          {facts.text && (
            <button type="button" className="rounded px-1.5 py-1 hover:bg-white/10" onClick={() => setEditing(sel)}>
              Écrire
            </button>
          )}
          <button type="button" aria-label="Monter" title="Monter" disabled={facts.first} className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30" onClick={() => change(stepAt(html, sel, -1), steppedPath(sel, -1))}>
            <ArrowUp className="size-3" />
          </button>
          <button type="button" aria-label="Descendre" title="Descendre" disabled={facts.last} className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30" onClick={() => change(stepAt(html, sel, 1), steppedPath(sel, 1))}>
            <ArrowDown className="size-3" />
          </button>
          <button type="button" aria-label="Dupliquer" title="Dupliquer" className="rounded p-1.5 hover:bg-white/10" onClick={() => change(duplicateAt(html, sel))}>
            <Copy className="size-3" />
          </button>
          <button type="button" aria-label="Supprimer" title="Supprimer" className="rounded p-1.5 hover:bg-white/10 hover:text-pink" onClick={() => change(removeAt(html, sel), null)}>
            <Trash2 className="size-3" />
          </button>
          {facts.src !== undefined && (
            <>
              <AttrInput label="Adresse de l'image" value={facts.src} onCommit={(v) => isSafeUrl(v, true) && change(setAttr(html, sel, 'src', v))} />
              <AttrInput label="Texte alternatif" value={facts.alt ?? ''} onCommit={(v) => change(setAttr(html, sel, 'alt', v))} />
            </>
          )}
          {facts.href !== undefined && <AttrInput label="Lien" value={facts.href} onCommit={(v) => (isSafeUrl(v) || /\{\{/.test(v)) && change(setAttr(html, sel, 'href', v))} />}
        </div>,
        // Inside the page's main region (accessibility), fixed so the e-mail frame can't cut it.
        document.querySelector('main') ?? document.body,
      )}
    </div>
  )
}

// Saved on Enter or when leaving the field.
function AttrInput({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => v !== value && onCommit(v.trim())
  return (
    <input
      aria-label={label}
      placeholder={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setV(value)
      }}
      className="h-7 w-40 rounded border border-line bg-void px-2 text-[11px] text-white outline-none focus:border-pink"
    />
  )
}
