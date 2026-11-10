import { Suspense, lazy, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'

// Mini photo editor (crop, rotate, light, looks, e-mail size), loaded on demand.
const PhotoEditor = lazy(() => import('./PhotoEditor'))

export function PhotoButton({ src, onSave, compact }: { src: string; onSave: (src: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  // A variable in the address (dynamic image) can't be edited.
  const usable = !!src && !src.includes('{{') && !src.includes('{%')
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!usable}
        title={usable ? undefined : src ? 'Image dynamique : rien à retoucher ici' : 'Ajoute d’abord une image'}
        className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-pink/60 px-3 text-sm text-pink hover:bg-pink/10 disabled:opacity-40 ${compact ? 'py-1.5' : 'self-stretch'}`}
      >
        <SlidersHorizontal className="size-4" /> Retoucher
      </button>
      {open && (
        <Suspense fallback={null}>
          <PhotoEditor src={src} onSave={onSave} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}

