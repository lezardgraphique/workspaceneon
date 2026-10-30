import { useCallback, useEffect, useRef, useState } from 'react'
import { guard } from '@/lib/session-guard'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Check, Copy, Download, FileText, FolderOpen, Loader2, Trash2, Upload } from 'lucide-react'

import { AccountMenu } from '@/components/AccountMenu'
import { NeonLogo } from '@/components/Maily'
import { FILE_TYPES, MAX_FILE_BYTES, PAGE_SIZE, formatSize, isImageType } from '@/lib/files'
import type { FileList, StoredFile } from '@/lib/files'

export const Route = createFileRoute('/fichiers')({
  head: () => ({ meta: [{ title: 'Fichiers · Neon Sandbox Pro' }] }),
  component: FilesPage,
})

const ACCEPT = Object.keys(FILE_TYPES)
  .map((e) => `.${e}`)
  .join(',')

function FilesPage() {
  const [files, setFiles] = useState<StoredFile[]>([])
  const [total, setTotal] = useState(0)
  const [usage, setUsage] = useState({ bytes: 0, quota: 1 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async (offset = 0) => {
    setLoading(true)
    try {
      const res = guard(await fetch(`/api/files?offset=${offset}&limit=${PAGE_SIZE}`))
      if (!res.ok) throw new Error()
      const data: FileList = await res.json()
      setFiles((prev) => (offset ? [...prev, ...data.files] : data.files))
      setTotal(data.total)
      setUsage(data.usage)
    } catch {
      setErrors(['Impossible de charger les fichiers.'])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const upload = async (list: File[]) => {
    const picked = list
    if (!picked.length) return
    setErrors([])
    const failed: string[] = []
    for (const [i, file] of picked.entries()) {
      setBusy(`Envoi ${i + 1}/${picked.length} · ${file.name}`)
      if (file.size > MAX_FILE_BYTES) {
        failed.push(`${file.name} : trop lourd (10 Mo maximum)`)
        continue
      }
      const form = new FormData()
      form.set('file', file)
      const res = await fetch('/api/files', { method: 'POST', body: form }).then(guard).catch(() => null)
      if (!res?.ok) failed.push(`${file.name} : ${(await res?.json().catch(() => null))?.error ?? 'échec de l\'envoi'}`)
    }
    setBusy(null)
    setErrors(failed)
    await load()
  }

  const remove = async (f: StoredFile) => {
    setConfirm(null)
    setFiles((prev) => prev.filter((x) => x.key !== f.key))
    setTotal((t) => t - 1)
    await fetch(`/api/files/${f.key}`, { method: 'DELETE' }).then(guard).catch(() => {})
    void load()
  }

  const copy = async (f: StoredFile) => {
    await navigator.clipboard.writeText(f.url).catch(() => {})
    setCopied(f.key)
    setTimeout(() => setCopied((c) => (c === f.key ? null : c)), 1800)
  }

  const pct = Math.min(100, Math.round((usage.bytes / usage.quota) * 100))

  return (
    <div className="min-h-screen neon-grid">
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-5">
        <Link to="/" className="flex items-center gap-3" aria-label="Retour à Mes modules">
          <NeonLogo size={30} />
          <span className="font-display text-lg font-semibold tracking-wide">
            Neon Sandbox <span className="text-pink">Pro</span>
          </span>
        </Link>
        <Link to="/" className="ml-auto text-sm text-mute hover:text-white">
          ← Mes modules
        </Link>
        <AccountMenu />
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-20">
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold">
              <FolderOpen className="mr-2 inline size-7 text-cyan" />
              Fichiers
            </h1>
            <p className="mt-1 text-sm text-mute">Images, PDF, documents : stocke-les ici et copie leur lien pour tes modules.</p>
          </div>
          <div className="ml-auto w-full max-w-xs text-xs text-mute">
            <div className="mb-1 flex justify-between">
              <span>
                {total} fichier{total > 1 ? 's' : ''}
              </span>
              <span>
                {formatSize(usage.bytes)} / {formatSize(usage.quota)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Espace utilisé">
              <div className={`h-full ${pct > 90 ? 'bg-pink' : 'bg-cyan'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            void upload(Array.from(e.dataTransfer.files))
          }}
          className={`mb-6 flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${over ? 'border-cyan bg-cyan/5' : 'border-line'}`}
        >
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          {busy ? (
            <p className="flex items-center gap-2 text-sm text-cyan">
              <Loader2 className="size-4 animate-spin" /> {busy}
            </p>
          ) : (
            <>
              <Upload className="size-6 text-cyan" />
              <p className="text-sm">Glisse tes fichiers ici ou</p>
              <button onClick={() => input.current?.click()} className="glow-pink rounded-md bg-pink px-4 py-2 text-sm font-semibold text-white">
                Choisir des fichiers
              </button>
              <p className="text-xs text-mute">10 Mo maximum par fichier · JPG, PNG, GIF, WebP, PDF, TXT, CSV, JSON, HTML, CSS, ZIP, DOCX, XLSX, PPTX</p>
            </>
          )}
        </div>

        {errors.length > 0 && (
          <ul role="alert" className="mb-6 space-y-1 rounded-lg border border-pink/50 bg-pink/10 p-3 text-sm text-pink">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        {files.length === 0 && !loading ? (
          <p className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-mute">Aucun fichier pour l'instant.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {files.map((f) => (
              <li key={f.key} className="overflow-hidden rounded-xl border border-line bg-night">
                <a href={f.url} target="_blank" rel="noreferrer" className="flex h-36 items-center justify-center bg-void" aria-label={`Ouvrir ${f.name}`}>
                  {isImageType(f.type) ? (
                    <img src={f.url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-mute">
                      <FileText className="size-9 text-cyan" />
                      <span className="font-mono text-xs uppercase">{f.key.split('.').pop()}</span>
                    </span>
                  )}
                </a>
                <div className="px-3 pt-2">
                  <p className="truncate text-sm font-medium" title={f.name}>
                    {f.name}
                  </p>
                  <p className="text-xs text-mute">
                    {formatSize(f.size)} · {new Date(f.uploadedAt).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <div className="flex items-center gap-1 p-2">
                  <button onClick={() => copy(f)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-xs hover:border-cyan">
                    {copied === f.key ? <Check className="size-3.5 text-cyan" /> : <Copy className="size-3.5" />} {copied === f.key ? 'Lien copié' : 'Copier le lien'}
                  </button>
                  <a href={f.url} download={f.name} aria-label={`Télécharger ${f.name}`} className="rounded-md border border-line p-1.5 text-mute hover:border-cyan hover:text-white">
                    <Download className="size-3.5" />
                  </a>
                  {confirm === f.key ? (
                    <button onClick={() => remove(f)} className="rounded-md bg-pink px-2 py-1.5 text-xs font-semibold text-white">
                      Confirmer
                    </button>
                  ) : (
                    <button onClick={() => setConfirm(f.key)} aria-label={`Supprimer ${f.name}`} className="rounded-md border border-line p-1.5 text-mute hover:border-pink hover:text-pink">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {loading && (
          <p className="mt-6 flex justify-center">
            <Loader2 className="size-5 animate-spin text-cyan" />
          </p>
        )}
        {!loading && files.length < total && (
          <div className="mt-6 text-center">
            <button onClick={() => load(files.length)} className="rounded-md border border-line px-4 py-2 text-sm hover:border-cyan">
              Charger plus ({total - files.length})
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
