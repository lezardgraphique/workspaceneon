import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Renders a full email HTML document in a sandboxed iframe (no scripts), sized
// to its content and scaled down to fit its container when it is narrower
// than the simulated screen (`width`). Used by the client tests, the module
// preview page and the library thumbnails.
export function EmailFrame({
  html,
  width,
  maxHeight,
  interactive,
  title,
}: {
  html: string
  width: number
  /** Crops the content (unscaled px), for thumbnails. */
  maxHeight?: number
  /** Links open in a new tab; otherwise the frame ignores the pointer. */
  interactive?: boolean
  title: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [boxWidth, setBoxWidth] = useState(width)
  const [height, setHeight] = useState(maxHeight ?? 480)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth))
    ro.observe(el)
    setBoxWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Follow the content height (images load after the document).
  const cleanup = useRef<() => void>(() => {})
  const onLoad = () => {
    cleanup.current()
    const doc = frame.current?.contentDocument
    if (!doc?.body) return
    // body, not documentElement: the latter never gets smaller than the frame.
    const measure = () => setHeight(Math.max(40, doc.body.scrollHeight))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(doc.body)
    cleanup.current = () => ro.disconnect()
  }
  useEffect(() => () => cleanup.current(), [])

  const scale = Math.min(1, boxWidth / width)
  const shown = maxHeight ? Math.min(height, maxHeight) : height

  return (
    <div ref={box} className="w-full overflow-hidden" style={{ height: shown * scale }}>
      <iframe
        ref={frame}
        title={title}
        srcDoc={html}
        onLoad={onLoad}
        loading="lazy"
        sandbox={interactive ? 'allow-same-origin allow-popups allow-popups-to-escape-sandbox' : 'allow-same-origin'}
        tabIndex={interactive ? undefined : -1}
        style={{
          width,
          height: shown,
          border: 0,
          display: 'block',
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: '0 0',
          pointerEvents: interactive ? undefined : 'none',
          // Centre when the screen is narrower than the container.
          marginInline: scale === 1 ? 'auto' : undefined,
        }}
      />
    </div>
  )
}
