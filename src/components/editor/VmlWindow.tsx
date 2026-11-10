import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Minus, Plus, Shapes, X } from 'lucide-react'

import { EmailFrame } from '@/components/EmailFrame'
import { CLIENTS, renderForClient } from '@/lib/clients'
import { interpretForPreview } from '@/lib/hubl-render'
import { standaloneEmail } from '@/lib/hubl'
import { BLOCK_LABELS } from '@/lib/types'

import { highlight } from '@/components/editor/CodeEditor'
import { OutlookPanel, countButtons, olBase, olPatch, patchAllButtons } from './OutlookPanel'
import { AlignField, ButtonLookFields, ColorField, Field, Inspector, RangeField, input, mono } from '@/components/editor/Inspector'
import { BLOCK_ICONS } from '@/components/editor/Structure'
import { esc, escKeep } from '@/lib/hubl'
import { isSafeUrl } from '@/lib/sanitize'
import { findNode, updateNode } from '@/lib/tree'
import type { Block, ButtonBlock, ModuleTree, Section } from '@/lib/types'
import { arcSize, buttonBold, buttonBorder, buttonBorderColor, buttonFontSize, buttonWidth, msoOnly, outlookHeight, vmlShape } from '@/lib/vml'

// Floating window (it doesn't block the editor) showing, live, the VML drawn
// for Outlook on Windows: which buttons get a shape, its size and its code.
// Everything is derived from the tree, so it follows every edit.

interface Item {
  id: string
  block: ButtonBlock
  label: string
  path: string
  width: number
  auto: number
  manual: boolean
  arc: number
  hubl: boolean
  code: string
}
interface Group {
  id: string
  title: string
  items: Item[]
}

// The shape is wrapped in a conditional comment: colour the comment lines apart
// and the shape itself as markup, otherwise everything reads as one grey comment.
function highlightVml(code: string) {
  const lines = code.split('\n')
  const open = lines.shift() ?? ''
  const close = lines.pop() ?? ''
  return `<span class="hl-comment">${esc(open)}</span>\n${highlight(lines.join('\n'))}\n<span class="hl-comment">${esc(close)}</span>`
}

const hasHubl = (s: string) => /\{[{%]/.test(s)

function itemFor(b: ButtonBlock, path: string, font: string): Item {
  const auto = buttonWidth(b.label, b)
  const width = b.vmlWidth ?? auto
  const height = outlookHeight(b)
  const code = msoOnly(
    vmlShape({
      href: isSafeUrl(b.href) ? escKeep(b.href) : '#',
      label: escKeep(b.label),
      bg: escKeep(b.bg),
      color: escKeep(b.color),
      radius: b.radius,
      font: esc(font),
      width,
      height,
      fontSize: buttonFontSize(b),
      bold: buttonBold(b),
      borderWidth: buttonBorder(b),
      borderColor: escKeep(buttonBorderColor(b)),
    }),
  )
  return { id: b.id, block: b, label: b.label || 'Bouton', path, width, auto, manual: !!b.vmlWidth, arc: b.radius > 0 ? arcSize(b.radius, width, height) : 0, hubl: hasHubl(b.label), code }
}

export function collectVml(tree: ModuleTree): { groups: Group[]; rounded: number } {
  const groups: Group[] = []
  let rounded = 0
  const visit = (s: Section, title: string) => {
    if (s.radius > 0) rounded++
    const items: Item[] = []
    s.cells.forEach((cell, ci) => {
      const walk = (blocks: Block[]) => {
        blocks.forEach((b) => {
          if (b.type === 'button') items.push(itemFor(b, s.columns > 1 ? `colonne ${ci + 1}` : '', tree.font))
          else if (b.type === 'section') visit(b, `${title} › carte`)
        })
      }
      walk(cell)
    })
    if (items.length) groups.push({ id: s.id, title: `${title}${s.columns > 1 ? ` · ${s.columns} col` : ''}`, items })
  }
  tree.sections.forEach((s, i) => visit(s, `Section ${i + 1}`))
  return { groups, rounded }
}

// Order of the editable nodes in the rendered email: sections, then the blocks
// of each cell, nested cards included (columns and the module are not nodes).
function orderedIds(sections: Section[]): string[] {
  const out: string[] = []
  const block = (b: Block) => {
    out.push(b.id)
    if (b.type === 'section') b.cells.forEach((c) => c.forEach(block))
  }
  sections.forEach(block)
  return out
}

const NODE = '[data-neon]:not([data-neon="column"]):not([data-neon="module"])'

const summary = (b: Block): string => {
  switch (b.type) {
    case 'heading':
      return b.text
    case 'text':
      return b.html.replace(/<[^>]+>/g, ' ').trim()
    case 'button':
      return b.label
    case 'image':
      return b.alt || 'image'
    case 'spacer':
      return `${b.height}px`
    case 'raw':
      return b.html.replace(/<[^>]+>/g, ' ').trim().slice(0, 40) || 'code'
    default:
      return ''
  }
}

function Outline({ tree, selectedId, onSelect }: { tree: ModuleTree; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const rows: { b: Block; depth: number; title: string }[] = []
  const walk = (b: Block, depth: number, title: string) => {
    rows.push({ b, depth, title })
    if (b.type === 'section') {
      b.cells.forEach((cell, ci) => cell.forEach((c) => walk(c, depth + 1 + (b.columns > 1 ? 1 : 0), b.columns > 1 ? `col. ${ci + 1}` : '')))
    }
  }
  tree.sections.forEach((s) => walk(s, 0, ''))
  let n = 0
  return (
    <ul className="space-y-0.5" aria-label="Structure du module">
      <li>
        <button
          onClick={() => onSelect(null)}
          aria-current={selectedId === null}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${selectedId === null ? 'bg-violet/15 text-white' : 'text-mute hover:bg-white/5 hover:text-white'}`}
        >
          Module · {tree.width}px
        </button>
      </li>
      {rows.map(({ b, depth, title }) => {
        const Icon = BLOCK_ICONS[b.type]
        const isSection = b.type === 'section'
        if (isSection && depth === 0) n++
        const active = selectedId === b.id
        const label = isSection ? (depth === 0 ? `Section ${n}` : 'Card') : BLOCK_LABELS[b.type]
        return (
          <li key={b.id} style={{ paddingLeft: depth * 12 }}>
            {title && <p className="px-2 pt-1 font-mono text-[9px] uppercase tracking-wider text-mute/70">{title}</p>}
            <button
              onClick={() => onSelect(b.id)}
              aria-current={active}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${active ? 'bg-violet/15 text-white' : 'text-mute hover:bg-white/5 hover:text-white'}`}
            >
              <Icon className={`size-3.5 shrink-0 ${b.type === 'button' ? 'text-pink' : isSection ? 'text-violet' : 'text-cyan'}`} />
              <span className="min-w-0 flex-1 truncate">
                {label}
                {!isSection && summary(b) && <span className="ml-1.5 text-xs text-mute">{summary(b)}</span>}
                {isSection && <span className="ml-1.5 text-xs text-mute">{(b as Section).columns} col</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// The whole module as Outlook for Windows draws it, live. Click an element to
// edit it; the comparison switch shows the module without or with VML.
function OutlookPreview({
  tree,
  name,
  selectedId,
  onSelect,
  onTweak,
  onTree,
}: {
  tree: ModuleTree
  name: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  onTweak: (id: string, patch: Partial<Block>) => void
  onTree: (t: ModuleTree) => void
}) {
  // "normal" reproduces the editor's preview (modern mail client); the two
  // others show what Outlook for Windows draws without / with the VML.
  const [mode, setMode] = useState<'normal' | 'sans' | 'avec'>('normal')
  const docRef = useRef<Document | null>(null)

  const { html, ids } = useMemo(() => {
    const interp = interpretForPreview({ ...tree, vml: mode === 'avec' }, 'known').tree
    const client = CLIENTS.find((c) => c.id === (mode === 'normal' ? 'apple-mail' : 'outlook-win'))!
    return { html: renderForClient(standaloneEmail(interp, name), client, { imagesOff: false }), ids: orderedIds(interp.sections) }
  }, [tree, name, mode])

  const idsRef = useRef(ids)
  idsRef.current = ids
  const selRef = useRef(selectedId)
  selRef.current = selectedId
  const pick = useRef(onSelect)
  pick.current = onSelect

  const dragEnd = useRef(0)
  const treeRef = useRef(tree)
  treeRef.current = tree
  const modeRef = useRef(mode)
  modeRef.current = mode
  const tweak = useRef(onTweak)
  tweak.current = onTweak

  // Pink handles on the selected element, in the Outlook views: drag the bottom /
  // top edge for the margins (height of a spacer, padding of a section), the right
  // edge for the width of an image or of a button drawn in VML. The element follows
  // the pointer; the change is committed on release.
  const handles = useCallback((doc: Document, el: Element, id: string) => {
    doc.querySelectorAll('.nsp-h').forEach((h) => h.remove())
    const node = findNode(treeRef.current, id)
    if (!node || node.type === 'raw' || modeRef.current === 'normal') return
    // A button's box in Outlook: the VML shape, or the coloured cell without VML.
    const vmlBtn = node.type === 'button' ? ((el.querySelector('a[data-vml]') ?? el.querySelector('td[bgcolor]')) as HTMLElement | null) : null
    const target = (node.type === 'image' ? el.querySelector('img') : vmlBtn) as HTMLElement | null
    const make = (cls: string, title: string, rect: { left: number; top: number }, run: (d: number) => { live: () => void; commit: () => void } | null, axis: 'x' | 'y', start: () => number) => {
      const h = doc.createElement('div')
      h.className = `nsp-h nsp-${cls}`
      h.title = title
      h.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;z-index:9;touch-action:none;`
      let from = 0
      let base = 0
      let scale = 1
      let act: ReturnType<NonNullable<typeof run>> | null = null
      // Screen coordinates (not the iframe's own) so the drag keeps going when the
      // pointer leaves the frame; divided by the frame's scale to get frame pixels.
      const move = (e: PointerEvent) => {
        const d = Math.round(((axis === 'x' ? e.screenX : e.screenY) - from) / scale)
        act = run(base + d)
        act?.live()
      }
      const end = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        doc.removeEventListener('pointermove', move)
        doc.removeEventListener('pointerup', end)
        dragEnd.current = Date.now()
        act?.commit()
      }
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const fe = doc.defaultView?.frameElement as HTMLElement | null
        scale = fe && fe.offsetWidth ? fe.getBoundingClientRect().width / fe.offsetWidth : 1
        from = axis === 'x' ? e.screenX : e.screenY
        base = start()
        act = null
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
        doc.addEventListener('pointermove', move)
        doc.addEventListener('pointerup', end)
      })
      h.addEventListener('click', (e) => e.stopPropagation())
      doc.body.appendChild(h)
    }
    const r = (target ?? el).getBoundingClientRect()
    const er = el.getBoundingClientRect()
    const sy = doc.defaultView?.scrollY ?? 0
    const sx = doc.defaultView?.scrollX ?? 0
    const key = (k: 'mt' | 'mb' | 'pad' | 'h' | 'w') => (node.outlook?.[k] as number | undefined) ?? olBase(treeRef.current, node, k)
    const apply = (k: 'mt' | 'mb' | 'pad' | 'h' | 'w', v: number) => tweak.current(id, olPatch(node, k, Math.max(0, v)))
    const html = el as HTMLElement
    // bottom edge
    const bk = node.type === 'spacer' ? 'h' : node.type === 'section' ? 'pad' : 'mb'
    make('b', bk === 'h' ? 'Hauteur (Outlook)' : bk === 'pad' ? 'Marges intérieures (Outlook)' : 'Marge en dessous (Outlook)', { left: er.left + sx + er.width / 2 - 20, top: er.bottom + sy - 5 }, (v) => ({
      live: () => {
        if (bk === 'h') html.style.height = `${Math.max(0, v)}px`
        else if (bk === 'mb') html.style.marginBottom = `${Math.max(0, v)}px`
        else html.querySelectorAll('td').forEach((td) => ((td as HTMLElement).style.paddingBottom = `${Math.max(0, v)}px`))
      },
      commit: () => apply(bk, v),
    }), 'y', () => key(bk))
    if (node.type !== 'spacer' && node.type !== 'section') {
      make('t', 'Marge au-dessus (Outlook)', { left: er.left + sx + er.width / 2 - 20, top: er.top + sy - 5 }, (v) => ({
        live: () => (html.style.marginTop = `${Math.max(0, v)}px`),
        commit: () => apply('mt', v),
      }), 'y', () => key('mt'))
    }
    if (node.type === 'image' && target) {
      make('r', 'Largeur (Outlook)', { left: r.right + sx - 5, top: r.top + sy + r.height / 2 - 20 }, (v) => ({
        live: () => (target.style.width = `${Math.max(20, v)}px`),
        commit: () => apply('w', Math.max(20, v)),
      }), 'x', () => Math.round(r.width))
    }
    if (node.type === 'button' && vmlBtn) {
      make('r', 'Largeur dans Outlook', { left: r.right + sx - 5, top: r.top + sy + r.height / 2 - 20 }, (v) => ({
        live: () => (vmlBtn.style.width = `${Math.max(80, v)}px`),
        commit: () => tweak.current(id, { vmlWidth: Math.min(600, Math.max(80, v)) } as Partial<Block>),
      }), 'x', () => Math.round(r.width))
    }
  }, [])

  const mark = useCallback(
    (doc: Document | null) => {
      if (!doc) return
      doc.querySelectorAll('[data-nsp-sel]').forEach((e) => e.removeAttribute('data-nsp-sel'))
      doc.querySelectorAll('.nsp-h').forEach((h) => h.remove())
      const els = doc.querySelectorAll(NODE)
      if (els.length !== idsRef.current.length || !selRef.current) return
      // Loop clones carry "id~k": the base id is what the editor knows.
      const i = idsRef.current.findIndex((id) => id.split('~')[0] === selRef.current)
      if (i >= 0) {
        els[i].setAttribute('data-nsp-sel', '1')
        handles(doc, els[i], selRef.current)
      }
    },
    [handles],
  )

  const onDocument = useCallback(
    (doc: Document) => {
      docRef.current = doc
      const st = doc.createElement('style')
      st.textContent =
        '[data-neon]{cursor:pointer}[data-nsp-sel]{outline:2px solid #ff007f !important;outline-offset:2px}' +
        '.nsp-h{background:#ff007f;border:2px solid #fff;border-radius:6px;box-shadow:0 1px 4px #0006}.nsp-b,.nsp-t{width:40px;height:10px;cursor:ns-resize}.nsp-r{width:10px;height:40px;cursor:ew-resize}'
      doc.head.appendChild(st)
      doc.addEventListener('click', (e) => {
        e.preventDefault()
        // The click that ends a drag is not a selection.
        if (Date.now() - dragEnd.current < 500) return
        const els = Array.from(doc.querySelectorAll(NODE))
        if (els.length !== idsRef.current.length) return
        const hit = (e.target as Element).closest(NODE)
        const i = hit ? els.indexOf(hit) : -1
        pick.current(i >= 0 ? idsRef.current[i].split('~')[0] : null)
      })
      mark(doc)
    },
    [mark],
  )
  useEffect(() => mark(docRef.current), [selectedId, mark])
  useEffect(() => mark(docRef.current), [mode, mark])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-mute max-sm:hidden">{mode === 'normal' ? 'Rendu du module' : 'Outlook 2016–2021'} · clique un élément pour le modifier</span>
        <div role="group" aria-label="Rendu de l'aperçu" className="flex shrink-0 flex-wrap rounded-md max-sm:w-full border border-line p-0.5 text-xs">
          {([['normal', 'Aperçu', 'Aperçu'], ['sans', 'Outlook sans VML', 'Sans VML'], ['avec', 'Outlook avec VML', 'Avec VML']] as const).map(([v, l, short]) => (
            <button key={l} aria-pressed={mode === v} onClick={() => setMode(v)} className={`rounded px-2 py-0.5 max-sm:flex-1 ${mode === v ? 'bg-cyan/15 text-cyan' : 'text-mute hover:text-white'}`}>
              <span className="max-sm:hidden">{l}</span><span className="sm:hidden">{short}</span>
            </button>
          ))}
        </div>
      </div>
      {mode === 'sans' && countButtons(tree, (b) => !b.msoCell) > 0 && (
        <div className="mx-3 mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-cyan/30 bg-cyan/5 px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1 text-mute">
            Sans VML, Outlook réduit {countButtons(tree, (b) => !b.msoCell) > 1 ? 'les boutons' : 'le bouton'} à du texte surligné.
          </span>
          <button onClick={() => onTree(patchAllButtons(tree, { msoCell: true }))} className="rounded-md bg-cyan/15 px-2.5 py-1 font-semibold text-cyan hover:bg-cyan/25">
            Passer en blocs colorés
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto bg-white/[0.03] p-2">
        <EmailFrame html={html} width={tree.width + 40} title="Aperçu du module" pickable onDocument={onDocument} />
      </div>
    </div>
  )
}

// The panel is docked in the editor's layout (it never covers the work): under
// it on desktop, tablets and phones held upright, beside it on phones held
// sideways. Its share of the space is kept in this browser.
const SIZE_KEY = 'nsp-vml-size'
const clampSize = (v: number) => Math.min(0.85, Math.max(0.2, v))
function useMedia(query: string) {
  const [match, setMatch] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMatch(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])
  return match
}

export function VmlWindow({
  tree,
  name,
  selectedId,
  onSelect,
  onToggle,
  onClose,
  commit,
}: {
  tree: ModuleTree
  name: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggle: () => void
  onClose: () => void
  commit: (t: ModuleTree, select?: string | null) => void
}) {
  const { groups, rounded } = useMemo(() => collectVml(tree), [tree])
  const all = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const [copied, setCopied] = useState<string | null>(null)
  const [minState, setMin] = useState(false)
  const [tab, setTab] = useState<'structure' | 'apercu' | 'edition'>('apercu')
  const [edit, setEdit] = useState<'edit' | 'outlook' | 'code'>('edit')
  const row = useMedia('(max-height: 500px)')
  const desk = useMedia('(min-width: 1024px)')
  const [size, setSize] = useState<number | null>(null)
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(SIZE_KEY))
      if (v) setSize(clampSize(v))
    } catch {
      /* storage blocked: default size */
    }
  }, [])
  useEffect(() => {
    if (size == null) return
    try {
      localStorage.setItem(SIZE_KEY, String(size))
    } catch {
      /* storage blocked */
    }
  }, [size])
  const frac = size ?? (row ? 0.55 : desk ? 0.45 : 0.6)
  // Sideways on a phone the panel can't shrink to its title bar: always open.
  const min = minState && !row
  const asideRef = useRef<HTMLElement>(null)
  const resizeTo = (x: number, y: number) => {
    const box = asideRef.current?.parentElement?.getBoundingClientRect()
    if (!box) return
    setSize(clampSize(row ? (box.right - x) / box.width : (box.bottom - y) / box.height))
  }

  const current = all.find((i) => i.id === selectedId)
  const node = selectedId ? findNode(tree, selectedId) : null
  useEffect(() => {
    if (edit === 'code' && !current) setEdit('edit')
  }, [edit, current])
  const on = !!tree.vml

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  const select = (id: string | null) => {
    onSelect(id)
    // On a phone the three panels are tabs: go and edit what was picked.
    if (window.matchMedia('(max-width: 1023px)').matches) setTab('edition')
  }
  const panel = (t: typeof tab, extra = '') => `${tab === t ? 'flex' : 'hidden'} lg:flex min-h-0 flex-col ${extra}`

  return (
    <aside
      ref={asideRef}
      aria-label="Volet VML pour Outlook"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      style={min ? undefined : { flexBasis: `${frac * 100}%` }}
      className={`relative flex min-h-0 min-w-0 shrink-0 grow-0 flex-col bg-night ${row ? 'border-l' : 'border-t'} border-line`}
    >
      {!min && (
        <div
          role="separator"
          aria-orientation={row ? 'vertical' : 'horizontal'}
          aria-label="Redimensionner le volet VML"
          aria-valuemin={20}
          aria-valuemax={85}
          aria-valuenow={Math.round(frac * 100)}
          tabIndex={0}
          title="Glisser pour redimensionner"
          onPointerDown={(e) => {
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && resizeTo(e.clientX, e.clientY)}
          onKeyDown={(e) => {
            const step = ({ ArrowUp: 0.05, ArrowDown: -0.05, ArrowLeft: 0.05, ArrowRight: -0.05 } as Record<string, number>)[e.key]
            if (step) {
              e.preventDefault()
              setSize(clampSize(frac + step))
            }
          }}
          className={`group absolute z-20 flex touch-none items-center justify-center outline-none ${row ? 'inset-y-0 -left-2 w-4 cursor-col-resize' : 'inset-x-0 -top-2 h-4 cursor-row-resize'}`}
        >
          <span className={`rounded-full bg-mute/50 transition group-hover:bg-violet group-focus-visible:bg-violet group-active:bg-violet ${row ? 'h-12 w-1' : 'h-1 w-12'}`} />
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <Shapes className="size-4 text-violet" />
        <h2 className="min-w-0 truncate font-display text-sm font-semibold">VML · Outlook<span className="max-sm:hidden"> · module entier</span></h2>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-cyan/40 px-2 py-0.5 text-[10px] text-cyan" title="Se met à jour à chaque modification">
          <span className="size-1.5 animate-pulse rounded-full bg-cyan motion-reduce:animate-none" /> En direct
        </span>
        <span className="flex-1" />
        {!row && (
          <button onClick={() => setMin((m) => !m)} aria-label={min ? 'Agrandir le volet VML' : 'Réduire le volet VML'} className="rounded p-1 text-mute hover:bg-white/5 hover:text-white">
            {min ? <Plus className="size-4" /> : <Minus className="size-4" />}
          </button>
        )}
        <button onClick={onClose} aria-label="Fermer le volet VML" className="rounded p-1 text-mute hover:bg-white/5 hover:text-white">
          <X className="size-4" />
        </button>
      </div>

      {!min && (
        <>
          <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label="Ajouter le VML au code et à l'export"
              onClick={onToggle}
              className={`h-5 w-9 shrink-0 rounded-full border transition ${on ? 'border-cyan bg-cyan/30' : 'border-line bg-void'}`}
            >
              <span className={`block size-3.5 rounded-full transition ${on ? 'translate-x-[18px] bg-cyan' : 'translate-x-0.5 bg-mute'}`} />
            </button>
            <p className="min-w-0 flex-1 text-xs text-mute">
              <span className="font-semibold text-white">{on ? 'VML actif dans le code et l\u2019export' : 'VML désactivé'}</span> <span className="max-sm:hidden [@media(max-height:500px)]:hidden">· Outlook sur Windows dessine alors les boutons arrondis et cliquables sur toute leur surface ; les autres messageries gardent le lien normal.</span>
              <span className="max-sm:hidden [@media(max-height:500px)]:hidden">{rounded > 0 && ` ${rounded} section${rounded > 1 ? 's' : ''} arrondie${rounded > 1 ? 's' : ''} restent carrées dans Outlook (sans gravité).`}</span>
            </p>
          </div>

          <div role="tablist" aria-label="Panneaux" className="flex shrink-0 border-b border-line text-sm lg:hidden">
            {([['structure', 'Structure'], ['apercu', 'Aperçu'], ['edition', 'Édition']] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" id={`vml-tab-${k}`} aria-controls={`vml-panel-${k}`} aria-selected={tab === k} onClick={() => setTab(k)} className={`flex-1 py-2 ${tab === k ? 'border-b-2 border-violet text-white' : 'text-mute'}`}>
                {l}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div id="vml-panel-structure" role="tabpanel" aria-labelledby="vml-tab-structure" className={panel('structure', 'overflow-y-auto p-3 lg:w-56 lg:shrink-0 lg:border-r lg:border-line')}>
              <h2 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-mute">Structure en direct</h2>
              <Outline tree={tree} selectedId={selectedId} onSelect={select} />
            </div>

            <div id="vml-panel-apercu" role="tabpanel" aria-labelledby="vml-tab-apercu" className={panel('apercu', 'min-w-0 flex-1 lg:border-r lg:border-line')}>
              <OutlookPreview tree={tree} name={name} selectedId={selectedId} onSelect={select} onTweak={(id, patch) => commit(updateNode(tree, id, patch), id)} onTree={(t) => commit(t, selectedId)} />
            </div>

            <div id="vml-panel-edition" role="tabpanel" aria-labelledby="vml-tab-edition" className={panel('edition', 'flex-1 lg:w-[22rem] lg:flex-none lg:shrink-0')}>
              {node && node.type !== 'raw' && (
                <div role="tablist" aria-label="Réglages de l'élément" className="m-3 mb-0 flex shrink-0 rounded-md border border-line p-0.5 text-xs">
                  {([['edit', 'Édition'], ['outlook', 'Outlook'], ...(current ? [['code', 'Code VML']] : [])] as [typeof edit, string][]).map(([k, l]) => (
                    <button key={k} type="button" role="tab" id={`vml-edit-${k}`} aria-controls="vml-edit-panel" aria-selected={edit === k} onClick={() => setEdit(k)} className={`flex-1 rounded px-2.5 py-1 ${edit === k ? 'bg-violet/20 text-white' : 'text-mute hover:text-white'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              )}
              <div id="vml-edit-panel" role={node && node.type !== 'raw' ? 'tabpanel' : undefined} aria-labelledby={node && node.type !== 'raw' ? `vml-edit-${edit}` : undefined} className="min-h-0 flex-1 overflow-y-auto">
                {node && node.type !== 'raw' && edit === 'outlook' ? (
                  <OutlookPanel tree={tree} node={node} onChange={(patch) => commit(updateNode(tree, node.id, patch), node.id)} onTree={(t) => commit(t, node.id)} />
                ) : current && edit === 'code' ? (
                  <div className="p-3">
                    <div className="mb-2 flex justify-end">
                      <button
                        onClick={() => copy(current.id, current.code)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-mute hover:border-cyan hover:text-white"
                      >
                        {copied === current.id ? <Check className="size-3.5 text-cyan" /> : <Copy className="size-3.5" />} {copied === current.id ? 'Copié' : 'Copier'}
                      </button>
                    </div>
                    <pre
                      className="max-h-80 overflow-auto rounded-lg border border-line bg-void p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
                      // highlight() escapes everything it prints.
                      dangerouslySetInnerHTML={{ __html: highlightVml(current.code) }}
                    />
                    <p className="mt-2 text-xs text-mute">
                      {on ? 'Ce code est dans ton module.' : 'Ce code sera ajouté au module quand tu actives le VML.'} Le lien classique est ajouté automatiquement pour les autres clients.
                    </p>
                    {all.length > 1 && (
                      <button
                        onClick={() => copy('all', all.map((i) => i.code).join('\n\n'))}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-mute hover:border-cyan hover:text-white"
                      >
                        {copied === 'all' ? <Check className="size-3.5 text-cyan" /> : <Copy className="size-3.5" />} {copied === 'all' ? 'Copié' : `Copier les ${all.length} VML`}
                      </button>
                    )}
                  </div>
                ) : current ? (
                  <div className="p-3">
                    <ButtonEditor item={current} font={tree.font} vml={on} onChange={(patch) => commit(updateNode(tree, current.id, patch), current.id)} />
                  </div>
                ) : (
                  // Any other element (or the module itself): the same settings as the editor's panel.
                  <div className="flex h-full min-h-0 flex-col">
                    <Inspector tree={tree} selectedId={selectedId} onSelect={onSelect} commit={commit} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}

// Colours only: a HuBL variable can't be drawn here.
const cssColor = (v: string, fallback: string) => (/^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([^)]*\))$/i.test(v.trim()) ? v.trim() : fallback)

// No-code editor: the three renderings of the button, then plain controls.
function ButtonEditor({ item, font, vml, onChange }: { item: Item; font: string; vml: boolean; onChange: (patch: Partial<ButtonBlock>) => void }) {
  const b = item.block
  const bg = cssColor(b.bg, '#888888')
  const color = cssColor(b.color, '#ffffff')
  const bh = outlookHeight(b)
  const bw = buttonBorder(b)
  const radiusVml = Math.round((item.arc / 100) * Math.min(item.width, bh))
  const borderCss = bw ? `${bw}px solid ${cssColor(buttonBorderColor(b), color)}` : undefined
  const row = 'flex items-center gap-3 rounded-lg border px-3 py-2.5'
  const tag = (active: boolean, text: string) => (
    <span className={`w-24 shrink-0 text-[11px] leading-tight ${active ? 'text-cyan' : 'text-mute'}`}>
      {text}
      {active && <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-wider">ce que tu envoies</span>}
    </span>
  )
  const base = { fontFamily: font, fontSize: buttonFontSize(b), fontWeight: buttonBold(b) ? 700 : 400, color } as const
  return (
    <div className="space-y-4">
      <div className="space-y-2" aria-label="Aperçu du bouton selon la messagerie">
        <div className={`${row} border-line`}>
          {tag(false, 'Autres messageries')}
          <div className="min-w-0 flex-1 overflow-hidden">
            <span style={{ ...base, display: 'inline-block', padding: b.height ? '0 26px' : '12px 26px', ...(b.height ? { lineHeight: `${b.height - 2 * bw}px` } : {}), background: bg, border: borderCss, borderRadius: b.radius, whiteSpace: 'nowrap' }}>{b.label || ' '}</span>
          </div>
        </div>
        <div className={`${row} ${!vml ? 'border-cyan/60' : 'border-line'}`}>
          {tag(!vml, 'Outlook sans VML')}
          <div className="min-w-0 flex-1 overflow-hidden">
            {b.msoCell ? (
              // Coloured cell: padding and width kept, corners square.
              <span
                style={{ ...base, display: 'inline-block', boxSizing: 'border-box', padding: b.vmlWidth ? `${Math.max(0, (bh - 2 * bw - Math.round(buttonFontSize(b) * 1.2)) / 2)}px 0` : `${Math.max(0, (bh - 2 * bw - Math.round(buttonFontSize(b) * 1.2)) / 2)}px 26px`, width: b.vmlWidth, textAlign: 'center', background: bg, border: borderCss, whiteSpace: 'nowrap' }}
              >
                {b.label || ' '}
              </span>
            ) : (
              <span style={{ ...base, background: bg, whiteSpace: 'nowrap' }}>{b.label || ' '}</span>
            )}
          </div>
        </div>
        <div className={`${row} ${vml ? 'border-cyan/60' : 'border-line'}`}>
          {tag(vml, 'Outlook avec VML')}
          <div className="min-w-0 flex-1 overflow-hidden">
            <div
              style={{ ...base, width: item.width, height: bh, lineHeight: `${bh - 2 * bw}px`, background: bg, border: borderCss, boxSizing: 'border-box', borderRadius: radiusVml, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}
              title={`${item.width} × ${bh} px`}
            >
              {b.label || ' '}
            </div>
          </div>
        </div>
        {!vml && <p className="text-xs text-mute">Active le VML en haut de la fenêtre pour que Outlook affiche la dernière ligne.</p>}
      </div>

      <div className="space-y-3">
        <Field label="Libellé">
          <input className={input} value={b.label} onChange={(e) => onChange({ label: e.target.value })} />
        </Field>
        <Field label="Lien">
          <input className={`${input} ${mono}`} value={b.href} onChange={(e) => onChange({ href: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorField label="Fond" value={b.bg} onChange={(v) => onChange({ bg: v })} />
          <ColorField label="Texte" value={b.color} onChange={(v) => onChange({ color: v })} />
        </div>
        <RangeField label="Arrondi" value={b.radius} min={0} max={40} onChange={(radius) => onChange({ radius })} />
        <AlignField value={b.align} onChange={(align) => onChange({ align })} />
        <ButtonLookFields b={b} onChange={onChange} />
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] tracking-wider text-mute uppercase">Largeur dans Outlook · {item.width}px</span>
            <div role="group" aria-label="Largeur dans Outlook" className="flex rounded-md border border-line p-0.5 text-xs">
              <button aria-pressed={!item.manual} onClick={() => onChange({ vmlWidth: undefined })} className={`rounded px-2 py-0.5 ${!item.manual ? 'bg-cyan/15 text-cyan' : 'text-mute hover:text-white'}`}>
                Auto
              </button>
              <button aria-pressed={item.manual} onClick={() => onChange({ vmlWidth: item.width })} className={`rounded px-2 py-0.5 ${item.manual ? 'bg-cyan/15 text-cyan' : 'text-mute hover:text-white'}`}>
                Manuelle
              </button>
            </div>
          </div>
          <input
            type="range"
            min={80}
            max={400}
            value={item.width}
            disabled={!item.manual}
            aria-label="Largeur du bouton dans Outlook"
            onChange={(e) => onChange({ vmlWidth: Number(e.target.value) })}
            className="h-7 w-full accent-pink disabled:opacity-40 lg:h-auto"
          />
          <p className="text-xs text-mute">
            {item.manual ? `Estimation automatique : ${item.auto} px.` : 'Calculée d\u2019après le texte.'}
            {item.hubl ? ' Le libellé contient une variable : passe en manuel si le texte est plus long.' : ''}
          </p>
        </div>
      </div>
    </div>
  )
}
