import { useEffect, useRef, useState } from 'react'
import { Braces, ImageIcon, Plus, RotateCcw, X } from 'lucide-react'

import { ImageUpload } from './ImageUpload'
import { PhotoButton } from './PhotoButton'
import { BLOCK_ICONS } from './Structure'
import { defaultFor } from '@/lib/extra-fields'
import { addField, editField, optionsToText, removeField, renameField, retypeField, setRepeated, textToOptions } from '@/lib/field-edit'
import type { FieldPath } from '@/lib/field-edit'
import { FIELD_KIND, collectFields } from '@/lib/fields'
import type { FieldBlock, ModuleField } from '@/lib/fields'
import { updateNode } from '@/lib/tree'
import { keptTemplate } from '@/lib/template-params'
import { TemplateParams } from './TemplateParams'
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
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <ImageUpload compact onUploaded={(src) => set({ src })} />
              </div>
              <PhotoButton compact src={b.src} onSave={(src) => set({ src })} />
            </div>
          </div>
        </div>
      )
  }
}

export const TYPE_LABEL: Record<ExtraFieldType, string> = {
  text: 'Texte',
  richtext: 'Texte enrichi',
  number: 'Nombre',
  boolean: 'Oui / non',
  link: 'Lien',
  url: 'URL',
  image: 'Image',
  file: 'Fichier',
  color: 'Couleur',
  font: 'Police',
  alignment: 'Alignement',
  textalignment: 'Alignement du texte',
  backgroundimage: 'Image de fond',
  date: 'Date',
  datetime: 'Date et heure',
  choice: 'Liste de choix',
  group: 'Groupe',
  json: 'Valeur HubSpot',
}

const asObj = (v: Json | undefined): Record<string, Json> => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
// <input type=datetime-local> works in local time, the field stores a timestamp.
const toLocal = (ms: Json | undefined) => {
  const d = new Date(typeof ms === 'number' ? ms : Date.now())
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

const select = (value: string, options: [string, string][], onChange: (v: string) => void, label: string) => (
  <select className={input} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
    {options.map(([v, l]) => (
      <option key={v} value={v}>
        {l}
      </option>
    ))}
  </select>
)

// Exact HubSpot value (spacing, border, icon, form…), edited as JSON.
function JsonValue({ value, set }: { value: Json | undefined; set: (v: Json) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2))
  const [error, setError] = useState('')
  useEffect(() => setText(JSON.stringify(value ?? null, null, 2)), [value])
  return (
    <div>
      <textarea
        className={`${input} ${mono} min-h-24`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            set(JSON.parse(text) as Json)
            setError('')
          } catch {
            setError('JSON invalide : la valeur précédente est gardée.')
          }
        }}
        aria-label="Valeur (JSON, format HubSpot)"
      />
      {error && <p className="mt-1 text-xs text-pink">{error}</p>}
    </div>
  )
}

// Value editor for any field, nested groups and repeated items included.
function ValueEditor({ f, value, set }: { f: ExtraField; value: Json | undefined; set: (v: Json) => void }) {
  if (f.repeater) {
    const list = Array.isArray(value) ? value : []
    const one = { ...f, repeater: false }
    return (
      <div className="space-y-2">
        {list.map((it, i) => (
          <div key={i} className="rounded-md border border-line p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className={caption}>Élément {i + 1}</span>
              <button onClick={() => set(list.filter((_, j) => j !== i))} className="text-xs text-mute underline hover:text-pink" aria-label={`Retirer l'élément ${i + 1}`}>
                Retirer
              </button>
            </div>
            <ValueEditor f={one} value={it} set={(v) => set(list.map((x, j) => (j === i ? v : x)))} />
          </div>
        ))}
        <button onClick={() => set([...list, (list.at(-1) ?? defaultFor(one)) as Json])} className="text-xs text-cyan underline hover:text-white">
          + Ajouter un élément
        </button>
      </div>
    )
  }
  const d: Json = value === undefined ? defaultFor(f) : value
  const o = asObj(d)
  switch (f.type) {
    case 'group':
      return (
        <div className="space-y-2 border-l border-line pl-3">
          {(f.children ?? []).map((c) => (
            <div key={c.name}>
              <span className={caption}>
                {c.label} <span className="normal-case text-mute/70">· {c.hsType ?? c.type}</span>
              </span>
              <ValueEditor f={c} value={c.name in o ? o[c.name] : c.noDefault && c.type === 'number' ? null : c.default} set={(v) => set({ ...o, [c.name]: v })} />
            </div>
          ))}
        </div>
      )
    case 'text':
      return <input className={input} value={d === null ? '' : String(d)} onChange={(e) => set(e.target.value)} aria-label="Valeur" placeholder={f.hsType === 'cta' ? 'Identifiant du CTA HubSpot' : undefined} />
    case 'richtext':
      return <textarea className={`${input} min-h-20`} value={String(d ?? '')} onChange={(e) => set(e.target.value)} aria-label="Valeur (HTML inline autorisé)" />
    case 'number':
      // Empty stays empty (null): templates test `is number` to apply a value only when one is given.
      return <input type="number" className={input} value={d === null || d === undefined ? '' : Number(d)} onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} aria-label="Valeur" placeholder="Vide" />
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={d === true} onChange={(e) => set(e.target.checked)} className="size-4 accent-pink" /> Activé
        </label>
      )
    case 'choice':
      return select(String(d ?? ''), (f.options ?? []).map((x) => [x.value, x.label]), set, 'Valeur')
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
          value={String(asObj(o.url).href ?? '')}
          onChange={(e) => set({ ...o, url: { ...asObj(o.url), type: 'EXTERNAL', href: e.target.value, content_id: null } })}
          placeholder="https://…"
          aria-label="Lien"
        />
      )
    case 'url':
      return <input className={`${input} ${mono}`} value={String(o.href ?? '')} onChange={(e) => set({ ...o, href: e.target.value, type: 'EXTERNAL', content_id: null })} placeholder="https://…" aria-label="URL" />
    case 'file':
      return (
        <div className="grid gap-2">
          <input className={`${input} ${mono}`} value={String(d ?? '')} onChange={(e) => set(e.target.value)} placeholder="https://…" aria-label="URL du fichier" />
          <ImageUpload compact onUploaded={(src) => set(src)} />
        </div>
      )
    case 'image':
    case 'backgroundimage':
      return (
        <div className="grid gap-2">
          <input className={`${input} ${mono}`} value={String(o.src ?? '')} onChange={(e) => set({ ...o, src: e.target.value })} placeholder="https://…" aria-label="URL de l'image" />
          <ImageUpload compact onUploaded={(src) => set({ ...o, src })} />
          {f.type === 'image' ? (
            <>
              <input className={input} value={String(o.alt ?? '')} onChange={(e) => set({ ...o, alt: e.target.value })} aria-label="Texte alternatif" placeholder="Texte alternatif" />
              <ImageSize o={o} set={set} />
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {select(String(o.background_position ?? 'MIDDLE_CENTER'), ['TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT', 'MIDDLE_LEFT', 'MIDDLE_CENTER', 'MIDDLE_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_CENTER', 'BOTTOM_RIGHT'].map((p) => [p, p.toLowerCase().replace('_', ' ')]), (v) => set({ ...o, background_position: v }), 'Position')}
              {select(String(o.background_size ?? 'cover'), [['cover', 'Couvrir'], ['contain', 'Contenir'], ['auto', 'Taille réelle']], (v) => set({ ...o, background_size: v }), 'Taille')}
            </div>
          )}
        </div>
      )
    case 'color':
      return (
        <div className="flex items-center gap-2">
          <input type="color" value={String(o.color ?? '#000000').slice(0, 7)} onChange={(e) => set({ ...o, color: e.target.value })} className="size-9 shrink-0 rounded border border-line bg-void" aria-label="Couleur" />
          <input className={`${input} ${mono}`} value={String(o.color ?? '')} onChange={(e) => set({ ...o, color: e.target.value })} aria-label="Valeur de la couleur" />
        </div>
      )
    case 'font':
      return (
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <input className={input} value={String(o.font ?? '')} onChange={(e) => set({ ...o, font: e.target.value })} aria-label="Police" placeholder="Arial" />
          <input type="number" className={input} value={Number(o.size ?? 16)} onChange={(e) => set({ ...o, size: Number(e.target.value) })} aria-label="Taille" />
          <div className="col-span-2 flex items-center gap-2">
            <input type="color" value={String(o.color ?? '#000000').slice(0, 7)} onChange={(e) => set({ ...o, color: e.target.value })} className="size-9 shrink-0 rounded border border-line bg-void" aria-label="Couleur du texte" />
            <input className={`${input} ${mono}`} value={String(o.color ?? '')} onChange={(e) => set({ ...o, color: e.target.value })} aria-label="Valeur de la couleur du texte" />
          </div>
        </div>
      )
    case 'alignment':
      return (
        <div className="grid grid-cols-2 gap-2">
          {select(String(o.horizontal_align ?? 'LEFT'), [['LEFT', 'Gauche'], ['CENTER', 'Centre'], ['RIGHT', 'Droite']], (v) => set({ ...o, horizontal_align: v }), 'Alignement horizontal')}
          {select(String(o.vertical_align ?? 'TOP'), [['TOP', 'Haut'], ['MIDDLE', 'Milieu'], ['BOTTOM', 'Bas']], (v) => set({ ...o, vertical_align: v }), 'Alignement vertical')}
        </div>
      )
    case 'textalignment':
      return select(String(o.text_align ?? 'LEFT'), [['LEFT', 'Gauche'], ['CENTER', 'Centre'], ['RIGHT', 'Droite'], ['JUSTIFY', 'Justifié']], (v) => set({ ...o, text_align: v }), 'Alignement du texte')
    case 'json':
      return <JsonValue value={d} set={set} />
  }
}

// Size and loading of an image field (HubSpot's image settings): automatic,
// exact width × height, or automatic with a maximum width / height.
function ImageSize({ o, set }: { o: Record<string, Json>; set: (v: Json) => void }) {
  const size = String(o.size_type ?? 'auto')
  const num = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : '')
  const put = (k: string, v: string) => set({ ...o, [k]: v === '' ? null : Math.max(0, Math.round(Number(v))) })
  const box = (k: string, label: string) => (
    <label className="grid gap-1 text-[11px] text-mute">
      {label}
      <input type="number" min={0} className={input} value={num(k)} onChange={(e) => put(k, e.target.value)} placeholder="auto" />
    </label>
  )
  return (
    <details className="rounded-md border border-line" open={size !== 'auto' || o.width != null}>
      <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-mute hover:text-white">Taille et chargement</summary>
      <div className="grid gap-2 p-2.5 pt-1">
        {select(size, [['auto', 'Automatique (taille de l’image)'], ['exact', 'Exacte (largeur × hauteur)'], ['auto_custom_max', 'Automatique, avec un maximum']], (v) => set({ ...o, size_type: v }), 'Taille de l’image')}
        <div className="grid grid-cols-2 gap-2">
          {size === 'auto_custom_max' ? (
            <>
              {box('max_width', 'Largeur max (px)')}
              {box('max_height', 'Hauteur max (px)')}
            </>
          ) : (
            <>
              {box('width', 'Largeur (px)')}
              {box('height', 'Hauteur (px)')}
            </>
          )}
        </div>
        {size === 'exact' && <p className="text-[11px] text-mute">Si la CSS du module impose une taille aux images (ex. « Hauteur du logo » dans Réglages du modèle), c’est elle qui l’emporte.</p>}
        {select(String(o.loading ?? 'lazy'), [['lazy', 'Chargement différé (lazy)'], ['eager', 'Chargement immédiat (eager)'], ['disabled', 'Sans attribut loading']], (v) => set({ ...o, loading: v }), 'Chargement de l’image')}
      </div>
    </details>
  )
}

function ExtraValue({ f, set }: { f: ExtraField; set: (v: Json) => void }) {
  return <ValueEditor f={f} value={f.default === undefined ? defaultFor(f) : f.default} set={set} />
}

const TYPES = Object.keys(TYPE_LABEL) as ExtraFieldType[]

// Name of a field (HuBL), renamed on leaving the box: the values and the code
// that reads it follow (module.a.b, and the {% for %} variables over its group).
function NameInput({ name, path, p, prefix }: { name: string; path: FieldPath; p: Props; prefix: string }) {
  const [text, setText] = useState(name)
  useEffect(() => setText(name), [name])
  const apply = () => {
    const next = renameField(p.tree, path, text)
    if (next === p.tree) setText(name)
    else p.commit(next)
  }
  return (
    <span className="flex min-w-[9rem] flex-[1_1_9rem] items-center font-mono text-base text-[#e3a6ff] lg:text-xs">
      <span className="shrink-0 text-mute">{prefix}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="Nom du champ (HuBL)"
        spellCheck={false}
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-0.5 py-0.5 outline-none hover:border-line focus:border-violet"
      />
    </span>
  )
}

function TypeSelect({ f, path, p }: { f: ExtraField; path: FieldPath; p: Props }) {
  return (
    <select
      value={f.type}
      onChange={(e) => p.commit(retypeField(p.tree, path, e.target.value as ExtraFieldType))}
      aria-label={`Type du champ ${f.label}`}
      className="shrink-0 rounded-full border border-line bg-void px-2 py-0.5 text-[11px] text-mute outline-none focus:border-cyan"
    >
      {TYPES.map((t) => (
        <option key={t} value={t}>
          {TYPE_LABEL[t]}
        </option>
      ))}
    </select>
  )
}

function Repeated({ f, path, p }: { f: ExtraField; path: FieldPath; p: Props }) {
  return (
    <label className="flex shrink-0 items-center gap-1 text-[11px] text-mute" title="Plusieurs éléments (boucle {% for %}, « occurrence » dans HubSpot)">
      <input type="checkbox" checked={!!f.repeater} onChange={(e) => p.commit(setRepeated(p.tree, path, e.target.checked))} className="size-3.5 accent-pink" />
      Répété
    </label>
  )
}

function Options({ f, path, p }: { f: ExtraField; path: FieldPath; p: Props }) {
  const [text, setText] = useState(() => optionsToText(f.options))
  useEffect(() => setText(optionsToText(f.options)), [f.options])
  return (
    <label className="mt-1.5 block">
      <span className={caption}>Choix proposés · une ligne par choix : valeur | libellé</span>
      <textarea
        className={`${input} ${mono} min-h-16`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const options = textToOptions(text)
          if (options.length) p.commit(editField(p.tree, path, { options }))
          else setText(optionsToText(f.options))
        }}
      />
    </label>
  )
}

// « + Ajouter un champ » at the top, or inside a group (any depth).
function AddField({ parent, p, label }: { parent: FieldPath; p: Props; label: string }) {
  const [type, setType] = useState<ExtraFieldType>('text')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => p.commit(addField(p.tree, parent, type, type === 'group' ? 'Nouveau groupe' : 'Nouveau champ').tree)}
        aria-label={parent.length ? `Ajouter un champ dans le groupe ${parent.join(' › ')}` : 'Ajouter un champ au module'}
        className="inline-flex min-w-0 items-center gap-1 rounded-md border border-dashed border-line px-2 py-1 text-left text-xs text-cyan hover:border-cyan"
      >
        <Plus className="size-3.5" /> {label}
      </button>
      <select value={type} onChange={(e) => setType(e.target.value as ExtraFieldType)} aria-label="Type du champ à ajouter" className="rounded-md border border-line bg-void px-1.5 py-1 text-[11px] text-mute outline-none focus:border-cyan">
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </select>
    </div>
  )
}

// The fields of a group, each editable (label, name, type, repeated, choices,
// removal) and, for a group inside it, its own fields: every level.
function GroupFields({ f, path, p, prefix }: { f: ExtraField; path: FieldPath; p: Props; prefix: string }) {
  return (
    <div className="mt-2 space-y-2 border-l-2 border-violet/40 pl-3">
      {(f.children ?? []).map((c) => {
        const cp = [...path, c.name]
        return (
          <div key={c.name} className="rounded-md border border-line bg-void/40 p-2">
            <div className="flex items-center gap-1.5">
              <input
                value={c.label}
                onChange={(e) => p.commit(editField(p.tree, cp, { label: e.target.value }))}
                aria-label="Libellé du champ"
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold outline-none hover:border-line focus:border-cyan lg:text-xs"
              />
              <button type="button" onClick={() => p.commit(removeField(p.tree, cp))} aria-label={`Retirer le champ ${c.label}`} className="rounded p-1 text-mute hover:text-pink">
                <X className="size-3.5" />
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <NameInput name={c.name} path={cp} p={p} prefix={prefix} />
              <TypeSelect f={c} path={cp} p={p} />
              <Repeated f={c} path={cp} p={p} />
            </div>
            {c.type === 'choice' && <Options f={c} path={cp} p={p} />}
            {c.type === 'group' && <GroupFields f={c} path={cp} p={p} prefix={`${c.repeater ? 'item' : prefix + c.name}.`} />}
          </div>
        )
      })}
      <AddField parent={path} p={p} label={`Ajouter dans « ${f.label} »`} />
    </div>
  )
}

// A field of the module that no block owns: a variable of the code or a field
// of an imported fields.json. Its definition is editable at every level (a
// field the import missed or read wrongly can be added or corrected), its
// value below.
export function ExtraFieldCard({ f, p }: { f: ExtraField; p: Props }) {
  const path = [f.name]
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
        <TypeSelect f={f} path={path} p={p} />
      </div>
      <div className="mb-3 flex items-center gap-2 pl-6">
        <span className="text-mute">{'{{'}</span>
        <NameInput name={f.name} path={path} p={p} prefix="module." />
        <span className="text-mute">{'}}'}</span>
        <Repeated f={f} path={path} p={p} />
      </div>
      {(f.hsType || f.spec) && (
        <p className="-mt-2 mb-3 pl-6 text-[11px] text-mute">
          {f.hsType && <>Type HubSpot exact : <code className="font-mono text-[#e3a6ff]">{f.hsType}</code>. </>}
          {f.spec && 'Définition fields.json gardée à l’identique à l’export.'}
        </p>
      )}
      {f.type === 'choice' && <Options f={f} path={path} p={p} />}
      {f.type === 'group' && (
        <details open className="mb-3">
          <summary className="cursor-pointer text-xs text-mute hover:text-white">
            Champs du groupe ({f.children?.length ?? 0}) : ajouter, renommer, changer le type, à chaque niveau
          </summary>
          <GroupFields f={f} path={path} p={p} prefix={f.repeater ? 'item.' : `module.${f.name}.`} />
        </details>
      )}
      <span className={caption}>Valeur</span>
      <ExtraValue f={f} set={(v) => update({ default: v, sample: undefined })} />
      <button onClick={() => p.commit(removeField(p.tree, path))} className="mt-2 text-xs text-mute underline hover:text-pink">
        Retirer ce champ
      </button>
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
  const kept = keptTemplate(p.tree)
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <div className="px-1">
        <h2 className="font-display font-semibold">Champs du module</h2>
        <p className="text-xs text-mute">
          Chaque titre, texte, bouton et image est un champ. Renomme-le et modifie sa valeur ici, ou directement dans l'aperçu. Le nom en{' '}
          <code className="font-mono text-[#e3a6ff]">{'{{ module.nom }}'}</code> est celui du module exporté.
        </p>
      </div>
      {kept && <TemplateParams b={kept} onChange={(next) => p.commit(updateNode(p.tree, kept.id, next))} />}
      {fields.map((f) => (
        <FieldCard key={f.block.id} f={f} p={p} />
      ))}
      {(p.tree.fields?.length ?? 0) > 0 && (
        <>
          <div className="px-1 pt-3">
            <h2 className="font-display font-semibold">Champs du code et du fields.json</h2>
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
      <div className="rounded-lg border border-dashed border-line p-3">
        <p className="mb-2 text-xs text-mute">
          Un champ manque ou a été mal reconnu à l’import ? Ajoute-le ici, ou dans un groupe (à n’importe quel niveau) depuis sa carte. Change son type,
          son nom ou « Répété » : les valeurs suivent, et le code qui l’utilise est renommé avec lui.
        </p>
        <AddField parent={[]} p={p} label="Ajouter un champ au module" />
      </div>
      {fields.length === 0 && !p.tree.fields?.length && (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-mute">
          Aucun champ pour l'instant. Ajoute un titre, un texte, un bouton ou une image depuis la structure.
        </p>
      )}
    </div>
  )
}
