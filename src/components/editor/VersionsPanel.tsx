import { useState } from 'react'
import { History, Loader2, RotateCcw } from 'lucide-react'

import { listVersions, versionForRestore, type VersionInfo } from '@/server/versions.functions'
import type { ModuleTree } from '@/lib/types'

// Earlier versions kept by the server (every 10 minutes of editing, before a
// restore, at deletion; 30 per module, 30 days). Restoring applies the version
// like any change: undoable and saved by the autosave, and the module as it was
// is copied first, so nothing is ever lost by a restore either.
const REASONS: Record<string, string> = {
  auto: 'Copie automatique',
  'avant-restauration': 'Avant une restauration',
  suppression: 'Avant suppression',
  ia: 'Avant une modification par une IA connectée',
}

const when = (iso: string) => {
  const d = new Date(iso)
  const min = Math.round((Date.now() - d.getTime()) / 60_000)
  const rel = min < 1 ? 'à l’instant' : min < 60 ? `il y a ${min} min` : min < 24 * 60 ? `il y a ${Math.round(min / 60)} h` : `il y a ${Math.round(min / 1440)} j`
  return `${d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${rel}`
}

export function VersionsPanel({ moduleId, onRestore }: { moduleId: string; onRestore: (name: string, tree: ModuleTree) => void }) {
  const [list, setList] = useState<VersionInfo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setBusy('list')
    setError(null)
    try {
      setList(await listVersions({ data: { moduleId } }))
    } catch {
      setError(navigator.onLine ? 'Les versions n’ont pas pu être chargées. Réessaie dans un instant.' : 'Les versions sont sur ton compte : reconnecte-toi à Internet pour les voir.')
    } finally {
      setBusy(null)
    }
  }

  const restore = async (v: VersionInfo) => {
    setBusy(v.id)
    setError(null)
    try {
      const got = await versionForRestore({ data: { id: v.id } })
      onRestore(got.name, got.tree)
      setConfirm(null)
      await load()
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'La restauration a échoué. Réessaie.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <p className="text-mute">
        En plus de la sauvegarde automatique, ton compte garde une copie du module toutes les 10 minutes de travail, avant chaque restauration et à sa suppression (30 copies, 30 jours).
      </p>
      {list === null ? (
        <button type="button" onClick={load} disabled={busy === 'list'} className="inline-flex items-center gap-1.5 rounded border border-cyan/50 px-2.5 py-1.5 text-cyan hover:bg-cyan/10">
          {busy === 'list' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <History className="size-3.5" aria-hidden />} Voir les versions
        </button>
      ) : list.length === 0 ? (
        <p className="text-[#d6d6ea]">Pas encore de version précédente : la première copie est faite à la prochaine modification après 10 minutes.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {list.map((v) => (
            <li key={v.id} className="px-2.5 py-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[#d9d9ec]">{when(v.createdAt)}</p>
                  <p className="truncate text-mute">
                    {REASONS[v.reason] ?? v.reason} · {v.name} · {v.sections} section{v.sections > 1 ? 's' : ''}
                  </p>
                </div>
                {confirm !== v.id && (
                  <button type="button" onClick={() => setConfirm(v.id)} className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1 text-mute hover:border-cyan hover:text-white">
                    <RotateCcw className="size-3" aria-hidden /> Restaurer
                  </button>
                )}
              </div>
              {confirm === v.id && (
                <div className="mt-2 rounded border border-cyan/40 bg-cyan/5 p-2">
                  <p className="text-[#d6d6ea]">Le module est remplacé par cette version. La version actuelle est copiée avant, et « Annuler » revient en arrière.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => restore(v)} disabled={!!busy} className="inline-flex items-center gap-1 rounded border border-cyan bg-cyan/10 px-2 py-1 text-cyan">
                      {busy === v.id && <Loader2 className="size-3 animate-spin" aria-hidden />} Restaurer cette version
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} className="rounded border border-line px-2 py-1 text-mute hover:text-white">
                      Garder l’actuelle
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-pink">
          {error}
        </p>
      )}
    </div>
  )
}
