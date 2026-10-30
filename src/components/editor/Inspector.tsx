import { useState } from 'react'
import { guardedFetch } from '@/lib/session-guard'
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Copy, Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { ImageUpload } from './ImageUpload'
import { BLOCK_ICONS } from './Structure'
import { htmlToBlocks, sanitizeHtml } from '@/lib/hubl'
import { BLOCK_LABELS } from '@/lib/types'
import type { Align, Block, Columns, ModuleTree } from '@/lib/types'
import {
  countBlocks,
  duplicateNode,
  expandRaw,
  findNode,
  findPath,
  moveNode,
  removeNode,
  replaceNode,
  setColumns,
  updateNode,
} from '@/lib/tree'

interface Props {
  tree: ModuleTree
  selectedId: string | null
  onSelect: (id: string | null) => void
  commit: (t: ModuleTree, select?: string | null) => void
}

// 16px below lg: iOS zooms into any smaller field on focus.
const input =
  'w-full rounded-md border border-line bg-void px-2.5 py-2 text-base text-white outline-none focus:border-cyan lg:py-1.5 lg:text-sm'
const mono = 'font-mono lg:text-xs'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-mute">{label}</span>
      {children}
    </label>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded border border-line bg-void lg:h-8 lg:w-10"
        />
        <input className={`${input} font-mono`} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  )
}

function RangeField(props: { label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <Field label={`${props.label} · ${props.value}${props.unit ?? 'px'}`}>
      <input
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="h-7 w-full accent-pink lg:h-auto"
      />
    </Field>
  )
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <Field label={label}>
      <div className="flex rounded-md border border-line bg-void p-0.5">
        {options.map((o) => (
          <button
            type="button"
            key={String(o.value)}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`flex flex-1 items-center justify-center rounded px-2 py-2 text-sm lg:py-1 lg:text-xs ${
              value === o.value ? 'bg-pink text-white' : 'text-mute hover:text-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Field>
  )
}

const AlignField = ({ value, onChange }: { value: Align; onChange: (v: Align) => void }) => (
  <Segmented
    label="Alignement"
    value={value}
    onChange={onChange}
    options={[
      { value: 'left', label: <AlignLeft className="size-3.5" />, title: 'Gauche' },
      { value: 'center', label: <AlignCenter className="size-3.5" />, title: 'Centre' },
      { value: 'right', label: <AlignRight className="size-3.5" />, title: 'Droite' },
    ]}
  />
)

// Email-safe font stacks
const FONTS = [
  "'Helvetica Neue', Helvetica, Arial, sans-serif",
  'Georgia, Times, serif',
  'Verdana, Geneva, sans-serif',
  "'Trebuchet MS', Tahoma, sans-serif",
  "'Courier New', Courier, monospace",
]

const REWRITES = ['Plus percutant', 'Plus court', 'Plus chaleureux', 'Plus formel', 'Corrige les fautes', 'Traduis en anglais']

function MailyRewrite({ text, html, onResult }: { text: string; html: boolean; onResult: (t: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const run = async (instruction: string) => {
    setBusy(instruction)
    setError('')
    try {
      const res = await guardedFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'rewrite', text, instruction, html }),
      })
      const data = await res.json()
      if (!res.ok || !data.text) throw new Error(data.error ?? 'Erreur')
      onResult(html ? sanitizeHtml(data.text) : data.text)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="rounded-lg border border-violet/40 bg-violet/5 p-2.5">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#e3a6ff]">
        <Sparkles className="size-3.5" /> Réécrire avec Maily
      </p>
      <div className="flex flex-wrap gap-1.5">
        {REWRITES.map((r) => (
          <button
            key={r}
            disabled={!!busy || !text.trim()}
            onClick={() => run(r)}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-void px-3 py-1.5 text-xs text-[#c9c9de] hover:border-violet hover:text-white disabled:opacity-50 lg:px-2.5 lg:py-1 lg:text-[11px]"
          >
            {busy === r && <Loader2 className="size-3 animate-spin" />}
            {r}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-pink">{error}</p>}
    </div>
  )
}

// Turns a raw block into editable blocks. Logic ({% … %}) stays raw around
// them, so conditions and loops keep working.
function ConvertRaw({ html, onConvert }: { html: string; onConvert: (blocks: Block[]) => void }) {
  const [note, setNote] = useState('')
  const run = () => {
    const blocks = htmlToBlocks(html)
    if (!blocks.length || (blocks.length === 1 && blocks[0].type === 'raw')) {
      setNote('Rien à convertir : ce code ne contient que de la logique ou des éléments non reconnus.')
      return
    }
    onConvert(blocks)
  }
  return (
    <div className="rounded-lg border border-cyan/30 bg-cyan/5 p-3">
      <button
        type="button"
        onClick={run}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan px-3 py-2.5 text-sm font-semibold text-void hover:brightness-110 lg:py-2"
      >
        <Wand2 className="size-4" /> Convertir en blocs modifiables
      </button>
      <p className="mt-2 text-xs text-mute">
        {note ||
          'Titres, textes, boutons, images, séparateurs et colonnes deviennent des blocs. La logique ({% if %}, {% for %}…) reste en code libre autour.'}
      </p>
    </div>
  )
}

function BlockFields({ b, set, p }: { b: Block; set: (patch: Partial<Block>) => void; p: Props }) {
  switch (b.type) {
    case 'heading':
      return (
        <>
          <Field label="Texte">
            <textarea className={`${input} min-h-16`} value={b.text} onChange={(e) => set({ text: e.target.value })} />
          </Field>
          <MailyRewrite text={b.text} html={false} onResult={(text) => set({ text })} />
          <Segmented
            label="Niveau"
            value={b.level}
            onChange={(level) => set({ level })}
            options={[1, 2, 3].map((n) => ({ value: n as 1 | 2 | 3, label: `H${n}` }))}
          />
          <RangeField label="Taille" value={b.size} min={12} max={64} onChange={(size) => set({ size })} />
          <ColorField label="Couleur" value={b.color} onChange={(color) => set({ color })} />
          <AlignField value={b.align} onChange={(align) => set({ align })} />
        </>
      )
    case 'text':
      return (
        <>
          <Field label="Contenu (HTML inline, variables {{ … }})">
            <textarea className={`${input} ${mono} min-h-32`} value={b.html} onChange={(e) => set({ html: e.target.value })} />
          </Field>
          <MailyRewrite text={b.html} html onResult={(html) => set({ html })} />
          <RangeField label="Taille" value={b.size} min={10} max={32} onChange={(size) => set({ size })} />
          <ColorField label="Couleur" value={b.color} onChange={(color) => set({ color })} />
          <AlignField value={b.align} onChange={(align) => set({ align })} />
        </>
      )
    case 'button':
      return (
        <>
          <Field label="Libellé">
            <input className={input} value={b.label} onChange={(e) => set({ label: e.target.value })} />
          </Field>
          <MailyRewrite text={b.label} html={false} onResult={(label) => set({ label })} />
          <Field label="Lien">
            <input className={`${input} ${mono}`} value={b.href} onChange={(e) => set({ href: e.target.value })} />
          </Field>
          <ColorField label="Fond" value={b.bg} onChange={(bg) => set({ bg })} />
          <ColorField label="Texte" value={b.color} onChange={(color) => set({ color })} />
          <RangeField label="Arrondi" value={b.radius} min={0} max={40} onChange={(radius) => set({ radius })} />
          <AlignField value={b.align} onChange={(align) => set({ align })} />
        </>
      )
    case 'image':
      return (
        <>
          {b.src && (
            <div className="flex max-h-40 items-center justify-center overflow-hidden rounded-md border border-line bg-[repeating-conic-gradient(#1c1c30_0%_25%,#12121f_0%_50%)] bg-[length:16px_16px]">
              <img src={b.src} alt="" className="max-h-40 max-w-full object-contain" />
            </div>
          )}
          <ImageUpload onUploaded={(src) => set({ src })} />
          <Field label="Ou URL de l'image (https://…)">
            <input className={`${input} ${mono}`} value={b.src} onChange={(e) => set({ src: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="Texte alternatif">
            <input className={input} value={b.alt} onChange={(e) => set({ alt: e.target.value })} />
          </Field>
          <RangeField label="Largeur" unit="%" value={b.width} min={10} max={100} onChange={(width) => set({ width })} />
          <AlignField value={b.align} onChange={(align) => set({ align })} />
        </>
      )
    case 'divider':
      return <ColorField label="Couleur" value={b.color} onChange={(color) => set({ color })} />
    case 'spacer':
      return <RangeField label="Hauteur" value={b.height} min={4} max={160} onChange={(height) => set({ height })} />
    case 'raw':
      return (
        <>
          <Field label="Code libre (HTML, HuBL…)">
            <textarea className={`${input} ${mono} min-h-40`} value={b.html} onChange={(e) => set({ html: e.target.value })} />
          </Field>
          <ConvertRaw html={b.html} onConvert={(blocks) => p.commit(replaceNode(p.tree, b.id, blocks), blocks[0]?.id ?? null)} />
        </>
      )
    case 'section':
      return (
        <>
          <Segmented
            label="Colonnes"
            value={b.columns}
            onChange={(n: Columns) => p.commit(setColumns(p.tree, b.id, n))}
            options={[1, 2, 3].map((n) => ({ value: n as Columns, label: `${n} col` }))}
          />
          {b.columns > 1 && (
            <Segmented
              label="Sur mobile"
              value={b.behavior}
              onChange={(behavior) => set({ behavior })}
              options={[
                { value: 'stack', label: 'Empiler' },
                { value: 'side', label: 'Côte à côte' },
              ]}
            />
          )}
          <ColorField label="Fond" value={b.bg} onChange={(bg) => set({ bg })} />
          <RangeField label="Marge interne" value={b.padding} min={0} max={64} onChange={(padding) => set({ padding })} />
          <RangeField label="Arrondi" value={b.radius} min={0} max={40} onChange={(radius) => set({ radius })} />
        </>
      )
  }
}

export function Inspector(p: Props) {
  const node = p.selectedId ? findNode(p.tree, p.selectedId) : null

  if (!node) {
    const t = p.tree
    const rawCount = countBlocks(t, 'raw')
    return (
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <h3 className="font-display font-semibold">Réglages du module</h3>
          <p className="text-xs text-mute">Touche ou clique un élément de l'aperçu pour le configurer.</p>
        </div>
        <RangeField label="Largeur max" value={t.width} min={320} max={800} onChange={(width) => p.commit({ ...t, width })} />
        <ColorField label="Fond du module" value={t.bg} onChange={(bg) => p.commit({ ...t, bg })} />
        <Field label="Police">
          <select className={input} value={t.font} onChange={(e) => p.commit({ ...t, font: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f.split(',')[0].replace(/'/g, '')}
              </option>
            ))}
            {!FONTS.includes(t.font) && <option value={t.font}>{t.font}</option>}
          </select>
        </Field>
        {rawCount > 0 && (
          <div className="rounded-lg border border-cyan/30 bg-cyan/5 p-3">
            <p className="mb-2 text-xs text-mute">
              {rawCount} bloc{rawCount > 1 ? 's' : ''} de code libre dans ce module.
            </p>
            <button
              type="button"
              onClick={() => p.commit(expandRaw(t, htmlToBlocks))}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan px-3 py-2.5 text-sm font-semibold text-void hover:brightness-110 lg:py-2"
            >
              <Wand2 className="size-4" /> Tout convertir en blocs
            </button>
          </div>
        )}
      </div>
    )
  }

  const Icon = BLOCK_ICONS[node.type]
  const path = findPath(p.tree, node.id)
  const set = (patch: Partial<Block>) => p.commit(updateNode(p.tree, node.id, patch))

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <div>
        {path.length > 1 && (
          <nav className="mb-2 flex flex-wrap items-center gap-1 font-mono text-[10px] text-mute">
            {path.slice(0, -1).map((id, i) => (
              <button key={id} onClick={() => p.onSelect(id)} className="hover:text-cyan">
                {i === 0 ? 'Section' : 'Card'} ›
              </button>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-cyan" />
          <h3 className="flex-1 font-display font-semibold">
            {node.type === 'section' && path.length === 1 ? 'Section' : BLOCK_LABELS[node.type]}
          </h3>
          {[
            { icon: ArrowUp, label: 'Monter', fn: () => p.commit(moveNode(p.tree, node.id, -1)) },
            { icon: ArrowDown, label: 'Descendre', fn: () => p.commit(moveNode(p.tree, node.id, 1)) },
            { icon: Copy, label: 'Dupliquer', fn: () => p.commit(duplicateNode(p.tree, node.id)) },
            { icon: Trash2, label: 'Supprimer', fn: () => p.commit(removeNode(p.tree, node.id), null) },
          ].map((a) => (
            <button key={a.label} title={a.label} aria-label={a.label} onClick={a.fn} className="rounded p-2 text-mute hover:bg-white/10 hover:text-white lg:p-1.5">
              <a.icon className="size-4 lg:size-3.5" />
            </button>
          ))}
        </div>
      </div>
      <BlockFields key={node.id} b={node} set={set} p={p} />
    </div>
  )
}
