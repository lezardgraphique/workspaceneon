import { useEffect, useRef } from 'react'
import { Braces, ImageIcon, RotateCcw } from 'lucide-react'

import { ImageUpload } from './ImageUpload'
import { BLOCK_ICONS } from './Structure'
import { defaultFor } from '@/lib/extra-fields'
import { FIELD_KIND, collectFields } from '@/lib/fields'
import type { FieldBlock, ModuleField } from '@/lib/fields'
import { updateNode } from '@/lib/tree'
import type { Block, ExtraField, ExtraFieldType, Json, ModuleTree } from '@/lib/types'

// Simplified design manager: one card per module field, with its definition
// (label + HuBL name) and its value edited directly in the same place.

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
const caption = 'mb-1 block font-mono text-[10px] uppercase tracking-wider text-mute'

function Value({ b, set }: { b: FieldBlock; set: (patch: Partial<Block>) => void }) {
  switch (b.type) {
    case 'heading':
      return <input className={input} value={b.text} onChange={(e) => set({ text: e.target.value })} aria-label="Valeur" />
    case 'text':
      return (
        <textarea
          className={`${input} min-h-24`}
          value={b.html}
          onChange={(e) => set({ html: e.target.value })}
          aria-label="Valeur (HTML inline autorisé)"
        />
      )
    case 'button':
      return (
        <div className="grid gap-2">
          <input className={input} value={b.label} onChange={(e) => set({ label: e.target.value })} aria-label="Texte du bouton" />
          <input className={`${input} ${mono}`} value={b.href} onChange={(e) => set({ href: e.target.value })} aria-label="Lien du bouton" placeholder="https://…" />
        </div>
      )
    case 'image':
      return (
        <div className="flex gap-2">
          <div className="flex size-[74px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-void lg:size-[66px]">
            {b.src ? <img src={b.src} alt="" className="size-full object-cover" /> : <ImageIcon className="size-5 text-mute" />}
          </div>
          <div className="grid min-w-0 flex-1 gap-2">
            <input className={`${input} ${mono}`} value={b.src} onChange={(e) => set({ src: e.target.value })} aria-label="URL de l'image" placeholder="https://…" />
            <input className={input} value={b.alt} onChange={(e) => set({ alt: e.target.value })} aria-label="Texte alternatif" placeholder="Texte alternatif" />
            <ImageUpload compact onUploaded={(src) => set({ src })} />
          </div>
        </div>
      )
  }
}

const TYPE_LABEL: Record<ExtraFieldType, string> = {
  text: 'Texte',
  richtext: 'Texte enrichi',
  number: 'Nombre',
  boolean: 'Oui / non',
  link: 'Lien',
  image: 'Image',
  color: 'Couleur',
  date: 'Date',
  datetime: 'Date et heure',
  group: 'Groupe',
}

const asObj = (v: Json | undefined): Record<string, Json> => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
// <input type=datetime-local> works in local time, the field stores a timestamp.
const toLocal = (ms: Json | undefined) => {
  const d = new Date(typeof ms === 'number' ? ms : Date.now())
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function ExtraValue({ f, set }: { f: ExtraField; set: (v: Json) => void }) {
  const d = f.default ?? defaultFor(f)
  switch (f.type) {
    case 'text':
      return <input className={input} value={String(d)} onChange={(e) => set(e.target.value)} aria-label="Valeur" />
    case 'richtext':
      return <textarea className={`${input} min-h-20`} value={String(d)} onChange={(e) => set(e.target.value)} aria-label="Valeur (HTML inline autorisé)" />
    case 'number':
      return <input type="number" className={input} value={Number(d)} onChange={(e) => set(Number(e.target.value))} aria-label="Valeur" />
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={d === true} onChange={(e) => set(e.target.checked)} className="size-4 accent-pink" /> Activé
        </label>
      )
    case 'date':
    case 'datetime':
      return (
        <input
          type={f.type === 'date' ? 'date' : 'datetime-local'}
          className={input}
          value={toLocal(d).slice(0, f.type === 'date' ? 10 : 16)}
          onChange={(e) => e.target.value && set(new Date(e.target.value).getTime())}
          aria-label="Valeur"
        />
      )
    case 'link':
      return (
        <input
          className={`${input} ${mono}`}
          value={String(asObj(asObj(d).url).href ?? '')}
          onChange={(e) => set({ ...asObj(d), url: { type: 'EXTERNAL', href: e.target.value, content_id: null } })}
          placeholder="https://…"
          aria-label="Lien"
        />
      )
    case 'image':
      return (
        <div className="grid gap-2">
          <input className={`${input} ${mono}`} value={String(asObj(d).src ?? '')} onChange={(e) => set({ ...asObj(d), src: e.target.value })} placeholder="https://…" aria-label="URL de l'image" />
          <ImageUpload compact onUploaded={(src) => set({ ...asObj(d), src })} />
        </div>
      )
    case 'color':
      return (
        <div className="flex items-center gap-2">
          <input type="color" value={String(asObj(d).color ?? '#000000').slice(0, 7)} onChange={(e) => set({ ...asObj(d), color: e.target.value })} className="size-9 shrink-0 rounded border border-line bg-void" aria-label="Couleur" />
          <input className={`${input} ${mono}`} value={String(asObj(d).color ?? '')} onChange={(e) => set({ ...asObj(d), color: e.target.value })} aria-label="Valeur de la couleur" />
        </div>
      )
    case 'group':
      return (
        <p className="text-xs text-mute">
          {f.repeater ? 'Liste répétée dans une boucle' : 'Groupe'} : {(f.children ?? []).map((c) => c.name).join(', ')}
        </p>
      )
  }
}

// A variable the code uses ({{ module.nom }}, {% if module.nom %}…) that no
// block owns. The variable stays in the content; the field supplies its value.
function ExtraFieldCard({ f, p }: { f: ExtraField; p: Props }) {
  const update = (patch: Partial<ExtraField>) =>
    p.commit({ ...p.tree, fields: (p.tree.fields ?? []).map((x) => (x.name === f.name ? { ...x, ...patch } : x)) })
  return (
    <div className="rounded-lg border border-line bg-night p-3">
      <div className="mb-2 flex items-center gap-2">
        <Braces className="size-4 shrink-0 text-violet" />
        <input
          value={f.label}
          onChange={(e) => update({ label: e.target.value })}
          aria-label="Libellé du champ"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold outline-none hover:border-line focus:border-cyan lg:text-sm"
        />
        <select
          value={f.type}
          onChange={(e) => {
            const type = e.target.value as ExtraFieldType
            update({ type, default: defaultFor({ ...f, type }) })
          }}
          aria-label="Type du champ"
          className="shrink-0 rounded-full border border-line bg-void px-2 py-0.5 text-[11px] text-mute outline-none focus:border-cyan"
        >
          {(Object.keys(TYPE_LABEL) as ExtraFieldType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-3 pl-6 font-mono text-base text-[#e3a6ff] lg:text-xs">{`{{ module.${f.name} }}`}</p>
      <span className={caption}>Valeur</span>
      <ExtraValue f={f} set={(v) => update({ default: v })} />
    </div>
  )
}

function FieldCard({ f, p }: { f: ModuleField; p: Props }) {
  const b = f.block
  const ref = useRef<HTMLDivElement>(null)
  const selected = p.selectedId === b.id
  const Icon = BLOCK_ICONS[b.type]
  const set = (patch: Partial<Block>) => p.commit(updateNode(p.tree, b.id, patch))
  // Editing the definition pins the current (possibly automatic) name/label.
  const def = (patch: Partial<NonNullable<FieldBlock['field']>>) =>
    set({ field: { name: f.name, label: f.label, ...b.field, ...patch } })

  // Follow selections made in the preview or the structure.
  useEffect(() => {
    if (selected && !ref.current?.contains(document.activeElement)) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  return (
    <div
      ref={ref}
      onFocus={() => !selected && p.onSelect(b.id)}
      onClick={() => !selected && p.onSelect(b.id)}
      className={`rounded-lg border p-3 transition-colors ${selected ? 'border-pink bg-pink/5' : 'border-line bg-night hover:border-[#3a3a60]'}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-cyan" />
        <input
          value={b.field?.label ?? f.label}
          onChange={(e) => def({ label: e.target.value })}
          aria-label="Libellé du champ"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold outline-none hover:border-line focus:border-cyan lg:text-sm"
        />
        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] text-mute">{FIELD_KIND[b.type].type}</span>
      </div>
      <div className="mb-3 flex items-center gap-1 pl-6">
        <Braces className="size-3 shrink-0 text-violet" />
        <input
          value={b.field?.name ?? f.name}
          onChange={(e) => def({ name: e.target.value })}
          onBlur={() => b.field && b.field.name !== f.name && def({ name: f.name })}
          aria-label="Nom du champ (HuBL)"
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-base text-[#e3a6ff] outline-none hover:border-line focus:border-violet lg:text-xs"
        />
        {b.field && (
          <button
            type="button"
            title="Revenir au nom et au libellé automatiques"
            aria-label="Réinitialiser le champ"
            onClick={() => set({ field: undefined })}
            className="rounded p-1 text-mute hover:text-white"
          >
            <RotateCcw className="size-3" />
          </button>
        )}
      </div>
      {b.type === 'button' && (
        <div className="mb-3 grid grid-cols-2 gap-2 pl-6">
          {(
            [
              { k: 'textName', label: 'Nom du texte', ph: `${b.field?.name ?? f.name}_label` },
              { k: 'linkName', label: 'Nom du lien', ph: `${b.field?.name ?? f.name}_link` },
            ] as const
          ).map((o) => (
            <label key={o.k} className="min-w-0">
              <span className={caption}>{o.label}</span>
              <input
                value={b.field?.[o.k] ?? ''}
                onChange={(e) => def({ [o.k]: e.target.value.trim() || undefined })}
                placeholder={o.ph}
                spellCheck={false}
                className="w-full rounded border border-line bg-void px-1.5 py-1 font-mono text-base text-[#e3a6ff] outline-none focus:border-violet lg:text-xs"
              />
            </label>
          ))}
        </div>
      )}
      <span className={caption}>Valeur</span>
      <Value b={b} set={set} />
    </div>
  )
}

export function FieldsPanel(p: Props) {
  const fields = collectFields(p.tree)
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <div className="px-1">
        <h3 className="font-display font-semibold">Champs du module</h3>
        <p className="text-xs text-mute">
          Chaque titre, texte, bouton et image est un champ. Renomme-le et modifie sa valeur ici, ou directement dans l'aperçu. Le nom en{' '}
          <code className="font-mono text-[#e3a6ff]">{'{{ module.nom }}'}</code> est celui du module exporté.
        </p>
      </div>
      {fields.map((f) => (
        <FieldCard key={f.block.id} f={f} p={p} />
      ))}
      {(p.tree.fields?.length ?? 0) > 0 && (
        <>
          <div className="px-1 pt-3">
            <h3 className="font-display font-semibold">Variables du code</h3>
            <p className="text-xs text-mute">
              Champs créés automatiquement pour les variables que ton code utilise. La variable reste en place dans le contenu : modifie ici la valeur
              affichée dans l'aperçu et exportée dans fields.json.
            </p>
          </div>
          {p.tree.fields!.map((f) => (
            <ExtraFieldCard key={f.name} f={f} p={p} />
          ))}
        </>
      )}
      {fields.length === 0 && !p.tree.fields?.length && (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-mute">
          Aucun champ pour l'instant. Ajoute un titre, un texte, un bouton ou une image depuis la structure.
        </p>
      )}
    </div>
  )
}
