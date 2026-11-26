import { useEffect, useState } from 'react'
import { Brain, Check, Loader2, Palette, Sparkles, Trash2 } from 'lucide-react'

import { BRAND_FIELDS, BRAND_KEY, MAX_MEMORIES, MAX_MEMORY_CHARS, MEMORIES_KEY, emptyBrand, hasBrand, parseBrand, parseMemories, storeMemories } from '@/lib/brand'
import type { BrandProfile, Memory } from '@/lib/brand'
import { guardedFetch } from '@/lib/session-guard'
import { SETTINGS_EVENT, getPref, setPref } from '@/lib/settings-sync'

const field =
  'w-full rounded-md border border-line bg-void px-3 py-2.5 text-base text-white placeholder:text-mute focus:border-cyan focus:outline-none lg:text-sm'

/** Value of a synced preference, kept up to date when another device changes it. */
function useSynced(key: string): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(null)
  useEffect(() => {
    const read = () => setValue(getPref(key))
    read()
    window.addEventListener(SETTINGS_EVENT, read)
    return () => window.removeEventListener(SETTINGS_EVENT, read)
  }, [key])
  return [
    value,
    (v) => {
      setPref(key, v)
      setValue(v)
    },
  ]
}

// « Ma marque »: the brand profile Maily applies to what she writes (prompt of
// /api/maily and of the « Réécrire avec Maily » rewrites).
export function BrandPanel() {
  const [stored, store] = useSynced(BRAND_KEY)
  const [draft, setDraft] = useState<BrandProfile>(emptyBrand)
  const [saved, setSaved] = useState(false)
  const [sample, setSample] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drafted, setDrafted] = useState(false)

  useEffect(() => setDraft(parseBrand(stored ?? '')), [stored])

  const save = () => {
    const clean = parseBrand(draft)
    store(hasBrand(clean) ? JSON.stringify(clean) : null)
    setSaved(true)
    setDrafted(false)
    setTimeout(() => setSaved(false), 2500)
  }

  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await guardedFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'brand', sample: sample.slice(0, 30_000), current: JSON.stringify(parseBrand(draft)) }),
      })
      const data = await res.json()
      if (!res.ok || !data.brand) throw new Error(data.error ?? 'Erreur')
      setDraft(parseBrand(data.brand))
      setDrafted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  const changed = JSON.stringify(parseBrand(draft)) !== JSON.stringify(parseBrand(stored ?? ''))

  return (
    <section aria-labelledby="marque-titre" className="mt-6 space-y-4 rounded-xl border border-line bg-panel/80 p-6">
      <h2 id="marque-titre" className="flex items-center gap-2 font-display text-lg font-semibold">
        <Palette className="size-5 text-cyan" /> Ma marque
      </h2>
      <p className="text-sm text-mute">
        Le ton, les mots et les mentions de ta marque. Maily les applique à tout ce qu’elle écrit ou réécrit, et à ses nouveaux modules (couleurs, polices). Chaque
        case est facultative.
      </p>

      <details className="rounded-md border border-line p-3" open={!hasBrand(parseBrand(stored ?? ''))}>
        <summary className="cursor-pointer text-sm font-semibold text-white">Remplir à partir de tes textes</summary>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-mute">Colle un ou plusieurs e-mails, une newsletter ou une page écrite dans le style de ta marque</span>
          <textarea value={sample} onChange={(e) => setSample(e.target.value)} maxLength={30_000} rows={5} className={`${field} min-h-28`} />
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={busy || sample.trim().length < 40}
          className="mt-2 inline-flex items-center gap-2 rounded-md border border-violet/60 px-3 py-2 text-sm text-[#e3a6ff] hover:bg-violet/10 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Proposer mon identité de marque
        </button>
        {sample.trim().length > 0 && sample.trim().length < 40 && <p className="mt-1 text-xs text-mute">Colle au moins quelques phrases.</p>}
        {error && (
          <p role="alert" className="mt-2 text-sm text-pink">
            {error}
          </p>
        )}
        {drafted && (
          <p role="status" className="mt-2 text-sm text-cyan">
            Proposition remplie ci-dessous : relis-la, corrige-la si besoin, puis enregistre.
          </p>
        )}
      </details>

      {BRAND_FIELDS.map((f) => (
        <label key={f.key} className="block text-sm">
          <span className="mb-1 block text-mute">{f.label}</span>
          {f.long ? (
            <textarea value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} maxLength={f.max} rows={2} placeholder={f.hint} className={field} />
          ) : (
            <input value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} maxLength={f.max} placeholder={f.hint} className={field} />
          )}
        </label>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={!changed} className="inline-flex items-center gap-2 rounded-md bg-pink-fill px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60">
          Enregistrer ma marque
        </button>
        {hasBrand(parseBrand(stored ?? '')) && (
          <button
            type="button"
            onClick={() => {
              if (!confirm('Effacer ton identité de marque ? Maily écrira de nouveau sans elle.')) return
              store(null)
            }}
            className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2.5 text-sm text-mute hover:text-white"
          >
            <Trash2 className="size-4" /> Effacer
          </button>
        )}
        {saved && (
          <span role="status" className="flex items-center gap-1 text-sm text-cyan">
            <Check className="size-4" /> Enregistrée sur ton compte
          </span>
        )}
      </div>
    </section>
  )
}

// « Mémoires de Maily »: what the user asked her to remember (« Retiens que… »
// in the chat, or added here). Sent with each request; deleted here or with
// « Oublie… ».
export function MemoriesPanel() {
  const [stored, store] = useSynced(MEMORIES_KEY)
  const list = parseMemories(stored ?? '')
  const [text, setText] = useState('')

  const save = (next: Memory[]) => store(next.length ? storeMemories(next) : null)
  const add = () => {
    const t = text.trim().slice(0, MAX_MEMORY_CHARS)
    if (!t) return
    save([...list, { id: Math.random().toString(36).slice(2, 10), text: t, t: Date.now() }])
    setText('')
  }

  return (
    <section aria-labelledby="memoires-titre" className="mt-6 space-y-4 rounded-xl border border-line bg-panel/80 p-6">
      <h2 id="memoires-titre" className="flex items-center gap-2 font-display text-lg font-semibold">
        <Brain className="size-5 text-cyan" /> Mémoires de Maily
      </h2>
      <p className="text-sm text-mute">
        Ce que Maily retient pour toutes tes conversations, sur tous tes appareils. Dans son chat, écris « Retiens que… » pour en ajouter, « Oublie… » pour en retirer, ou
        « Qu’est-ce que tu retiens ? ».
      </p>
      {list.length ? (
        <ul className="space-y-2">
          {list.map((m) => (
            <li key={m.id} className="flex items-start gap-2 rounded-md border border-line bg-void px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words">{m.text}</span>
              <button type="button" onClick={() => save(list.filter((x) => x.id !== m.id))} className="shrink-0 rounded p-1 text-mute hover:text-pink">
                <Trash2 className="size-4" aria-hidden />
                <span className="sr-only">Oublier « {m.text} »</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-mute">Aucune mémoire pour l’instant.</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
        className="flex gap-2"
      >
        <label className="min-w-0 flex-1 text-sm">
          <span className="sr-only">Nouvelle mémoire</span>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_MEMORY_CHARS} placeholder="Ex. Ma newsletter s’appelle « Le Mag’ IT »" className={field} />
        </label>
        <button type="submit" disabled={!text.trim() || list.length >= MAX_MEMORIES} className="shrink-0 rounded-md border border-cyan/60 px-3 py-2 text-sm text-cyan hover:bg-cyan/10 disabled:opacity-50">
          Ajouter
        </button>
      </form>
      {list.length >= MAX_MEMORIES && <p className="text-xs text-mute">{MAX_MEMORIES} mémoires au plus : retire-en une pour en ajouter.</p>}
    </section>
  )
}
