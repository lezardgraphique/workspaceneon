import { useMemo, useRef, useState } from 'react'
import { Check, CheckCircle2, Circle, Copy, GripHorizontal, Minus, Plus, Shapes, X } from 'lucide-react'

import { highlight } from '@/components/editor/CodeEditor'
import { ColorField, Field, RangeField, input, mono } from '@/components/editor/Inspector'
import { esc, escKeep } from '@/lib/hubl'
import { isSafeUrl } from '@/lib/sanitize'
import { updateNode } from '@/lib/tree'
import type { Block, ButtonBlock, ModuleTree, Section } from '@/lib/types'
import { BUTTON_HEIGHT, arcSize, buttonWidth, msoOnly, vmlShape } from '@/lib/vml'

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
  const auto = buttonWidth(b.label)
  const width = b.vmlWidth ?? auto
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
  return { id: b.id, block: b, label: b.label || 'Bouton', path, width, auto, manual: !!b.vmlWidth, arc: b.radius > 0 ? arcSize(b.radius, width) : 0, hubl: hasHubl(b.label), code }
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
  commit,
}: {
  tree: ModuleTree
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: () => void
  onClose: () => void
  commit: (t: ModuleTree, select?: string | null) => void
}) {
  const { groups, rounded } = useMemo(() => collectVml(tree), [tree])
  const all = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const [picked, setPicked] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [min, setMin] = useState(false)
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
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
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-[72vh] flex-col rounded-t-xl border border-line bg-night/97 shadow-2xl backdrop-blur-md lg:inset-x-auto lg:right-4 lg:bottom-4 lg:w-[27rem] lg:max-h-[min(42rem,88vh)] lg:rounded-xl"
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
            <section className="border-t border-line px-4 py-3" aria-label={`Bouton ${current.label}`}>
              <div className="mb-3 flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">« {current.label} »</h3>
                <div role="tablist" aria-label="Affichage" className="flex shrink-0 rounded-md border border-line p-0.5 text-xs">
                  {([['preview', 'Aperçu'], ['code', 'Code VML']] as const).map(([k, l]) => (
                    <button
                      key={k}
                      role="tab"
                      aria-selected={tab === k}
                      onClick={() => setTab(k)}
                      className={`rounded px-2.5 py-1 ${tab === k ? 'bg-violet/20 text-white' : 'text-mute hover:text-white'}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {tab === 'preview' ? (
                <ButtonEditor item={current} font={tree.font} vml={on} onChange={(patch) => commit(updateNode(tree, current.id, patch), current.id)} />
              ) : (
                <>
                  <div className="mb-2 flex justify-end">
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
                    {on ? 'Ce code est dans ton module.' : 'Ce code sera ajouté au module quand tu actives le VML.'} Le lien classique est ajouté automatiquement pour les autres clients.
                  </p>
                </>
              )}
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

// Colours only: a HuBL variable can't be drawn here.
const cssColor = (v: string, fallback: string) => (/^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([^)]*\))$/i.test(v.trim()) ? v.trim() : fallback)

// No-code editor: the three renderings of the button, then plain controls.
function ButtonEditor({ item, font, vml, onChange }: { item: Item; font: string; vml: boolean; onChange: (patch: Partial<ButtonBlock>) => void }) {
  const b = item.block
  const bg = cssColor(b.bg, '#888888')
  const color = cssColor(b.color, '#ffffff')
  const radiusVml = Math.round((item.arc / 100) * Math.min(item.width, BUTTON_HEIGHT))
  const row = 'flex items-center gap-3 rounded-lg border px-3 py-2.5'
  const tag = (active: boolean, text: string) => (
    <span className={`w-24 shrink-0 text-[11px] leading-tight ${active ? 'text-cyan' : 'text-mute'}`}>
      {text}
      {active && <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-wider">ce que tu envoies</span>}
    </span>
  )
  const base = { fontFamily: font, fontSize: 15, fontWeight: 700, color } as const
  return (
    <div className="space-y-4">
      <div className="space-y-2" aria-label="Aperçu du bouton selon la messagerie">
        <div className={`${row} border-line`}>
          {tag(false, 'Autres messageries')}
          <div className="min-w-0 flex-1 overflow-hidden">
            <span style={{ ...base, display: 'inline-block', padding: '12px 26px', background: bg, borderRadius: b.radius, whiteSpace: 'nowrap' }}>{b.label || ' '}</span>
          </div>
        </div>
        <div className={`${row} ${!vml ? 'border-cyan/60' : 'border-line'}`}>
          {tag(!vml, 'Outlook sans VML')}
          <div className="min-w-0 flex-1 overflow-hidden">
            <span style={{ ...base, background: bg, whiteSpace: 'nowrap' }}>{b.label || ' '}</span>
          </div>
        </div>
        <div className={`${row} ${vml ? 'border-cyan/60' : 'border-line'}`}>
          {tag(vml, 'Outlook avec VML')}
          <div className="min-w-0 flex-1 overflow-hidden">
            <div
              style={{ ...base, width: item.width, height: BUTTON_HEIGHT, lineHeight: `${BUTTON_HEIGHT}px`, background: bg, borderRadius: radiusVml, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}
              title={`${item.width} × ${BUTTON_HEIGHT} px`}
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
