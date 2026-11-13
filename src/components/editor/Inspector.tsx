import { useState } from 'react'
import { guardedFetch } from '@/lib/session-guard'
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, BookmarkPlus, Braces, Check, ChevronRight, Copy, Eye, GitBranch, Layers, Loader2, Repeat, Sparkles, Trash2, Wand2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { BoxModel } from './BoxModel'
import type { BoxLayer } from './BoxModel'
import { ConvertPanel } from './ConvertPanel'
import { EstimatePanel } from './EstimatePanel'
import { ImageUpload } from './ImageUpload'
import { PhotoButton } from './PhotoButton'
import { ExtraFieldCard } from './FieldsPanel'
import { refreshCustomBlocks } from './useCustomBlocks'
import { wrapForLibrary } from '@/lib/custom-blocks'
import { saveBlock } from '@/lib/data'
import { BLOCK_ICONS } from './Structure'
import { htmlToBlocks, sanitizeHtml } from '@/lib/hubl'
import { isLogicBlock } from '@/lib/hubl-render'
import { countLogic, governed, logicFrames, logicInfo, removeLogic, setLogicExpr } from '@/lib/logic'
import { getPref, setPref, SETTINGS_EVENT } from '@/lib/settings-sync'
import { SHOW_LOGIC_KEY } from '@/lib/settings-keys'
import { collectFields } from '@/lib/fields'
import { BLOCK_LABELS } from '@/lib/types'
import type { Align, Block, ButtonBlock, Columns, ModuleTree, Section, Spacing } from '@/lib/types'
import { headingLine, headingWeight, spacingOf, textLine } from '@/lib/look'
import { buttonBold, buttonBorder, buttonBorderColor, buttonFontSize, buttonHeight } from '@/lib/vml'
import {
  duplicateNode,
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
export const input =
  'w-full rounded-md border border-line bg-void px-2.5 py-2 text-base text-white outline-none focus:border-cyan lg:py-1.5 lg:text-sm'
export const mono = 'font-mono lg:text-xs'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-mute">{label}</span>
      {children}
    </label>
  )
}

// Same caption as Field, for a set of buttons: a <label> would give the whole
// set's text as the name of its first button.
export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-mute">{label}</span>
      {children}
    </div>
  )
}

// Two controls (picker + code): a group, each control named, since a <label> holds only one.
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Group label={label}>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={`${label} (nuancier)`}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded border border-line bg-void lg:h-8 lg:w-10"
        />
        <input aria-label={`${label} (code)`} className={`${input} font-mono`} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Group>
  )
}

export function RangeField(props: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <Field label={`${props.label} · ${props.value}${props.unit ?? 'px'}`}>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="h-7 w-full accent-pink lg:h-auto"
      />
    </Field>
  )
}

// A setting that follows its default until it is moved; a link puts it back.
export function OptRange(props: { label: string; value: number | undefined; base: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number | undefined) => void }) {
  const set = props.value != null
  return (
    <div>
      <RangeField label={`${props.label}${set ? '' : ' (auto)'}`} value={props.value ?? props.base} min={props.min} max={Math.max(props.max, props.base)} step={props.step} unit={props.unit} onChange={props.onChange} />
      {set && (
        <button onClick={() => props.onChange(undefined)} className="-mt-1 text-xs text-mute underline hover:text-white">
          Valeur par défaut ({props.base}
          {props.unit ?? 'px'})
        </button>
      )}
    </div>
  )
}

// Margins (4 sides), inner margins (sections, buttons) and visibility: the
// same block of settings for every element, gathered in one box.
const MKEY = { t: 'mt', b: 'mb', l: 'ml', r: 'mr' } as const
const PKEY = { t: 'pt', b: 'pb', l: 'pl', r: 'pr' } as const

function SpacingFields({ b, set, nested }: { b: Block; set: (patch: Partial<Block>) => void; nested?: boolean }) {
  if (b.type === 'raw') return null
  const sp = b as Spacing
  const def = spacingOf({ ...b, mt: undefined, mb: undefined, ml: undefined, mr: undefined } as Block, nested)
  const hide = sp.hide
  const isSection = b.type === 'section'
  const margin: BoxLayer = {
    values: { t: sp.mt, b: sp.mb, l: sp.ml, r: sp.mr },
    base: { t: def.t, b: def.b, l: 0, r: 0 },
    locked: isSection
      ? { l: 'une section remplit toujours sa colonne : règle la marge intérieure de la section qui la contient', r: 'une section remplit toujours sa colonne : règle la marge intérieure de la section qui la contient' }
      : undefined,
    max: 200,
    onChange: (side, v) => set({ [MKEY[side]]: v } as Partial<Block>),
    onAll: (v) => set((isSection ? { mt: v, mb: v } : { mt: v, mb: v, ml: v, mr: v }) as Partial<Block>),
  }
  let padding: BoxLayer | undefined
  if (b.type === 'section') {
    const y = b.padY ?? b.padding
    const x = b.padX ?? b.padding
    // A section's inner margin always has a value: shown as typed, not greyed.
    padding = {
      values: { t: b.pt ?? y, r: b.pr ?? x, b: b.pb ?? y, l: b.pl ?? x },
      base: { t: y, b: y, l: x, r: x },
      custom: [b.pt, b.pr, b.pb, b.pl].some((v) => v != null),
      max: 200,
      onChange: (side, v) => set({ [PKEY[side]]: v } as Partial<Block>),
      onAll: (v) =>
        set(
          v == null
            ? { pt: undefined, pr: undefined, pb: undefined, pl: undefined }
            : { padding: v, padY: undefined, padX: undefined, pt: undefined, pr: undefined, pb: undefined, pl: undefined },
        ),
    }
  } else if (b.type === 'button') {
    // Top/bottom (same value both sides) replace a fixed height; left/right the side padding.
    const y = b.height ? Math.max(0, Math.round((b.height - Math.round(buttonFontSize(b) * 1.2)) / 2) - buttonBorder(b)) : 12
    padding = {
      values: { t: b.padY, b: b.padY, l: b.padX, r: b.padX },
      base: { t: y, b: y, l: 26, r: 26 },
      max: 70,
      onChange: (side, v) =>
        set((side === 't' || side === 'b' ? { padY: v == null ? undefined : Math.min(60, v), height: undefined } : { padX: v == null ? undefined : Math.max(6, v) }) as Partial<Block>),
      onAll: (v) => set({ padX: v == null ? undefined : Math.max(6, v), padY: v == null ? undefined : Math.min(60, v), height: undefined } as Partial<Block>),
    }
  }
  const note =
    b.type === 'section'
      ? 'Gauche et droite de la marge intérieure : bords extérieurs de la première et de la dernière colonne.'
      : b.type === 'button'
        ? 'Marge intérieure : haut et bas ensemble, gauche et droite ensemble (le texte reste centré).'
        : undefined
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <p className="font-mono text-[10px] tracking-wider text-mute uppercase">Marges et visibilité</p>
      <BoxModel margin={margin} padding={padding} label={isSection ? (nested ? 'Card' : 'Section') : BLOCK_LABELS[b.type]} note={note} />
      <p className="text-[11px] text-mute">Pour Outlook seulement : onglet Outlook de la fenêtre VML.</p>
      <Segmented
        label="Affichage"
        value={hide ?? 'all'}
        onChange={(v) => set({ hide: v === 'all' ? undefined : v } as Partial<Block>)}
        options={[
          { value: 'all', label: 'Partout' },
          { value: 'mobile', label: 'Pas sur mobile', title: 'Masqué sur les téléphones (≤ 480 px)' },
          { value: 'desktop', label: 'Mobile seul', title: 'Affiché seulement sur les téléphones (masqué sur ordinateur et dans Outlook)' },
        ]}
      />
    </div>
  )
}

// Personalised image: the URL can hold contact variables, resolved for each recipient.
const IMAGE_TOKENS = [
  { label: 'Prénom', token: '{{ contact.firstname }}' },
  { label: 'Entreprise', token: '{{ contact.company }}' },
  { label: 'Ville', token: '{{ contact.city }}' },
  { label: 'E-mail', token: '{{ contact.email }}' },
]

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
    <Group label={label}>
      <div className="flex rounded-md border border-line bg-void p-0.5">
        {options.map((o) => (
          <button
            type="button"
            key={String(o.value)}
            title={o.title}
            aria-pressed={value === o.value}
            aria-label={typeof o.label === 'string' ? undefined : o.title}
            onClick={() => onChange(o.value)}
            className={`flex flex-1 items-center justify-center rounded px-2 py-2 text-sm lg:py-1 lg:text-xs ${
              value === o.value ? 'bg-pink-fill text-white' : 'text-mute hover:text-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Group>
  )
}

// Height, text and border of a button: same fields in the editor panel and in the VML window.
// `inBox`: in the Réglages the side margins are in the « Marges » box, not here.
export function ButtonLookFields({ b, onChange, inBox }: { b: ButtonBlock; onChange: (patch: Partial<ButtonBlock>) => void; inBox?: boolean }) {
  const bw = buttonBorder(b)
  return (
    <div className="space-y-3">
      <Segmented
        label="Largeur"
        value={b.fullWidth ? 'full' : 'fit'}
        onChange={(v) => onChange({ fullWidth: v === 'full' || undefined })}
        options={[
          { value: 'fit', label: 'Ajustée au texte' },
          { value: 'full', label: 'Pleine largeur' },
        ]}
      />
      {!b.fullWidth && !inBox && <OptRange label="Marges latérales" value={b.padX} base={26} min={6} max={70} onChange={(padX) => onChange({ padX })} />}
      <RangeField label="Hauteur" value={buttonHeight(b)} min={28} max={80} onChange={(height) => onChange({ height })} />
      <RangeField label="Taille du texte" value={buttonFontSize(b)} min={11} max={28} onChange={(fontSize) => onChange({ fontSize })} />
      <Group label="Style du texte">
        <div className="flex rounded-md border border-line p-0.5 text-xs">
          {([[true, 'Gras'], [false, 'Normal']] as const).map(([v, l]) => (
            <button key={l} aria-pressed={buttonBold(b) === v} onClick={() => onChange({ bold: v ? undefined : false })} className={`flex-1 rounded px-2 py-1 ${buttonBold(b) === v ? 'bg-violet/20 text-white' : 'text-mute hover:text-white'}`}>
              {l}
            </button>
          ))}
        </div>
      </Group>
      <RangeField label="Bordure" value={bw} min={0} max={8} onChange={(w) => onChange(w ? { borderWidth: w, borderColor: b.borderColor ?? b.color } : { borderWidth: undefined, borderColor: undefined })} />
      {bw > 0 && <ColorField label="Couleur de la bordure" value={buttonBorderColor(b)} onChange={(borderColor) => onChange({ borderColor })} />}
      {(b.height || b.fontSize || b.bold === false || bw > 0 || b.fullWidth || b.padX != null || b.padY != null) && (
        <button onClick={() => onChange({ height: undefined, fontSize: undefined, bold: undefined, borderWidth: undefined, borderColor: undefined, fullWidth: undefined, padX: undefined, padY: undefined })} className="text-xs text-mute underline hover:text-white">
          Réinitialiser l'apparence
        </button>
      )}
    </div>
  )
}

export const AlignField = ({ value, onChange }: { value: Align; onChange: (v: Align) => void }) => (
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

// "Mes blocs": saves the element (or a whole card / section) to reuse it in any
// module (Structure > Ajouter > Mes blocs). Works offline: sent when back online.
const suggestName = (b: Block): string =>
  (b.type === 'heading'
    ? b.text
    : b.type === 'button'
      ? `Bouton ${b.label}`
      : b.type === 'image'
        ? b.alt || 'Image'
        : b.type === 'text'
          ? b.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ')
          : BLOCK_LABELS[b.type]
  ).slice(0, 60) || BLOCK_LABELS[b.type]

const SAVED: Record<string, string> = {
  created: 'Enregistré dans Mes blocs : retrouve-le dans l’onglet Structure, en bas (« Mes blocs »), dans tous tes modules.',
  updated: 'Mis à jour : un bloc portait déjà ce nom.',
  exists: 'Déjà dans Mes blocs (contenu identique) : rien n’a été doublé.',
  local: 'Enregistré sur cet appareil : il sera envoyé dès le retour de la connexion.',
}

function SaveToLibrary({ items, defaultName, onDone }: { items: { name: string; section: Section }[] | ((name: string) => { name: string; section: Section }[]); defaultName: string; onDone?: () => void }) {
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const list = typeof items === 'function' ? items(name.trim() || defaultName) : items.map((x) => ({ ...x, name: name.trim() || x.name }))
      const res = []
      for (const it of list) res.push(await saveBlock(it.name.slice(0, 80), description.trim().slice(0, 300), it.section))
      refreshCustomBlocks()
      const st = res.length === 1 ? res[0].status : res.every((r) => r.status === 'local') ? 'local' : 'created'
      const dup = res.filter((r) => r.status === 'exists').length
      const multi = `${res.length - dup} section${res.length - dup > 1 ? 's' : ''} enregistrée${res.length - dup > 1 ? 's' : ''} dans Mes blocs${dup ? ` (${dup} déjà présente${dup > 1 ? 's' : ''}, non doublée${dup > 1 ? 's' : ''})` : ''}.${st === 'local' ? ' Envoi au retour de la connexion.' : ''}`
      setMsg({ ok: true, text: res.length > 1 ? multi : SAVED[st] })
      onDone?.()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Enregistrement impossible' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-violet/40 bg-violet/5 p-3">
      <Field label="Nom dans Mes blocs">
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <Field label="Description (facultatif)">
        <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="À quoi sert ce bloc" />
      </Field>
      <button
        onClick={() => void run()}
        disabled={busy || !name.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-violet px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <BookmarkPlus className="size-4" />} Enregistrer
      </button>
      {msg && (
        <p role="status" className={`flex items-start gap-1.5 text-xs ${msg.ok ? 'text-cyan' : 'text-pink'}`}>
          {msg.ok && <Check className="mt-0.5 size-3.5 shrink-0" />} {msg.text}
        </p>
      )}
    </div>
  )
}

// The module fields a code block uses (countdown, dynamic image…), editable right here.
function RawFields({ html, p }: { html: string; p: Props }) {
  const names = new Set([...html.matchAll(/module\.(\w+)/g)].map((m) => m[1]))
  const fields = (p.tree.fields ?? []).filter((f) => names.has(f.name))
  if (!fields.length) return null
  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] tracking-wider text-mute uppercase">Réglages de ce bloc</p>
      <p className="text-xs text-mute">Les variables de ce code, modifiables sans y toucher (aussi dans l'onglet Champs).</p>
      {fields.map((f) => (
        <ExtraFieldCard key={f.name} f={f} p={p} />
      ))}
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
          'Titres, textes, boutons, images, séparateurs et colonnes deviennent des blocs. La logique ({% if %}, {% for %}…) reste autour, en lignes de logique.'}
      </p>
    </div>
  )
}

// Shows or hides the logic lines in the Structure tab (synced preference; the tab re-reads it).
function useShowLogic(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => getPref(SHOW_LOGIC_KEY) === '1')
  return [
    on,
    (v) => {
      setOn(v)
      setPref(SHOW_LOGIC_KEY, v ? '1' : '0')
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: [SHOW_LOGIC_KEY] }))
    },
  ]
}

const blockName = (b: Block) =>
  b.type === 'section' ? b.name || BLOCK_LABELS.section : 'field' in b && b.field?.label ? b.field.label : b.type === 'heading' ? b.text.replace(/<[^>]+>/g, '').slice(0, 40) || BLOCK_LABELS.heading : b.type === 'button' ? b.label.slice(0, 40) || BLOCK_LABELS.button : BLOCK_LABELS[b.type]

// A logic line: what it does in plain words, the elements it governs, its
// condition editable on its own, and « remove it but keep the content ».
function LogicFields({ b, set, p }: { b: Extract<Block, { type: 'raw' }>; set: (patch: Partial<Block>) => void; p: Props }) {
  const info = logicInfo(b, p.tree)!
  const [showCode, setShowCode] = useState(false)
  const kids = governed(p.tree, b.id)
  const editable = info.kind === 'if' || info.kind === 'elif' || info.kind === 'for' || info.kind === 'set'
  const Icon = info.kind === 'for' ? Repeat : info.kind === 'if' || info.kind === 'elif' || info.kind === 'else' ? GitBranch : Braces
  return (
    <>
      <div className="rounded-lg border border-violet/40 bg-violet/10 p-3 text-sm">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-[#e3a6ff]">
          <Icon className="size-4 shrink-0" aria-hidden /> {info.title}
        </p>
        <p className="text-[#d6d6ea]">{info.summary}</p>
        <p className="mt-2 text-xs text-mute">Une ligne de logique ne s’affiche jamais dans l’e-mail : seul son effet compte. Elle est masquée dans la Structure tant que tu n’affiches pas les lignes de logique.</p>
      </div>
      {editable && (
        <Field label={info.kind === 'for' ? 'Liste parcourue (code)' : info.kind === 'set' ? 'Calcul (code)' : 'Condition (code)'}>
          <input className={`${input} ${mono}`} value={info.expr} onChange={(e) => set({ html: setLogicExpr(b.html, e.target.value) })} spellCheck={false} />
        </Field>
      )}
      {kids.length > 0 && (
        <div>
          <p className="mb-1 font-mono text-[10px] tracking-wider text-mute uppercase">{info.kind === 'for' ? 'Éléments répétés' : 'Éléments concernés'}</p>
          <ul className="space-y-1">
            {kids.map((k) => {
              const KIcon = BLOCK_ICONS[k.type]
              return (
                <li key={k.id}>
                  <button type="button" onClick={() => p.onSelect(k.id)} className="flex w-full items-center gap-2 rounded-md border border-line px-2.5 py-2 text-left text-sm hover:border-cyan lg:py-1.5">
                    <KIcon className="size-3.5 shrink-0 text-cyan" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{blockName(k)}</span>
                    <ChevronRight className="size-3.5 shrink-0 text-mute" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {(info.kind === 'if' || info.kind === 'for') && (
        <button
          type="button"
          onClick={() => p.commit(removeLogic(p.tree, b.id), kids[0]?.id ?? null)}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-cyan/50 px-3 py-2 text-sm text-cyan hover:bg-cyan/10"
        >
          <Eye className="size-4" aria-hidden /> {info.kind === 'if' ? 'Toujours afficher (retirer la condition)' : 'Afficher une seule fois (retirer la boucle)'}
        </button>
      )}
      {(info.kind === 'if' || info.kind === 'for') && (
        <p className="-mt-2 text-xs text-mute">
          {info.kind === 'if' ? 'Garde les éléments du premier cas ; les cas « sinon » sont retirés.' : 'Garde les éléments de la boucle, affichés une fois.'} « Annuler » revient en arrière.
        </p>
      )}
      <button type="button" aria-expanded={showCode} onClick={() => setShowCode(!showCode)} className="flex items-center gap-1 text-xs text-mute hover:text-white">
        <ChevronRight className={`size-3.5 transition-transform ${showCode ? 'rotate-90' : ''}`} aria-hidden /> Code de la ligne
      </button>
      {showCode && (
        <Field label="Code (HuBL)">
          <textarea className={`${input} ${mono} min-h-20`} value={b.html} onChange={(e) => set({ html: e.target.value })} spellCheck={false} />
        </Field>
      )}
    </>
  )
}

// Content inside a condition or a loop: says when it shows, and leads to the logic line.
function LogicContext({ id, p }: { id: string; p: Props }) {
  const frames = logicFrames(p.tree).get(id)
  if (!frames?.length) return null
  return (
    <div className="rounded-lg border border-violet/40 bg-violet/5 p-2.5 text-xs">
      {frames.map((f) => (
        <div key={f.id} className="flex items-start gap-1.5 py-0.5">
          {f.kind === 'for' ? <Repeat className="mt-0.5 size-3.5 shrink-0 text-[#e3a6ff]" aria-hidden /> : <GitBranch className="mt-0.5 size-3.5 shrink-0 text-[#e3a6ff]" aria-hidden />}
          <span className="min-w-0 flex-1 text-[#d6d6ea]">{f.kind === 'for' ? `${f.text[0].toUpperCase()}${f.text.slice(1)}.` : `Affiché ${f.text}.`}</span>
          <button type="button" onClick={() => p.onSelect(f.id)} className="tap-auto min-h-6 shrink-0 rounded px-1.5 py-0.5 text-[#e3a6ff] underline-offset-2 hover:underline">
            Voir<span className="sr-only"> la {f.kind === 'for' ? 'boucle' : 'condition'}</span>
          </button>
        </div>
      ))}
    </div>
  )
}

// Collapsible group of the module settings.
function Panel({ title, children, open: initial = true }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <section className="rounded-lg border border-line">
      <h3>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
          <ChevronRight className={`size-3.5 shrink-0 text-mute transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
          <span className="font-mono text-[10px] tracking-wider text-mute uppercase">{title}</span>
        </button>
      </h3>
      {open && <div className="space-y-4 px-3 pb-3">{children}</div>}
    </section>
  )
}

// What the module holds, at a glance; logic lines can be shown from here.
function ModuleSummary({ tree, onSelect }: { tree: ModuleTree; onSelect: (id: string) => void }) {
  const [showLogic, setShowLogic] = useShowLogic()
  let blocks = 0
  const walk = (list: Block[]) => list.forEach((b) => (b.type === 'section' ? walk(b.cells.flat()) : !isLogicBlock(b) && blocks++))
  tree.sections.forEach((s) => walk(s.cells.flat()))
  const logic = countLogic(tree)
  const fields = collectFields(tree).length + (tree.fields?.length ?? 0)
  const stat = (n: number, one: string, many: string) => (
    <div className="rounded-md bg-void px-2 py-1.5 text-center">
      <span className="block font-display text-lg font-semibold leading-tight text-white">{n}</span>
      <span className="block text-[10px] text-mute">{n > 1 ? many : one}</span>
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {stat(tree.sections.length, 'section', 'sections')}
        {stat(blocks, 'élément', 'éléments')}
        {stat(fields, 'champ', 'champs')}
      </div>
      {tree.sections.length > 0 && (
        <ul className="space-y-1" aria-label="Sections du module">
          {tree.sections.map((sec, i) => (
            <li key={sec.id}>
              <button type="button" onClick={() => onSelect(sec.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[#c9c9de] hover:bg-white/5 hover:text-white lg:py-1">
                <Layers className="size-3.5 shrink-0 text-cyan" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{sec.name || `Section ${i + 1}`}</span>
                <span className="shrink-0 text-[10px] text-mute">
                  {sec.columns} col
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {logic > 0 && (
        <div className="rounded-md border border-violet/40 bg-violet/5 p-2.5 text-xs">
          <p className="flex items-start gap-1.5 text-[#d6d6ea]">
            <Braces className="mt-0.5 size-3.5 shrink-0 text-[#e3a6ff]" aria-hidden />
            <span>
              {logic} ligne{logic > 1 ? 's' : ''} de logique (conditions, boucles, variables) : invisible{logic > 1 ? 's' : ''} dans l’e-mail, {showLogic ? 'affichée' : 'masquée'}
              {logic > 1 ? 's' : ''} dans la Structure.
            </span>
          </p>
          <button type="button" aria-pressed={showLogic} onClick={() => setShowLogic(!showLogic)} className="mt-1.5 rounded border border-violet/50 px-2 py-1 text-[#e3a6ff] hover:bg-violet/10">
            {showLogic ? 'Les masquer dans la Structure' : 'Les afficher dans la Structure'}
          </button>
        </div>
      )}
    </div>
  )
}

function BlockFields({ b, set, p }: { b: Block; set: (patch: Partial<Block>) => void; p: Props }) {
  if (b.type === 'raw' && isLogicBlock(b)) return <LogicFields b={b} set={set} p={p} />
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
          <Segmented
            label="Graisse"
            value={headingWeight(b)}
            onChange={(weight) => set({ weight: weight === 700 ? undefined : weight })}
            options={[
              { value: 400, label: 'Normal' },
              { value: 600, label: 'Semi' },
              { value: 700, label: 'Gras' },
              { value: 900, label: 'Extra' },
            ]}
          />
          <OptRange label="Interligne" unit="" value={b.lineHeight} base={headingLine({ ...b, lineHeight: undefined })} min={0.9} max={2} step={0.05} onChange={(lineHeight) => set({ lineHeight })} />
          <OptRange label="Espacement des lettres" value={b.letterSpacing} base={0} min={-2} max={10} step={0.5} onChange={(letterSpacing) => set({ letterSpacing: letterSpacing || undefined })} />
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
          <OptRange label="Interligne" unit="" value={b.lineHeight} base={textLine({ ...b, lineHeight: undefined })} min={1} max={2.4} step={0.05} onChange={(lineHeight) => set({ lineHeight })} />
          <OptRange label="Espacement des lettres" value={b.letterSpacing} base={0} min={-1} max={6} step={0.5} onChange={(letterSpacing) => set({ letterSpacing: letterSpacing || undefined })} />
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
          <ButtonLookFields b={b} onChange={set} inBox />
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
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <ImageUpload onUploaded={(src) => set({ src })} />
            </div>
            <PhotoButton src={b.src} onSave={(src) => set({ src })} />
          </div>
          <Field label="Ou URL de l'image (https://…)">
            <input className={`${input} ${mono}`} value={b.src} onChange={(e) => set({ src: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="Texte alternatif">
            <input className={input} value={b.alt} onChange={(e) => set({ alt: e.target.value })} />
          </Field>
          <div className="rounded-lg border border-line p-3">
            <p className="mb-1.5 font-mono text-[10px] tracking-wider text-mute uppercase">Image dynamique</p>
            <p className="mb-2 text-xs text-mute">
              Insère une variable du contact dans l'URL : chaque destinataire reçoit sa propre image (service d'images personnalisées). L'aperçu utilise le contact d'exemple.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {IMAGE_TOKENS.map((t) => (
                <button
                  key={t.token}
                  onClick={() => set({ src: `${b.src}${t.token}` })}
                  title={`Ajouter ${t.token} à la fin de l'URL`}
                  className="rounded-full border border-line bg-void px-2.5 py-1 font-mono text-[11px] text-[#e3a6ff] hover:border-violet"
                >
                  + {t.label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Lien au clic (image cliquable)">
            <input className={`${input} ${mono}`} value={b.href ?? ''} onChange={(e) => set({ href: e.target.value || undefined })} placeholder="https://… (facultatif)" />
          </Field>
          <RangeField label="Largeur" unit="%" value={b.width} min={10} max={100} onChange={(width) => set({ width })} />
          <AlignField value={b.align} onChange={(align) => set({ align })} />
          <RangeField label="Arrondi" value={b.radius ?? 0} min={0} max={60} onChange={(radius) => set({ radius: radius || undefined })} />
        </>
      )
    case 'divider':
      return (
        <>
          <ColorField label="Couleur" value={b.color} onChange={(color) => set({ color })} />
          <RangeField label="Épaisseur" value={b.thickness ?? 1} min={1} max={8} onChange={(thickness) => set({ thickness: thickness === 1 ? undefined : thickness })} />
          <Segmented
            label="Style"
            value={b.lineStyle ?? 'solid'}
            onChange={(lineStyle) => set({ lineStyle: lineStyle === 'solid' ? undefined : lineStyle })}
            options={[
              { value: 'solid', label: 'Plein' },
              { value: 'dashed', label: 'Tirets' },
              { value: 'dotted', label: 'Points' },
            ]}
          />
          <RangeField label="Largeur" unit="%" value={b.width ?? 100} min={10} max={100} onChange={(width) => set({ width: width === 100 ? undefined : width })} />
        </>
      )
    case 'spacer':
      return (
        <>
          <RangeField label="Hauteur" value={b.height} min={4} max={160} onChange={(height) => set({ height })} />
          <OptRange label="Hauteur sur mobile" value={b.mobileHeight} base={b.height} min={0} max={160} onChange={(mobileHeight) => set({ mobileHeight })} />
        </>
      )
    case 'raw':
      return (
        <>
          <Field label="Bloc HTML (HTML, HuBL…)">
            <textarea className={`${input} ${mono} min-h-40`} value={b.html} onChange={(e) => set({ html: e.target.value })} />
          </Field>
          <RawFields html={b.html} p={p} />
          <ConvertRaw html={b.html} onConvert={(blocks) => p.commit(replaceNode(p.tree, b.id, blocks), blocks[0]?.id ?? null)} />
        </>
      )
    case 'section':
      return (
        <>
          <Field label="Nom (dans la Structure)">
            <input
              className={input}
              maxLength={40}
              placeholder="Ex. En-tête, Offre, Pied de page"
              value={b.name ?? ''}
              onChange={(e) => set({ name: e.target.value.replace(/[<>{}]/g, '') || undefined } as Partial<Block>)}
            />
          </Field>
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
          {b.columns === 2 && (
            <>
              <Segmented
                label="Proportion des colonnes"
                value={b.ratio ?? 50}
                onChange={(ratio) => set({ ratio: ratio === 50 ? undefined : ratio })}
                options={[
                  { value: 33, label: '1/3 · 2/3' },
                  { value: 50, label: '1/2 · 1/2' },
                  { value: 67, label: '2/3 · 1/3' },
                ]}
              />
              <RangeField label="Largeur de la 1re colonne" unit="%" value={b.ratio ?? 50} min={20} max={80} onChange={(ratio) => set({ ratio: ratio === 50 ? undefined : ratio })} />
            </>
          )}
          {b.columns > 1 && (
            <Segmented
              label="Alignement vertical"
              value={b.valign ?? 'top'}
              onChange={(valign) => set({ valign: valign === 'top' ? undefined : valign })}
              options={[
                { value: 'top', label: 'Haut' },
                { value: 'middle', label: 'Milieu' },
                { value: 'bottom', label: 'Bas' },
              ]}
            />
          )}
          <ColorField label="Fond" value={b.bg} onChange={(bg) => set({ bg })} />
          <Field label="Image de fond (facultatif)">
            <input className={`${input} ${mono}`} value={b.bgImage ?? ''} onChange={(e) => set({ bgImage: e.target.value.trim() || undefined })} placeholder="https://…" />
          </Field>
          {!b.bgImage && <ImageUpload compact onUploaded={(bgImage) => set({ bgImage })} />}
          {b.bgImage && <p className="-mt-2 text-xs text-mute">La couleur de fond reste affichée là où l'image ne l'est pas (Outlook, images bloquées) : choisis-la proche de l'image.</p>}
          {b.columns > 1 && (
            <OptRange label="Espace entre les colonnes" value={b.padX} base={b.padding} min={0} max={96} onChange={(padX) => set({ padX })} />
          )}
          <RangeField label="Arrondi" value={b.radius} min={0} max={40} onChange={(radius) => set({ radius })} />
          <RangeField label="Bordure" value={b.borderWidth ?? 0} min={0} max={8} onChange={(w) => set(w ? { borderWidth: w, borderColor: b.borderColor ?? '#e3e3ee' } : { borderWidth: undefined, borderColor: undefined })} />
          {!!b.borderWidth && <ColorField label="Couleur de la bordure" value={b.borderColor ?? '#e3e3ee'} onChange={(borderColor) => set({ borderColor })} />}
        </>
      )
  }
}

export function Inspector(p: Props) {
  const node = p.selectedId ? findNode(p.tree, p.selectedId) : null
  const [saving, setSaving] = useState<string | null>(null)

  if (!node) {
    const t = p.tree
    return (
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <h2 className="font-display font-semibold">Réglages du module</h2>
          <p className="text-xs text-mute">Touche ou clique un élément de l'aperçu (ou une section ci-dessous) pour le configurer.</p>
        </div>
        <Panel title="Contenu du module">
          <ModuleSummary tree={t} onSelect={(id) => p.onSelect(id)} />
        </Panel>
        <Panel title="Mise en page">
        <RangeField label="Largeur max" value={t.width} min={320} max={800} onChange={(width) => p.commit({ ...t, width })} />
        <ColorField label="Fond du module" value={t.bg} onChange={(bg) => p.commit({ ...t, bg })} />
        <RangeField label="Marge au-dessus et en dessous du module" value={t.pad ?? 24} min={0} max={80} onChange={(pad) => p.commit({ ...t, pad: pad === 24 ? undefined : pad })} />
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
        </Panel>
        <ConvertPanel tree={t} commit={(next) => p.commit(next)} onSelect={(id) => p.onSelect(id)} />
        {t.sections.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => setSaving((v) => (v === 'module' ? null : 'module'))}
              aria-expanded={saving === 'module'}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-violet/50 px-3 py-2 text-sm text-[#e3a6ff] hover:bg-violet/10"
            >
              <BookmarkPlus className="size-4" /> Enregistrer {t.sections.length > 1 ? `les ${t.sections.length} sections` : 'la section'} dans Mes blocs
            </button>
            {saving === 'module' && (
              <SaveToLibrary
                defaultName="Mon module"
                items={(base) => t.sections.map((sec, i) => ({ name: t.sections.length > 1 ? `${base} · section ${i + 1}` : base, section: sec }))}
              />
            )}
            <p className="text-xs text-mute">Chaque élément se sauvegarde aussi seul : sélectionne-le puis l'icône « Enregistrer dans Mes blocs ».</p>
          </div>
        )}
        <EstimatePanel tree={t} node={null} />
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
            {path.slice(0, -1).map((id, i) => {
              const anc = findNode(p.tree, id)
              const name = anc?.type === 'section' && anc.name ? anc.name : i === 0 ? `Section ${p.tree.sections.findIndex((x) => x.id === id) + 1}` : 'Card'
              return (
                <button type="button" key={id} onClick={() => p.onSelect(id)} className="max-w-[10rem] truncate hover:text-cyan">
                  {name} ›
                </button>
              )
            })}
          </nav>
        )}
        <div className="flex items-center gap-2">
          {isLogicBlock(node) ? <Braces className="size-4 text-[#e3a6ff]" /> : <Icon className="size-4 text-cyan" />}
          <h2 className="min-w-0 flex-1 font-display font-semibold">
            {isLogicBlock(node) ? 'Ligne de logique' : node.type === 'section' && path.length === 1 ? 'Section' : BLOCK_LABELS[node.type]}
            {node.type !== 'section' && 'field' in node && node.field?.label && <span className="block truncate font-sans text-xs font-normal text-mute">Champ « {node.field.label} »</span>}
          </h2>
          {[
            { icon: ArrowUp, label: 'Monter', fn: () => p.commit(moveNode(p.tree, node.id, -1)) },
            { icon: ArrowDown, label: 'Descendre', fn: () => p.commit(moveNode(p.tree, node.id, 1)) },
            { icon: Copy, label: 'Dupliquer', fn: () => p.commit(duplicateNode(p.tree, node.id)) },
            { icon: Trash2, label: 'Supprimer', fn: () => p.commit(removeNode(p.tree, node.id), null) },
            { icon: BookmarkPlus, label: 'Enregistrer dans Mes blocs', fn: () => setSaving((v) => (v === node.id ? null : node.id)) },
          ].map((a) => (
            <button key={a.label} title={a.label} aria-label={a.label} onClick={a.fn} className="rounded p-2 text-mute hover:bg-white/10 hover:text-white lg:p-1.5">
              <a.icon className="size-4 lg:size-3.5" />
            </button>
          ))}
        </div>
      </div>
      {saving === node.id && <SaveToLibrary key={`save-${node.id}`} items={[{ name: suggestName(node), section: wrapForLibrary(node) }]} defaultName={suggestName(node)} />}
      {!isLogicBlock(node) && <LogicContext id={node.id} p={p} />}
      <BlockFields key={node.id} b={node} set={set} p={p} />
      {(node.type === 'heading' || node.type === 'text' || node.type === 'button' || node.type === 'image') && (
        <Segmented
          label="Dans le module exporté"
          value={node.fixed ? 'fixed' : 'field'}
          onChange={(v) => set({ fixed: v === 'fixed' || undefined } as Partial<Block>)}
          options={[
            { value: 'field', label: 'Champ modifiable', title: 'Devient un champ du module HubSpot (fields.json)' },
            { value: 'fixed', label: 'Contenu fixe', title: 'Écrit tel quel dans module.html, sans champ' },
          ]}
        />
      )}
      <SpacingFields b={node} set={set} nested={path.length > 1} />
      {!isLogicBlock(node) && <EstimatePanel key={`est-${node.id}`} tree={p.tree} node={node} />}
    </div>
  )
}
