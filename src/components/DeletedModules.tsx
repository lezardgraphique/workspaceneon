import { useEffect, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { ArchiveRestore, Loader2 } from 'lucide-react'

import { listDeleted, restoreDeleted, type DeletedInfo } from '@/server/versions.functions'

// Modules deleted in the last 30 days, kept by the account (module_versions):
// brought back with the same address, as they were when deleted. Hidden when
// there are none or when offline.
export function DeletedModules() {
  const router = useRouter()
  const [list, setList] = useState<DeletedInfo[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!navigator.onLine) return
    listDeleted()
      .then(setList)
      .catch(() => {})
  }, [])

  if (!list.length && !done) return null

  const restore = async (d: DeletedInfo) => {
    setBusy(d.moduleId)
    setError(null)
    try {
      await restoreDeleted({ data: { moduleId: d.moduleId } })
      setList((l) => l.filter((x) => x.moduleId !== d.moduleId))
      setDone({ id: d.moduleId, name: d.name })
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Le module n’a pas pu être récupéré. Réessaie.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-line bg-night/70 p-5" aria-labelledby="deleted-title">
      <div className="flex items-start gap-3">
        <ArchiveRestore className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="deleted-title" className="font-display text-lg font-semibold">
            Modules supprimés récemment
          </h2>
          <p className="mt-1 text-sm text-mute">Ton compte garde les modules supprimés pendant 30 jours : tu peux les récupérer tels qu’ils étaient.</p>
          {done && (
            <p role="status" className="mt-3 text-sm text-cyan">
              « {done.name} » est de retour.{' '}
              <Link to="/editor/$moduleId" params={{ moduleId: done.id }} className="underline">
                L’ouvrir
              </Link>
            </p>
          )}
          {list.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded-md border border-line text-sm">
              {list.map((d) => (
                <li key={d.moduleId} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-white">{d.name}</span>
                    <span className="block text-xs text-mute">Supprimé le {new Date(d.deletedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => restore(d)}
                    disabled={!!busy}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-cyan/50 px-2.5 py-1.5 text-cyan hover:bg-cyan/10"
                  >
                    {busy === d.moduleId && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Récupérer
                    <span className="sr-only"> {d.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-pink">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
