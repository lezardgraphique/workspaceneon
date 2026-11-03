import { useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Download, HardDriveDownload, Upload } from 'lucide-react'

import { downloadBackup, importBackup } from '@/lib/backup'
import { useDataStatus } from '@/lib/data'
import { refreshCustomBlocks } from '@/components/editor/useCustomBlocks'

// Portable copy of the whole account: one JSON file to keep, move or restore.
export function BackupPanel() {
  const router = useRouter()
  const st = useDataStatus()
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    setMsg(null)
    try {
      setMsg({ ok: true, text: await fn() })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Opération impossible.' })
    } finally {
      setBusy(false)
    }
  }
  const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`

  return (
    <section className="mt-12 rounded-xl border border-line bg-night/70 p-5" aria-labelledby="backup-title">
      <div className="flex items-start gap-3">
        <HardDriveDownload className="mt-0.5 size-5 shrink-0 text-cyan" />
        <div className="min-w-0 flex-1">
          <h2 id="backup-title" className="font-display text-lg font-semibold">
            Hors ligne et base portable
          </h2>
          <p className="mt-1 text-sm text-mute">
            L'application garde une copie de tes modules sur cet appareil : tu peux l'ouvrir et travailler sans connexion, tout est envoyé au retour du réseau.
            Pour aller plus loin, exporte toute ta base (modules et blocs perso) dans un fichier, et réimporte-le sur un autre compte ou un autre ordinateur.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              disabled={busy}
              onClick={() => run(async () => { const r = await downloadBackup(); return `Fichier exporté : ${plural(r.modules, 'module')} et ${plural(r.blocks, 'bloc')}.` })}
              className="inline-flex items-center gap-2 rounded-md border border-cyan/60 px-3 py-2 text-sm font-semibold text-cyan hover:bg-cyan/10 disabled:opacity-60"
            >
              <Download className="size-4" /> Exporter ma base
            </button>
            <button
              disabled={busy}
              onClick={() => file.current?.click()}
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-mute hover:border-pink hover:text-white disabled:opacity-60"
            >
              <Upload className="size-4" /> Importer une base
            </button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Choisir un fichier de sauvegarde"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                void run(async () => {
                  const r = await importBackup(f)
                  await router.invalidate()
                  refreshCustomBlocks()
                  return `Import terminé : ${plural(r.modules, 'module')} et ${plural(r.blocks, 'bloc')} ajoutés${r.skipped ? `, ${plural(r.skipped, 'doublon')} ignoré${r.skipped > 1 ? 's' : ''}` : ''}.`
                })
              }}
            />
            <span className="text-xs text-mute">
              {st.online ? (st.pending ? `${plural(st.pending, 'modification')} à envoyer` : 'Tout est synchronisé') : 'Hors ligne : les modifications restent sur cet appareil'}
            </span>
          </div>
          {msg && (
            <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-cyan' : 'text-pink'}`}>
              {msg.text}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
