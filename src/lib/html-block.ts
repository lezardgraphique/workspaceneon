// In-place editing of an HTML block ("Bloc HTML", block type `raw`): every
// element of its code gets a path (indexes of element children from the root,
// "0.2.1"), the preview shows the code with these paths stamped on, and each
// change is applied to the ORIGINAL code at that path. So whatever the preview
// can't show (Outlook conditional comments, HuBL statements, styles the
// sanitizer drops) is kept untouched. Browser only (DOMParser).
import { protectHubl, restoreAttrs } from './hubl-protect'

export const PATH_ATTR = 'data-nsp-p'

const MARK = /<!--nsp-hubl:(\d+)-->/g
const VOID = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'SOURCE', 'TRACK', 'WBR'])
// Formatting that may sit inside a text being edited.
const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'SPAN', 'SMALL', 'SUP', 'SUB', 'BR', 'FONT', 'MARK', 'CODE', 'A'])
// Elements that only exist inside a given parent: they move among their own kind.
const BOUND = new Set(['TR', 'TD', 'TH', 'TBODY', 'THEAD', 'TFOOT', 'LI', 'OPTION', 'COLGROUP', 'COL', 'CAPTION'])

interface Parsed {
  root: HTMLElement
  tokens: string[]
}

function parse(src: string): Parsed {
  const p = protectHubl(src)
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${p.html}</body></html>`, 'text/html')
  return { root: doc.body, tokens: p.tokens }
}

// Back to code: HuBL tokens where they were (comments → text, data-nsp-t → statements).
function serialize({ root, tokens }: Parsed): string {
  const html = root.innerHTML.replace(MARK, (_m, n: string) => tokens[Number(n)] ?? '')
  return restoreAttrs(html, tokens)
}

const elementsOf = (el: Element) => Array.from(el.children)

function withoutComments(src: string): string {
  let plain = src
  let previous: string
  do {
    previous = plain
    plain = plain.replace(/<!--[\s\S]*?-->/g, '')
  } while (plain !== previous)
  return plain
}

function walk(el: Element, path: string, fn: (el: Element, path: string) => void) {
  elementsOf(el).forEach((c, i) => {
    const p = path ? `${path}.${i}` : String(i)
    fn(c, p)
    walk(c, p, fn)
  })
}

function at(root: Element, path: string): Element | null {
  let el: Element | null = root
  for (const i of path.split('.')) {
    if (!el) return null
    el = el.children[Number(i)] ?? null
  }
  return el
}

// Tag names written in the code (comments and HuBL left out), in order.
function writtenTags(src: string): string[] {
  const plain = withoutComments(src).replace(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}|\{#[\s\S]*?#\}/g, '')
  return [...plain.matchAll(/<([a-zA-Z][\w:-]*)/g)].map((m) => m[1].toUpperCase())
}

export interface Stamped {
  /** Code with a path on every element, for the preview. */
  html: string
  /** False when the browser would rebuild the code (a <tr> without its table…): edit it in the Code tab. */
  ok: boolean
}

export function stampPaths(src: string): Stamped {
  if (typeof DOMParser === 'undefined' || !src.trim()) return { html: src, ok: false }
  const parsed = parse(src)
  const found: string[] = []
  walk(parsed.root, '', (el, path) => {
    found.push(el.tagName)
    el.setAttribute(PATH_ATTR, path)
  })
  // The parser adds a <tbody> to tables written without one: not a change.
  const written = writtenTags(src).filter((t) => t !== 'TBODY')
  const kept = found.filter((t) => t !== 'TBODY')
  const ok = written.length === kept.length && written.every((t, i) => t === kept[i])
  // For the preview, logic lines ({% if %}…) are shown as labels, not as text to edit.
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = restoreAttrs(
    parsed.root.innerHTML.replace(MARK, (_m, n: string) => {
      const t = parsed.tokens[Number(n)] ?? ''
      return t.startsWith('{%') ? `<span class="neon-hubl">${esc(t)}</span>` : t
    }),
    parsed.tokens,
  )
  return { html, ok }
}

function edit(src: string, fn: (root: HTMLElement) => boolean | void): string {
  const parsed = parse(src)
  if (fn(parsed.root) === false) return src
  return serialize(parsed)
}

// What can be done with the element at `path` (read from the original code).
export interface Facts {
  tag: string
  /** Only text and inline formatting inside, no HuBL logic: editable as a text. */
  text: boolean
  src?: string
  alt?: string
  href?: string
  first: boolean
  last: boolean
}

export function factsOf(src: string, path: string): Facts | null {
  const { root, tokens } = parse(src)
  const el = at(root, path)
  if (!el) return null
  const inlineOnly = (e: Element): boolean => elementsOf(e).every((c) => INLINE.has(c.tagName) && inlineOnly(c))
  const hasLogic = (e: Element) => {
    const w = e.ownerDocument.createTreeWalker(e, 0x80)
    // Logic ({% … %}) and Outlook comments stay out of reach; a {{ variable }} is just text.
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const m = /^nsp-hubl:(\d+)$/.exec((n as Comment).data)
      if ((m && tokens[Number(m[1])]?.startsWith('{%')) || /\[if /.test((n as Comment).data)) return true
    }
    return /data-nsp-t\d/.test(e.outerHTML)
  }
  const hasValue = (e: Element) => /<!--nsp-hubl:\d+-->/.test(e.innerHTML)
  const siblings = el.parentElement ? elementsOf(el.parentElement) : []
  const i = siblings.indexOf(el)
  return {
    tag: el.tagName,
    text: !VOID.has(el.tagName) && inlineOnly(el) && !hasLogic(el) && ((el.textContent ?? '').trim().length > 0 || hasValue(el)),
    ...(el.tagName === 'IMG' ? { src: el.getAttribute('src') ?? '', alt: el.getAttribute('alt') ?? '' } : {}),
    ...(el.tagName === 'A' ? { href: el.getAttribute('href') ?? '' } : el.closest('a') ? { href: el.closest('a')!.getAttribute('href') ?? '' } : {}),
    first: i <= 0,
    last: i === siblings.length - 1,
  }
}

// New content of a text element (already sanitized by the caller).
export function setInner(src: string, path: string, html: string): string {
  const parsed = parse(src)
  const el = at(parsed.root, path)
  if (!el) return src
  // The typed text keeps its {{ variables }} exactly (no &amp; inside them).
  const typed = protectHubl(html)
  const shift = parsed.tokens.length
  parsed.tokens.push(...typed.tokens)
  const tmp = parsed.root.ownerDocument.createElement('div')
  tmp.innerHTML = typed.html.replace(/<!--nsp-hubl:(\d+)-->/g, (_m, n: string) => `<!--nsp-hubl:${Number(n) + shift}-->`).replace(/data-nsp-t(\d+)/g, (_m, n: string) => `data-nsp-t${Number(n) + shift}`)
  tmp.querySelectorAll(`[${PATH_ATTR}]`).forEach((e) => e.removeAttribute(PATH_ATTR))
  el.innerHTML = tmp.innerHTML
  return serialize(parsed)
}

export function setAttr(src: string, path: string, name: 'src' | 'alt' | 'href', value: string): string {
  return edit(src, (root) => {
    let el = at(root, path)
    if (name === 'href' && el && el.tagName !== 'A') el = el.closest('a')
    if (!el) return false
    el.setAttribute(name, value)
  })
}

export function removeAt(src: string, path: string): string {
  return edit(src, (root) => {
    const el = at(root, path)
    if (!el) return false
    el.remove()
  })
}

export function duplicateAt(src: string, path: string): string {
  return edit(src, (root) => {
    const el = at(root, path)
    if (!el) return false
    el.after(el.cloneNode(true))
  })
}

// Can `from` be placed next to `to`? Never inside itself; table rows, cells and
// list items only among their own kind, other elements never among them.
export function canMove(from: string, to: string, src: string): boolean {
  const { root } = parse(src)
  const a = at(root, from)
  const b = at(root, to)
  return !!a && !!b && canPlace(from, a.tagName, to, b.tagName)
}

// Same rule from paths and tag names (the preview shows the same elements: no parsing while dragging).
export function canPlace(from: string, fromTag: string, to: string, toTag: string): boolean {
  if (from === to || to.startsWith(`${from}.`)) return false
  if (BOUND.has(fromTag) || BOUND.has(toTag)) return fromTag === toTag || (/^T[DH]$/.test(fromTag) && /^T[DH]$/.test(toTag))
  return true
}

export function moveAt(src: string, from: string, to: string, where: 'before' | 'after'): string {
  if (!canMove(from, to, src)) return src
  return edit(src, (root) => {
    const a = at(root, from)
    const b = at(root, to)
    if (!a || !b) return false
    if (where === 'before') b.before(a)
    else b.after(a)
  })
}

// One step up or down among its siblings.
export function stepAt(src: string, path: string, dir: -1 | 1): string {
  return edit(src, (root) => {
    const el = at(root, path)
    const sib = dir < 0 ? el?.previousElementSibling : el?.nextElementSibling
    if (!el || !sib) return false
    if (dir < 0) sib.before(el)
    else sib.after(el)
  })
}

// Path of the element that took the place of `path` after a step (for the selection).
export function steppedPath(path: string, dir: -1 | 1): string {
  const parts = path.split('.')
  parts[parts.length - 1] = String(Number(parts.at(-1)) + dir)
  return parts.join('.')
}
