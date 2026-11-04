import { useMemo, useRef, useState } from 'react'
import { Check, CheckCircle2, Circle, Copy, GripHorizontal, Minus, Plus, Shapes, X } from 'lucide-react'

import { highlight } from '@/components/editor/CodeEditor'
import { esc, escKeep } from '@/lib/hubl'
import { isSafeUrl } from '@/lib/sanitize'
import type { Block, ButtonBlock, ModuleTree, Section } from '@/lib/types'
import { BUTTON_HEIGHT, arcSize, buttonWidth, msoOnly, vmlShape } from '@/lib/vml'

// Floating window (it doesn't block the editor) showing, live, the VML drawn
// for Outlook on Windows: which buttons get a shape, its size and its code.
// Everything is derived from the tree, so it follows every edit.

interface Item {
  id: string
  label: string
  path: string
  width: number
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
  const width = buttonWidth(b.label)
  const code = msoOnly(
    vmlShape({
      href: isSafeUrl(b.href) ? escKeep(b.href) : '#',
      label: escKeep(b.label),
      bg: escKeep(b.bg),
      color: escKeep(b.color),
      radius: b.radius,
      font: esc(font),
      width,
      height: BUTTON_HEIGHT,
    }),
  )
  return { id: b.id, label: b.label || 'Bouton', path, width, arc: b.radius > 0 ? arcSize(b.radius, width) : 0, hubl: hasHubl(b.label), code }
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

export function VmlWindow({
  tree,
  selectedId,
  onSelect,
  onToggle,
  onClose,
}: {
  tree: ModuleTree
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: () => void
  onClose: () => void
}) {
  const { groups, rounded } = useMemo(() => collectVml(tree), [tree])
  const all = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const [picked, setPicked] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [min, setMin] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const current = all.find((i) => i.id === selectedId) ?? all.find((i) => i.id === picked) ?? all[0]
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

  return (
    <aside
      role="dialog"
      aria-label="Fenêtre VML pour Outlook"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-[72vh] flex-col rounded-t-xl border border-line bg-night/97 shadow-2xl backdrop-blur-md lg:inset-x-auto lg:left-[336px] lg:bottom-4 lg:w-[27rem] lg:max-h-[min(34rem,78vh)] lg:rounded-xl"
    >
      <header
        className="flex shrink-0 cursor-grab touch-none items-center gap-2 border-b border-line px-3 py-2 select-none active:cursor-grabbing"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d) setPos({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <Shapes className="size-4 text-violet" />
        <h2 className="font-display text-sm font-semibold">VML · Outlook</h2>
        <span className="flex items-center gap-1 rounded-full border border-cyan/40 px-2 py-0.5 text-[10px] text-cyan" title="Se met à jour à chaque modification">
          <span className="size-1.5 animate-pulse rounded-full bg-cyan motion-reduce:animate-none" /> En direct
        </span>
        <GripHorizontal className="ml-auto hidden size-4 text-mute lg:block" aria-hidden />
        <button onClick={() => setMin((m) => !m)} aria-label={min ? 'Agrandir la fenêtre VML' : 'Réduire la fenêtre VML'} className="rounded p-1 text-mute hover:bg-white/5 hover:text-white">
          {min ? <Plus className="size-4" /> : <Minus className="size-4" />}
        </button>
        <button onClick={onClose} aria-label="Fermer la fenêtre VML" className="rounded p-1 text-mute hover:bg-white/5 hover:text-white">
          <X className="size-4" />
        </button>
      </header>

      {!min && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-start gap-3 border-b border-line px-4 py-3">
            <button
              role="switch"
              aria-checked={on}
              aria-label="Ajouter le VML au code et à l'export"
              onClick={onToggle}
              className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition ${on ? 'border-cyan bg-cyan/30' : 'border-line bg-void'}`}
            >
              <span className={`block size-3.5 rounded-full transition ${on ? 'translate-x-[18px] bg-cyan' : 'translate-x-0.5 bg-mute'}`} />
            </button>
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{on ? 'VML actif dans le code et l’export' : 'VML désactivé'}</p>
              <p className="mt-0.5 text-xs text-mute">
                Outlook sur Windows ignore les coins arrondis et la marge des liens. Avec le VML, il dessine chaque bouton en forme pleine, arrondie et cliquable ; les autres messageries gardent le lien normal.
              </p>
            </div>
          </div>

          <section className="px-4 py-3" aria-label="Structure en direct">
            <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-mute">
              Structure en direct · {all.length} bouton{all.length > 1 ? 's' : ''}
            </h3>
            {all.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line p-3 text-sm text-mute">Aucun bouton pour l'instant : ajoute-en un dans Structure et son VML apparaît ici.</p>
            ) : (
              <ul className="space-y-2">
                {groups.map((g) => (
                  <li key={g.id}>
                    <p className="mb-1 text-xs text-mute">{g.title}</p>
                    <ul className="space-y-1">
                      {g.items.map((it) => {
                        const active = current?.id === it.id
                        return (
                          <li key={it.id}>
                            <button
                              onClick={() => {
                                setPicked(it.id)
                                onSelect(it.id)
                              }}
                              aria-current={active}
                              className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition ${active ? 'border-violet bg-violet/10' : 'border-line hover:border-violet/60'}`}
                            >
                              {on ? <CheckCircle2 className="size-4 shrink-0 text-cyan" aria-label="VML actif" /> : <Circle className="size-4 shrink-0 text-mute" aria-label="VML inactif" />}
                              <span className="min-w-0 flex-1 truncate">
                                {it.label}
                                {it.path && <span className="ml-1 text-xs text-mute">· {it.path}</span>}
                              </span>
                              <span className="shrink-0 font-mono text-[11px] text-mute">
                                {it.width}×{BUTTON_HEIGHT}
                                {it.arc ? ` · ${it.arc} %` : ''}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {rounded > 0 && (
              <p className="mt-2 text-xs text-mute">
                {rounded} section{rounded > 1 ? 's' : ''} à coins arrondis : Outlook les affiche carrées (sans gravité, aucun VML nécessaire).
              </p>
            )}
          </section>

          {current && (
            <section className="border-t border-line px-4 py-3" aria-label={`Code VML de ${current.label}`}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">« {current.label} »</h3>
                <button
                  onClick={() => copy(current.id, current.code)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-mute hover:border-cyan hover:text-white"
                >
                  {copied === current.id ? <Check className="size-3.5 text-cyan" /> : <Copy className="size-3.5" />} {copied === current.id ? 'Copié' : 'Copier'}
                </button>
              </div>
              <pre
                className="max-h-44 overflow-auto rounded-lg border border-line bg-void p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
                // highlight() escapes everything it prints.
                dangerouslySetInnerHTML={{ __html: highlightVml(current.code) }}
              />
              <p className="mt-2 text-xs text-mute">
                {on ? 'Ce code est dans ton module.' : 'Ce code sera ajouté au module quand tu actives le VML.'} La largeur ({current.width} px) est estimée d'après le texte
                {current.hubl ? ' ; le libellé contient une variable, vérifie-la dans le test Outlook' : ''}. Le lien classique est ajouté automatiquement pour les autres clients.
              </p>
            </section>
          )}

          {all.length > 1 && (
            <div className="border-t border-line px-4 py-3">
              <button
                onClick={() => copy('all', all.map((i) => i.code).join('\n\n'))}
                className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-mute hover:border-cyan hover:text-white"
              >
                {copied === 'all' ? <Check className="size-3.5 text-cyan" /> : <Copy className="size-3.5" />} {copied === 'all' ? 'Copié' : `Copier les ${all.length} VML`}
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
