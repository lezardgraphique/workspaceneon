import { useMemo, useState } from 'react'
import { ImageIcon, Link2, Upload } from 'lucide-react'

import { isImageFile, uploadImage } from '@/lib/images'
import { listImages, replaceImage, setImageAlt } from '@/lib/import-images'
import type { FoundImage, ImageStatus } from '@/lib/import-images'

// The images of the pasted module, before the import: where each comes from,
// what the import will do with it, and how to fix it (another file, another
// address, the alternative text).

const STATUS: Record<ImageStatus, { label: string; tone: string; title: string }> = {
  copy: { label: 'sera copiée', tone: 'text-cyan', title: 'Copiée dans Neon Sandbox Pro à l’import : le module ne dépendra plus du site d’origine.' },
  own: { label: 'déjà dans l’outil', tone: 'text-cyan', title: 'Image déjà hébergée par Neon Sandbox Pro.' },
  data: { label: 'intégrée au code', tone: 'text-[#ffb36b]', title: 'Image écrite dans le code (data:) : souvent bloquée par Gmail et Outlook. Remplace-la par un fichier.' },
  format: { label: 'format refusé', tone: 'text-[#ffb36b]', title: 'WebP, SVG, AVIF… : mal affichés par les messageries. Le lien d’origine est gardé ; remplace-la par un JPEG, PNG ou GIF.' },
  relative: { label: 'introuvable', tone: 'text-pink', title: 'Chemin relatif au site d’origine : l’image ne s’affichera pas dans un e-mail. Remplace-la par un fichier ou une adresse complète.' },
}

export function ImportImages({
  code,
  fields,
  setCode,
  setFields,
}: {
  code: string
  fields: string
  setCode: (t: string) => void
  setFields: (t: string) => void
}) {
  const images = useMemo(() => listImages(code, fields), [code, fields])
  const [broken, setBroken] = useState<Set<string>>(new Set())
  if (!images.length) return null
  const problems = images.filter((i) => i.status === 'relative' || i.status === 'format' || i.status === 'data' || broken.has(i.token) || i.alt === '').length
  const swap = (token: string, next: string) => {
    if (!next || next === token) return
    setCode(replaceImage(code, token, next))
    setFields(replaceImage(fields, token, next))
  }
  return (
    <details open className="rounded-md border border-line" aria-label="Images du module importé">
      <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-xs text-white">
        <ImageIcon className="size-3.5 text-violet" aria-hidden />
        <span className="flex-1">
          Images ({images.length}){problems > 0 && <span className="text-[#ffb36b]"> · {problems} à vérifier</span>}
        </span>
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {images.map((img) => (
          <ImageRow
            key={img.token}
            img={img}
            broken={broken.has(img.token)}
            onBroken={() => setBroken((b) => new Set(b).add(img.token))}
            onSwap={(next) => swap(img.token, next)}
            onAlt={(alt) => setCode(setImageAlt(code, img.token, alt))}
          />
        ))}
      </ul>
      <p className="border-t border-line px-2.5 py-2 text-[11px] text-mute">
        À l’import, les images « sera copiée » sont hébergées par Neon Sandbox Pro. Les images dynamiques ({'{{ … }}'}) se gèrent dans l’onglet Champs.
      </p>
    </details>
  )
}

function ImageRow({ img, broken, onBroken, onSwap, onAlt }: { img: FoundImage; broken: boolean; onBroken: () => void; onSwap: (next: string) => void; onAlt: (alt: string) => void }) {
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [alt, setAlt] = useState(img.alt ?? '')
  const st = broken && (img.status === 'copy' || img.status === 'own') ? { label: 'ne charge pas', tone: 'text-pink', title: 'L’adresse ne répond pas ou n’est pas une image : remplace-la.' } : STATUS[img.status]
  const upload = async (file: File | undefined) => {
    if (!file) return
    if (!isImageFile(file)) return setError('Choisis une image (JPEG, PNG, GIF…).')
    setBusy(true)
    setError('')
    try {
      onSwap(await uploadImage(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi impossible')
    } finally {
      setBusy(false)
    }
  }
  const short = img.status === 'data' ? 'image intégrée (data:)' : img.token.replace(/^https?:\/\//, '')
  return (
    <li className="space-y-1.5 px-2.5 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded border border-line bg-white/5">
          {img.thumb && !broken ? (
            <img src={img.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={onBroken} className="size-full object-contain" />
          ) : (
            <ImageIcon className="size-4 text-mute" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[11px] text-[#d9d9ec]" title={img.status === 'data' ? undefined : img.token}>
            {short}
          </span>
          <span className={`text-[11px] ${st.tone}`} title={st.title}>
            {st.label}
            {img.where.includes('champs') && <span className="text-mute"> · dans les champs</span>}
          </span>
        </span>
        <label className={`inline-flex cursor-pointer items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-mute hover:text-white ${busy ? 'opacity-50' : ''}`}>
          <Upload className="size-3" aria-hidden /> {busy ? 'Envoi…' : 'Remplacer'}
          <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          aria-expanded={editing}
          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-mute hover:text-white"
        >
          <Link2 className="size-3" aria-hidden /> Adresse
        </button>
      </div>
      {editing && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            const next = address.trim()
            if (!/^https:\/\/\S+$/i.test(next)) return setError('Une adresse complète en https:// est nécessaire.')
            setError('')
            onSwap(next)
            setEditing(false)
          }}
        >
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="https://…/image.jpg"
            aria-label="Nouvelle adresse de l’image"
            className="min-w-0 flex-1 rounded-md border border-line bg-void px-2 py-1 font-mono text-base text-white outline-none focus:border-cyan lg:text-[11px]"
          />
          <button type="submit" className="rounded-md bg-cyan px-2 py-1 text-[11px] font-semibold text-void">
            Utiliser
          </button>
        </form>
      )}
      {img.alt !== null && (
        <label className="flex items-center gap-2">
          <span className={`shrink-0 text-[11px] ${alt.trim() ? 'text-mute' : 'text-[#ffb36b]'}`}>Texte alternatif</span>
          <input
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            onBlur={() => alt !== (img.alt ?? '') && onAlt(alt.trim())}
            placeholder="Décris l’image (lu si elle est bloquée)"
            className="min-w-0 flex-1 rounded-md border border-line bg-void px-2 py-1 text-base text-white outline-none focus:border-cyan lg:text-[11px]"
          />
        </label>
      )}
      {error && <p className="text-[11px] text-pink">{error}</p>}
    </li>
  )
}
