// Discourages copying the site's images (browser only): no context menu, no
// drag to the desktop, no iOS "save image" callout on <img>. Text and code stay
// fully copyable (the tool is used to copy HTML/HuBL), and the user's own files
// on /fichiers are left alone. A deterrent, not a protection: screenshots and
// the network panel still work.
export function applyImageGuard(): () => void {
  if (typeof document === 'undefined') return () => {}
  const guarded = (t: EventTarget | null): t is HTMLImageElement =>
    t instanceof HTMLImageElement && !location.pathname.startsWith('/fichiers')
  const onMenu = (e: MouseEvent) => { if (guarded(e.target)) e.preventDefault() }
  const onDrag = (e: DragEvent) => { if (guarded(e.target)) e.preventDefault() }
  const style = document.createElement('style')
  style.textContent = 'img{-webkit-user-drag:none;-webkit-touch-callout:none}'
  document.head.appendChild(style)
  document.addEventListener('contextmenu', onMenu)
  document.addEventListener('dragstart', onDrag)
  return () => {
    document.removeEventListener('contextmenu', onMenu)
    document.removeEventListener('dragstart', onDrag)
    style.remove()
  }
}
