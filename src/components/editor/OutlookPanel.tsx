import { Field, RangeField } from './Inspector'
import { findPath } from '@/lib/tree'
import type { Block, ModuleTree, OutlookTweaks } from '@/lib/types'

type Key = keyof OutlookTweaks

// What Outlook shows when nothing is adjusted: the value the element already has.
export function olBase(tree: ModuleTree, b: Block, k: Key): number {
  switch (k) {
    case 'mt':
      return b.type === 'divider' ? 16 : 0
    case 'mb':
      return b.type === 'divider' ? 16 : b.type === 'section' ? (findPath(tree, b.id).length > 1 ? 12 : 0) : b.type === 'spacer' ? 0 : 12
    case 'lh':
      return b.type === 'heading' ? Math.round(b.size * 1.25) : b.type === 'text' ? Math.round(b.size * 1.6) : 20
    case 'h':
      return b.type === 'spacer' ? b.height : 0
    case 'w':
      return b.type === 'image' ? Math.round((tree.width * b.width) / 100) : 0
    case 'pad':
      return b.type === 'section' ? b.padding : 0
  }
}

export const olPatch = (b: Block, k: Key, v: number | undefined): Partial<Block> => {
  const next = { ...(b as { outlook?: OutlookTweaks }).outlook, [k]: v } as OutlookTweaks
  if (v == null) delete next[k]
  return { outlook: Object.keys(next).length ? next : undefined } as Partial<Block>
}

// A slider that follows the normal value until it is moved: then the value is Outlook's own.
function OverrideField({ label, value, base, min, max, onChange }: { label: string; value: number | undefined; base: number; min: number; max: number; onChange: (v: number | undefined) => void }) {
  const set = value != null
  return (
    <div>
      <RangeField label={`${label}${set ? '' : ' (auto)'}`} value={value ?? base} min={min} max={Math.max(max, base)} onChange={onChange} />
      {set && (
        <button onClick={() => onChange(undefined)} className="-mt-1 text-xs text-mute underline hover:text-white">
          Revenir à la valeur normale ({base}px)
        </button>
      )}
    </div>
  )
}

// Adjustments that only Outlook for Windows reads (written as mso-* properties):
// the other messageries keep the element as it is.
export function OutlookPanel({ tree, node, onChange }: { tree: ModuleTree; node: Block; onChange: (patch: Partial<Block>) => void }) {
  if (node.type === 'raw') return <p className="p-3 text-sm text-mute">Le code libre n'a pas de réglage Outlook : modifie son code directement.</p>
  const o: OutlookTweaks = (node as { outlook?: OutlookTweaks }).outlook ?? {}
  const f = (k: Key, label: string, min: number, max: number) => (
    <OverrideField key={k} label={label} value={o[k]} base={olBase(tree, node, k)} min={min} max={max} onChange={(v) => onChange(olPatch(node, k, v))} />
  )
  const reset = Object.keys(o).length > 0
  return (
    <div className="space-y-3 p-3">
      <p className="text-xs text-mute">
        Réglages pris en compte uniquement par Outlook sur Windows (2016–2021) : les autres messageries gardent le rendu normal. Tu peux aussi tirer les poignées roses dans l'aperçu Outlook.
      </p>
      {node.type === 'spacer' && f('h', 'Hauteur', 0, 120)}
      {(node.type === 'heading' || node.type === 'text') && f('lh', 'Interligne', 10, 80)}
      {node.type === 'image' && f('w', 'Largeur', 40, Math.max(tree.width, 200))}
      {node.type === 'section' && f('pad', 'Marges intérieures', 0, 80)}
      {node.type !== 'spacer' && f('mt', 'Marge au-dessus', 0, 80)}
      {f('mb', 'Marge en dessous', 0, 80)}
      {node.type === 'button' && (
        <Field label="Largeur du bouton">
          <p className="text-xs text-mute">Réglée dans l'onglet Édition (« Largeur dans Outlook »), ou en tirant le bord droit du bouton avec le VML actif.</p>
        </Field>
      )}
      {reset && (
        <button onClick={() => onChange({ outlook: undefined } as Partial<Block>)} className="text-xs text-mute underline hover:text-white">
          Tout remettre comme dans les autres messageries
        </button>
      )}
    </div>
  )
}
