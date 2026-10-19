import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import type { DragEvent } from 'react'

import { firstImage, uploadImage } from '@/lib/images'

// Upload button + drop zone used wherever an image URL can be typed.
export function ImageUpload({ onUploaded, compact }: { onUploaded: (url: string) => void; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async (file: File | undefined) => {
    if (!file) return setError('Choisis un fichier image (JPG, PNG, GIF, WebP…)')
    setBusy(true)
    setError(null)
    try {
      onUploaded(await uploadImage(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec du téléversement')
    } finally {
      setBusy(false)
    }
  }

  const drop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    send(firstImage(e.dataTransfer.files))
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex w-full items-center justify-center gap-2 rounded-md border border-dashed text-sm transition-colors disabled:opacity-60 ${
          compact ? 'px-2.5 py-2 lg:py-1.5' : 'px-3 py-4'
        } ${over ? 'border-cyan bg-cyan/10 text-white' : 'border-line text-mute hover:border-cyan hover:text-white'}`}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {busy ? 'Téléversement…' : compact ? 'Téléverser' : 'Téléverser ou déposer une image'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/avif"
        hidden
        onChange={(e) => {
          send(firstImage(e.target.files))
          e.target.value = ''
        }}
      />
      {error && <p className="mt-1 text-xs text-pink">{error}</p>}
    </div>
  )
}
