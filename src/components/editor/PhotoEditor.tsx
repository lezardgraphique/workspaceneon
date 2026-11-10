import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Crop, FlipHorizontal2, FlipVertical2, Loader2, RotateCcw, RotateCw, Sparkles, SunMedium, Undo2, X } from 'lucide-react'

import { useEscape } from '@/hooks/use-escape'
import { uploadImage } from '@/lib/images'
import {
  FULL,
  LOOKS,
  NO_EDIT,
  RATIOS,
  adjust,
  centredCrop,
  drawOriented,
  fitCrop,
  hasTransparency,
  isEdited,
  loadForEdit,
  orientedSize,
  renderPhoto,
  toBlob,
} from '@/lib/photo'
import type { PhotoEdit, Rect, Rotation } from '@/lib/photo'

type Tab = 'crop' | 'light' | 'looks'
const TABS: { id: Tab; label: string; icon: typeof Crop }[] = [
  { id: 'crop', label: 'Cadrage', icon: Crop },
  { id: 'light', label: 'Lumière et couleurs', icon: SunMedium },
  { id: 'looks', label: 'Styles', icon: Sparkles },
]

// Output widths: e-mails show images at 600px at most; twice that stays sharp
// on retina screens.
const SIZES = [
  { id: 1200, label: '1200 px (net sur écran Retina)' },
  { id: 600, label: '600 px (léger)' },
  { id: 1600, label: 'Taille d’origine (1600 px max)' },
] as const

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`)

type Drag = { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number; start: Rect; box: DOMRect }

export default function PhotoEditor({ src, onSave, onClose }: { src: string; onSave: (url: string) => void; onClose: () => void }) {
  useEscape(onClose)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState('')
  const [edit, setEdit] = useState<PhotoEdit>(NO_EDIT)
  const [ratio, setRatio] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('crop')
  const [size, setSize] = useState<number>(1200)
  const [before, setBefore] = useState(false)
  const [estimate, setEstimate] = useState('')
  const [saving, setSaving] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const gif = /\.gif(\?|$)/i.test(src)

  useEffect(() => {
    loadForEdit(src)
      .then(setImg)
      .catch(() =>
        setError(
          'Cette image vient d’un site qui n’autorise pas sa retouche. Enregistre-la sur ton appareil puis importe-la avec « Téléverser » : elle sera alors modifiable.',
        ),
      )
  }, [src])

  const size0 = img ? orientedSize(img.naturalWidth, img.naturalHeight, edit.rot) : { w: 1, h: 1 }

  // Preview: the whole image (crop shown on top), orientation cached.
  const base = useMemo(() => (img ? drawOriented(img, { ...NO_EDIT, rot: edit.rot, flipH: edit.flipH, flipV: edit.flipV }, 900) : null), [img, edit.rot, edit.flipH, edit.flipV])
  useEffect(() => {
    const c = canvas.current
    if (!c || !base) return
    const id = requestAnimationFrame(() => {
      c.width = base.width
      c.height = base.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(base, 0, 0)
      if (!before) adjust(c, edit)
    })
    return () => cancelAnimationFrame(id)
  }, [base, edit, before])

  // Final size and weight, computed once the settings rest.
  useEffect(() => {
    if (!img) return
    setEstimate('')
    const id = setTimeout(async () => {
      const out = renderPhoto(img, edit, size)
      const png = /\.png(\?|$)/i.test(src) && hasTransparency(out)
      const blob = await toBlob(out, png ? 'image/png' : 'image/jpeg').catch(() => null)
      setEstimate(`${out.width} × ${out.height} px${blob ? ` · ${kb(blob.size)}` : ''}${png ? ' · PNG (transparence gardée)' : ' · JPEG'}`)
    }, 400)
    return () => clearTimeout(id)
  }, [img, edit, size, src])

  const set = (patch: Partial<PhotoEdit>) => setEdit((e) => ({ ...e, ...patch }))
  const rotate = (dir: 1 | -1) =>
    setEdit((e) => {
      const rot = (((e.rot + dir * 90) % 360) + 360) % 360 as Rotation
      const s = img ? orientedSize(img.naturalWidth, img.naturalHeight, rot) : { w: 1, h: 1 }
      return { ...e, rot, crop: centredCrop(s.w, s.h, ratio) }
    })
  const pickRatio = (r: number | null) => {
    setRatio(r)
    set({ crop: centredCrop(size0.w, size0.h, r) })
  }

  // Crop frame: move it, or pull a corner (ratio kept when one is chosen).
  const startDrag = (mode: Drag['mode']) => (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const box = canvas.current?.getBoundingClientRect()
    if (!box) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, y: e.clientY, start: edit.crop, box }
  }
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x) / d.box.width
    const dy = (e.clientY - d.y) / d.box.height
    const s = d.start
    if (d.mode === 'move') return set({ crop: fitCrop({ ...s, x: s.x + dx, y: s.y + dy }) })
    const left = d.mode.endsWith('w')
    const top = d.mode.startsWith('n')
    let w = Math.max(0.04, s.w + (left ? -dx : dx))
    let h = Math.max(0.04, s.h + (top ? -dy : dy))
    if (ratio) h = (w * size0.w) / (size0.h * ratio)
    // Never past the edges: shrink both sides together when a ratio holds.
    const maxW = left ? s.x + s.w : 1 - s.x
    const maxH = top ? s.y + s.h : 1 - s.y
    const k = Math.min(1, maxW / w, maxH / h)
    if (ratio) (w *= k), (h *= k)
    else (w = Math.min(w, maxW)), (h = Math.min(h, maxH))
    set({ crop: fitCrop({ x: left ? s.x + s.w - w : s.x, y: top ? s.y + s.h - h : s.y, w, h }) })
  }
  const endDrag = () => (drag.current = null)
  const keyCrop = (e: ReactKeyboardEvent) => {
    const step = e.altKey ? 0.002 : 0.01
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    const c = edit.crop
    if (e.shiftKey) {
      const w = c.w + d[0] + d[1] * -1
      set({ crop: fitCrop({ ...c, w, h: ratio ? (w * size0.w) / (size0.h * ratio) : c.h + d[1] }) })
    } else set({ crop: fitCrop({ ...c, x: c.x + d[0], y: c.y + d[1] }) })
  }

  const save = async () => {
    if (!img) return
    setSaving(true)
    setError('')
    try {
      const out = renderPhoto(img, edit, size)
      const png = /\.png(\?|$)/i.test(src) && hasTransparency(out)
      const blob = await toBlob(out, png ? 'image/png' : 'image/jpeg')
      const url = await uploadImage(new File([blob], png ? 'retouche.png' : 'retouche.jpg', { type: blob.type }))
      onSave(url)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? `Enregistrement impossible : ${e.message}` : 'Enregistrement impossible.')
    } finally {
      setSaving(false)
    }
  }

  const range = (label: string, key: 'bright' | 'contrast' | 'sat' | 'warm') => (
    <label className="block">
      <span className="mb-1 flex justify-between font-mono text-[10px] tracking-wider text-mute uppercase">
        {label} <span className="text-white">{edit[key] > 0 ? `+${edit[key]}` : edit[key]}</span>
      </span>
      <input type="range" min={-100} max={100} value={edit[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} className="w-full accent-[#ff007f]" />
    </label>
  )

  const c = edit.crop
  const cropped = c.w < 0.999 || c.h < 0.999

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-line bg-night pb-[max(0px,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:pb-0"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 id="photo-title" className="flex-1 font-display text-lg font-semibold">
            Retoucher l’image
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-mute hover:text-white">
            <X className="size-5" />
            <span className="sr-only">Fermer</span>
          </button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[1fr_300px] md:overflow-hidden">
          <div className="flex min-h-[220px] items-center justify-center overflow-hidden bg-[repeating-conic-gradient(#1c1c30_0%_25%,#12121f_0%_50%)] bg-[length:16px_16px] p-4 md:min-h-0 md:overflow-auto">
            {!img && !error && <Loader2 className="size-6 animate-spin text-cyan" aria-label="Chargement de l’image" />}
            {error && !img && <p className="max-w-sm text-center text-sm text-mute">{error}</p>}
            {img && (
              <div className="relative inline-block max-w-full touch-none select-none" onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
                <canvas ref={canvas} className="block max-h-[55dvh] max-w-full md:max-h-[70vh]" role="img" aria-label="Aperçu de l’image retouchée" />
                {tab !== 'crop' && cropped && !before && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute border border-white/60 shadow-[0_0_0_9999px_rgba(5,5,12,0.62)]"
                    style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
                  />
                )}
                {tab === 'crop' && (
                  <div
                    role="group"
                    tabIndex={0}
                    aria-label="Cadre de recadrage : flèches pour le déplacer, Maj + flèches pour le redimensionner"
                    onKeyDown={keyCrop}
                    onPointerDown={startDrag('move')}
                    className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(5,5,12,0.62)] outline-none focus-visible:border-cyan"
                    style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
                  >
                    <span className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3" aria-hidden>
                      {Array.from({ length: 9 }, (_, i) => (
                        <span key={i} className="border border-white/25" />
                      ))}
                    </span>
                    {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
                      <span
                        key={h}
                        aria-hidden
                        onPointerDown={startDrag(h)}
                        className={`absolute size-6 rounded-full border-2 border-white bg-pink-fill ${h[0] === 'n' ? '-top-3' : '-bottom-3'} ${h[1] === 'w' ? '-left-3' : '-right-3'} ${h === 'nw' || h === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col border-line md:border-l">
            <div role="tablist" aria-label="Outils de retouche" className="flex border-b border-line">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`photo-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`photo-panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`flex flex-1 flex-col items-center gap-1 px-1 py-2 text-[11px] ${tab === t.id ? 'border-b-2 border-pink text-white' : 'text-mute hover:text-white'}`}
                >
                  <t.icon className="size-4" /> {t.label}
                </button>
              ))}
            </div>

            <div role="tabpanel" id={`photo-panel-${tab}`} aria-labelledby={`photo-tab-${tab}`} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {tab === 'crop' && (
                <>
                  <div role="group" aria-label="Format du cadrage" className="flex flex-wrap gap-1.5">
                    {RATIOS.map((r) => (
                      <button
                        key={r.label}
                        type="button"
                        aria-pressed={ratio === r.value}
                        onClick={() => pickRatio(r.value)}
                        className={`rounded-full border px-2.5 py-1 text-xs ${ratio === r.value ? 'border-pink bg-pink/15 text-white' : 'border-line text-mute hover:text-white'}`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-mute">Déplace le cadre ou tire ses coins. Une bannière 2:1 ou 3:1 convient bien en haut d’un e-mail.</p>
                  <div role="group" aria-label="Orientation" className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: 'Tourner à gauche', icon: RotateCcw, run: () => rotate(-1) },
                      { label: 'Tourner à droite', icon: RotateCw, run: () => rotate(1) },
                      { label: 'Miroir horizontal', icon: FlipHorizontal2, run: () => set({ flipH: !edit.flipH }) },
                      { label: 'Miroir vertical', icon: FlipVertical2, run: () => set({ flipV: !edit.flipV }) },
                    ].map((b) => (
                      <button key={b.label} type="button" onClick={b.run} className="flex items-center justify-center rounded-md border border-line py-2 text-mute hover:border-cyan hover:text-white">
                        <b.icon className="size-4" />
                        <span className="sr-only">{b.label}</span>
                      </button>
                    ))}
                  </div>
                  {cropped && (
                    <button type="button" onClick={() => pickRatio(null)} className="text-xs text-cyan underline">
                      Annuler le recadrage
                    </button>
                  )}
                </>
              )}
              {tab === 'light' && (
                <>
                  {range('Luminosité', 'bright')}
                  {range('Contraste', 'contrast')}
                  {range('Saturation', 'sat')}
                  {range('Chaleur', 'warm')}
                </>
              )}
              {tab === 'looks' && (
                <div role="group" aria-label="Style" className="grid grid-cols-2 gap-1.5">
                  {LOOKS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={edit.look === l.id}
                      onClick={() => set({ look: l.id })}
                      className={`rounded-md border px-2 py-2 text-sm ${edit.look === l.id ? 'border-pink bg-pink/15 text-white' : 'border-line text-mute hover:text-white'}`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}

              <hr className="border-line" />
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] tracking-wider text-mute uppercase">Largeur de l’image enregistrée</span>
                <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full rounded-md border border-line bg-void px-2.5 py-2 text-base text-white lg:text-sm">
                  {SIZES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-mute" aria-live="polite">
                {estimate ? `Résultat : ${estimate}` : img ? 'Calcul du résultat…' : ''}
              </p>
              {gif && <p className="text-xs text-pink">GIF animé : la retouche n’en garde que la première image.</p>}
            </div>
          </div>
        </div>

        {error && img && (
          <p role="alert" className="border-t border-line px-4 py-2 text-sm text-pink">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            aria-pressed={before}
            onPointerDown={() => setBefore(true)}
            onPointerUp={() => setBefore(false)}
            onPointerLeave={() => setBefore(false)}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setBefore(true)}
            onKeyUp={() => setBefore(false)}
            disabled={!img}
            className="rounded-md border border-line px-3 py-2 text-sm text-mute hover:text-white disabled:opacity-50"
          >
            Maintenir pour voir l’original
          </button>
          <button
            type="button"
            onClick={() => (setEdit({ ...NO_EDIT, crop: FULL }), setRatio(null))}
            disabled={!isEdited(edit)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-mute hover:text-white disabled:opacity-50"
          >
            <Undo2 className="size-4" /> Tout réinitialiser
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-mute hover:text-white">
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!img || saving}
            className="inline-flex items-center gap-2 rounded-md bg-pink-fill px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {saving && <Loader2 className="size-4 animate-spin" />} Enregistrer l’image
          </button>
        </div>
        <p className="border-t border-line px-4 py-2 text-[11px] text-mute">L’image d’origine reste disponible : la retouche est enregistrée comme une nouvelle image, et « Annuler » dans l’éditeur revient à l’ancienne.</p>
      </div>
    </div>
  )
}
