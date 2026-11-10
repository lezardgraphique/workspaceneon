import { useEffect, useMemo, useState } from 'react'
import { Check, Eye, Wand2 } from 'lucide-react'

import { describe, planConversion, total } from '@/lib/convert-plan'
import { htmlToBlocks } from '@/lib/hubl'
import { expandRaw } from '@/lib/tree'
import type { ModuleTree } from '@/lib/types'

// « Convertir en blocs » for the whole module: shows, before anything changes,
// what each « Bloc HTML » would become, lets the person pick which ones, then
// converts them in one step (undoable). Logic lines are never touched.
export function ConvertPanel({
  tree,
  commit,
  onSelect,
}: {
  tree: ModuleTree
  commit: (t: ModuleTree) => void
  onSelect: (id: string) => void
}) {
  // The conversion parses HTML with the browser: computed once the page runs
  // there (same first render on the server and in the browser).
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const plan = useMemo(() => (ready ? planConversion(tree, htmlToBlocks) : { items: [], logic: 0 }), [tree, ready])
  const candidates = plan.items.filter((i) => i.convertible)
  const stuck = plan.items.length - candidates.length
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set())
  const [done, setDone] = useState('')
  const chosen = candidates.filter((i) => !skipped.has(i.id))

  if (!candidates.length) {
    if (!plan.items.length && !done) return null
    return (
      <div className="rounded-lg border border-line p-3 text-xs text-mute">
        {done && (
          <p className="mb-1 flex items-center gap-1.5 font-semibold text-cyan">
            <Check className="size-4" /> {done}
          </p>
        )}
        {plan.items.length > 0 &&
          `${plan.items.length > 1 ? `Les ${plan.items.length} Blocs HTML restants` : 'Le Bloc HTML restant'} ne contien${plan.items.length > 1 ? 'nent' : 't'} rien que l'éditeur sache transformer : ${plan.items.length > 1 ? 'ils restent' : 'il reste'} en HTML, modifiable sur place dans l'aperçu.`}
      </div>
    )
  }

  const toggle = (id: string) =>
    setSkipped((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const run = () => {
    if (!chosen.length) return
    commit(expandRaw(tree, htmlToBlocks, new Set(chosen.map((i) => i.id))))
    setSkipped(new Set())
    setDone(`Converti : ${describe(total(chosen))}. « Annuler » revient en arrière.`)
  }

  return (
    <div className="space-y-3 rounded-lg border border-cyan/30 bg-cyan/5 p-3">
      <div>
        <p className="text-sm font-semibold">
          {candidates.length} Bloc{candidates.length > 1 ? 's' : ''} HTML à convertir en blocs
        </p>
        <p className="mt-1 text-xs text-mute">
          Converti, un code collé devient des titres, textes, boutons et images comme les autres : ils deviennent des champs
          modifiables sans toucher au code, les boutons reçoivent leur forme Outlook, et le test des messageries peut les vérifier un
          par un.
        </p>
      </div>
      {done && (
        <p role="status" className="flex items-center gap-1.5 text-xs font-semibold text-cyan">
          <Check className="size-4" /> {done}
        </p>
      )}
      <ul className="space-y-1.5">
        {candidates.map((it) => (
          <li key={it.id} className="flex items-start gap-2 rounded-md border border-line bg-void/60 p-2">
            <input
              type="checkbox"
              checked={!skipped.has(it.id)}
              onChange={() => toggle(it.id)}
              aria-label={`Convertir « ${it.excerpt} »`}
              className="mt-0.5 size-4 shrink-0 accent-[#00e5ff]"
            />
            <span className="min-w-0 flex-1 text-xs">
              <span className="block truncate text-white">{it.excerpt || 'Bloc HTML'}</span>
              <span className="block text-mute">→ {describe(it.makes)}</span>
            </span>
            <button
              type="button"
              onClick={() => onSelect(it.id)}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs text-cyan hover:bg-cyan/10"
            >
              <Eye className="size-3.5" /> Voir
            </button>
          </li>
        ))}
      </ul>
      {(stuck > 0 || plan.logic > 0) && (
        <p className="text-xs text-mute">
          {[
            stuck > 0 && `${stuck} Bloc${stuck > 1 ? 's' : ''} HTML sans élément reconnu reste${stuck > 1 ? 'nt' : ''} tel${stuck > 1 ? 's' : ''} quel${stuck > 1 ? 's' : ''}`,
            plan.logic > 0 && `${plan.logic} ligne${plan.logic > 1 ? 's' : ''} de logique ({% if %}, {% for %}…) ne ${plan.logic > 1 ? 'sont' : 'est'} jamais touchée${plan.logic > 1 ? 's' : ''}`,
          ]
            .filter(Boolean)
            .join(' ; ')}
          .
        </p>
      )}
      <button
        type="button"
        onClick={run}
        disabled={!chosen.length}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan px-3 py-2.5 text-sm font-semibold text-void hover:brightness-110 disabled:opacity-50 lg:py-2"
      >
        <Wand2 className="size-4" />
        {chosen.length === candidates.length ? 'Tout convertir' : `Convertir ${chosen.length} sur ${candidates.length}`} → {describe(total(chosen)) || 'rien'}
      </button>
    </div>
  )
}
