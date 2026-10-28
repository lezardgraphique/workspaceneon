import { useEffect, useRef } from 'react'
import { Braces, ImageIcon, RotateCcw } from 'lucide-react'

import { ImageUpload } from './ImageUpload'
import { BLOCK_ICONS } from './Structure'
import { FIELD_KIND, collectFields } from '@/lib/fields'
import type { FieldBlock, ModuleField } from '@/lib/fields'
import { updateNode } from '@/lib/tree'
import type { Block, ModuleTree } from '@/lib/types'

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
      {fields.length === 0 && (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-mute">
          Aucun champ pour l'instant. Ajoute un titre, un texte, un bouton ou une image depuis la structure.
        </p>
      )}
    </div>
  )
}
