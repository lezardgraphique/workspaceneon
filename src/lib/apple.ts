// Fixes for Safari on iPhone and iPad (browser only).

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with a touch screen). */
export function appleMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/**
 * - Safari zooms into any field whose text is under 16px when it gets the focus
 *   (and stays zoomed). `maximum-scale=1` stops that automatic zoom only:
 *   Safari still lets people pinch to zoom (other browsers would not, so it is
 *   added on iPhone/iPad only).
 * - Safari ignores `interactive-widget=resizes-content`: the keyboard covers the
 *   bottom of the page instead of shrinking it. `--app-h` follows the part left
 *   visible (visualViewport) while the keyboard is open, for full-height screens.
 * Returns the cleanup.
 */
export function applyAppleFixes(): () => void {
  if (!appleMobile()) return () => {}
  const root = document.documentElement
  root.dataset.ios = 'true'

  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (meta && !/maximum-scale/.test(meta.content)) meta.content += ', maximum-scale=1'

  const vv = window.visualViewport
  if (!vv) return () => {}
  let frame = 0
  const update = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      // Keyboard open = the visible part is clearly shorter than the window.
      const open = window.innerHeight - vv.height > 120
      if (open) {
        root.style.setProperty('--app-h', `${Math.round(vv.height)}px`)
        // Safari slides the whole page up to show the field: put it back, the
        // screen is now exactly the visible height and scrolls inside.
        if (window.scrollY) window.scrollTo(0, 0)
        const el = document.activeElement as HTMLElement | null
        el?.scrollIntoView?.({ block: 'nearest' })
      } else root.style.removeProperty('--app-h')
    })
  }
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  return () => {
    cancelAnimationFrame(frame)
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
    root.style.removeProperty('--app-h')
  }
}
