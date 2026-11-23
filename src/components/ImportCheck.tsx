import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Loader2, ScanSearch, Wrench } from 'lucide-react'

import { persistModule } from '@/lib/data'
import { isImported, scanImport } from '@/lib/import-scan'
import type { ImportScan } from '@/lib/import-scan'
import type { ModuleRecord } from '@/lib/types'

interface Row extends ImportScan {
  id: string
  name: string
}

// « Contrôler mes imports »: every imported module is checked against what the
// import does now. Fixable points are fixed on demand (the previous state stays
// in « Versions précédentes »); what the old import lost for good asks for a new
// import of the original files.
export function ImportCheck({ modules }: { modules: ModuleRecord[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const imported = modules.filter((m) => isImported(m.tree))
  if (!imported.length) return null

  const scan = () => {
    setScanning(true)
    setDone([])
    setError(null)
    // Let the button repaint before the (synchronous) check of every module.
    setTimeout(() => {
      const out: Row[] = []
      for (const m of imported) {
        try {
          const s = scanImport(m.tree)
          if (!s.skipped) out.push({ ...s, id: m.id, name: m.name })
        } catch {
          out.push({ id: m.id, name: m.name, skipped: false, fixes: [], reimport: ['contrôle impossible : ouvre le module pour le vérifier'] })
        }
      }
      setRows(out)
      setScanning(false)
    }, 30)
  }

  const fix = async (list: Row[]) => {
    setError(null)
    for (const r of list) {
      if (!r.fixed) continue
      setBusy(r.id)
      try {
        await persistModule(r.id, r.name, r.fixed)
        setDone((d) => [...d, r.id])
        setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, fixed: undefined } : x)) ?? null)
      } catch {
        setError(`« ${r.name} » n’a pas pu être corrigé. Réessaie.`)
      }
    }
    setBusy(null)
    await router.invalidate()
  }

  const problems = rows?.filter((r) => r.fixed || r.reimport.length) ?? []
  const fixable = problems.filter((r) => r.fixed)
  const okCount = (rows?.length ?? 0) - problems.length

  return (
    <section className="mt-6 rounded-xl border border-line bg-night/70 p-5" aria-labelledby="import-check-title">
      <div className="flex items-start gap-3">
        <ScanSearch className="mt-0.5 size-5 shrink-0 text-violet" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="import-check-title" className="font-display text-lg font-semibold">
            Contrôle des modules importés
          </h2>
          <p className="mt-1 text-sm text-mute">
            L’import a été amélioré (modules HubSpot gardés tels quels, types de champs mieux reconnus). {imported.length > 1 ? `Vérifie tes ${imported.length} modules importés` : 'Vérifie ton module importé'} : ce qui peut l’être est corrigé, le reste t’indique quoi réimporter. Chaque correction reste annulable dans « Versions précédentes ».
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={scan}
              disabled={scanning || !!busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan/60 px-3 py-1.5 text-sm text-cyan hover:bg-cyan/10 disabled:opacity-50"
            >
              {scanning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ScanSearch className="size-4" aria-hidden />} {rows ? 'Contrôler à nouveau' : 'Contrôler mes imports'}
            </button>
            {fixable.length > 1 && (
              <button
                type="button"
                onClick={() => void fix(fixable)}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-cyan px-3 py-1.5 text-sm font-semibold text-void disabled:opacity-50"
              >
                <Wrench className="size-4" aria-hidden /> Tout corriger ({fixable.length})
              </button>
            )}
          </div>
          {rows && (
            <p role="status" className="mt-3 text-sm text-cyan">
              {okCount} à jour{problems.length ? ` · ${problems.length} à revoir` : ' : rien à corriger'}
              {done.length > 0 && ` · ${done.length} corrigé${done.length > 1 ? 's' : ''}`}
            </p>
          )}
          {problems.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded-md border border-line text-sm">
              {problems.map((r) => (
                <li key={r.id} className="space-y-1.5 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/editor/$moduleId" params={{ moduleId: r.id }} className="min-w-0 flex-1 truncate text-white hover:underline">
                      {r.name}
                    </Link>
                    {r.fixed && (
                      <button
                        type="button"
                        onClick={() => void fix([r])}
                        disabled={!!busy}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-cyan/50 px-2.5 py-1 text-xs text-cyan hover:bg-cyan/10 disabled:opacity-50"
                      >
                        {busy === r.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Wrench className="size-3.5" aria-hidden />} Corriger
                        <span className="sr-only"> {r.name}</span>
                      </button>
                    )}
                    {r.reimport.length > 0 && (
                      <Link
                        to="/editor/$moduleId"
                        params={{ moduleId: r.id }}
                        search={{ importer: 1 }}
                        className="inline-flex shrink-0 items-center rounded-md border border-[#ffb36b]/60 px-2.5 py-1 text-xs text-[#ffb36b] hover:bg-[#ffb36b]/10"
                      >
                        Réimporter<span className="sr-only"> {r.name}</span>
                      </Link>
                    )}
                  </div>
                  {done.includes(r.id) && <p className="text-xs text-cyan">Corrigé.</p>}
                  {r.fixed && r.fixes.length > 0 && (
                    <ul className="list-disc pl-5 text-xs text-[#d9d9ec]">
                      {r.fixes.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  )}
                  {r.reimport.length > 0 && (
                    <ul className="list-disc pl-5 text-xs text-[#ffb36b]">
                      {r.reimport.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  )}
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
