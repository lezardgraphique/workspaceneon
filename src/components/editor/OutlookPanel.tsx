import { Field, RangeField } from './Inspector'
import { findPath } from '@/lib/tree'
import type { Block, ButtonBlock, ModuleTree, OutlookTweaks } from '@/lib/types'
import { buttonWidth } from '@/lib/vml'

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

// The same change on every button of the module (nested cards included).
export function patchAllButtons(tree: ModuleTree, patch: Partial<ButtonBlock>): ModuleTree {
  const walk = (b: Block): Block =>
    b.type === 'button' ? ({ ...b, ...patch } as Block) : b.type === 'section' ? { ...b, cells: b.cells.map((c) => c.map(walk)) } : b
  return { ...tree, sections: tree.sections.map((s) => walk(s) as typeof s) }
}

export const countButtons = (tree: ModuleTree, pred: (b: ButtonBlock) => boolean = () => true): number => {
  let n = 0
  const walk = (b: Block) => {
    if (b.type === 'button' && pred(b)) n++
    if (b.type === 'section') b.cells.forEach((c) => c.forEach(walk))
  }
  tree.sections.forEach(walk)
  return n
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
export function OutlookPanel({ tree, node, onChange, onTree }: { tree: ModuleTree; node: Block; onChange: (patch: Partial<Block>) => void; onTree: (t: ModuleTree) => void }) {
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
      {node.type === 'button' && <ButtonOutlook tree={tree} b={node} onChange={onChange} onTree={onTree} />}
      {reset && (
        <button onClick={() => onChange({ outlook: undefined } as Partial<Block>)} className="text-xs text-mute underline hover:text-white">
          Tout remettre comme dans les autres messageries
        </button>
      )}
    </div>
  )
}

// What Outlook can show of a button without VML: highlighted text (default), or a
// coloured box with padding and a set width (ghost table cell, square corners).
function ButtonOutlook({ tree, b, onChange, onTree }: { tree: ModuleTree; b: ButtonBlock; onChange: (patch: Partial<Block>) => void; onTree: (t: ModuleTree) => void }) {
  const cell = !!b.msoCell
  const total = countButtons(tree)
  const others = countButtons(tree, (x) => x.id !== b.id && !!x.msoCell !== cell)
  const auto = buttonWidth(b.label, b)
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <Field label="Bouton dans Outlook sans VML">
        <div role="group" aria-label="Bouton dans Outlook sans VML" className="flex rounded-md border border-line p-0.5 text-xs">
          {([[false, 'Texte surligné'], [true, 'Bloc coloré']] as const).map(([v, l]) => (
            <button key={l} aria-pressed={cell === v} onClick={() => onChange({ msoCell: v || undefined } as Partial<Block>)} className={`flex-1 rounded px-2 py-1 ${cell === v ? 'bg-violet/20 text-white' : 'text-mute hover:text-white'}`}>
              {l}
            </button>
          ))}
        </div>
      </Field>
      <p className="text-xs text-mute">
        {cell
          ? 'Outlook affiche un bloc de la couleur du bouton, avec ses marges et la largeur choisie (coins carrés, seul le texte est cliquable).'
          : 'Outlook ignore les marges d\u2019un lien : sans VML, le bouton n\u2019y est qu\u2019un texte surligné.'}
        {tree.vml && ' Le VML est actif : c\u2019est son dessin qu\u2019Outlook affiche, ce réglage sert si tu le désactives.'}
      </p>
      {(cell || tree.vml) && (
        <OverrideField label="Largeur dans Outlook" value={b.vmlWidth} base={auto} min={80} max={400} onChange={(v) => onChange({ vmlWidth: v } as Partial<Block>)} />
      )}
      {total > 1 && others > 0 && (
        <button onClick={() => onTree(patchAllButtons(tree, { msoCell: cell || undefined }))} className="text-xs text-cyan underline hover:text-white">
          Appliquer « {cell ? 'Bloc coloré' : 'Texte surligné'} » aux {total} boutons du module
        </button>
      )}
    </div>
  )
}
