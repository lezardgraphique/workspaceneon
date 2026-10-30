import { isSafeUrl, sanitizeHtml, stripTags } from './sanitize'
import { uid } from './types'
import type { Align, Block, Columns, ModuleTree, Section } from './types'

// Rebuilds a module tree from untrusted JSON (what the API receives): known
// block types only, every value clamped or filtered, every string cleaned.
// Anything that doesn't fit is dropped. The result is safe to store, render in
// the editor and write into generated code.

const MAX_DEPTH = 4
const MAX_BLOCKS = 1500

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

const HEX = /^#[0-9a-f]{3,8}$/i
const NAMED = /^[a-z]{3,20}$/i
const FUNC = /^(rgb|rgba|hsl|hsla)\(\s*[\d\s.,%/-]+\)$/i
const TOKEN = /^\{\{[^"'<>;{}]*\}\}$/

export function safeColor(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return HEX.test(s) || NAMED.test(s) || FUNC.test(s) || TOKEN.test(s) ? s : fallback
}

export function safeFont(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.replace(/[^\p{L}\p{N} ,'_.-]/gu, '').trim().slice(0, 200) : ''
  return s || fallback
}

const align = (v: unknown, fallback: Align): Align => (v === 'left' || v === 'center' || v === 'right' ? v : fallback)

function field(v: unknown) {
  if (!isObj(v)) return undefined
  const name = str(v.name, 60)
  if (!/^[\w.-]{1,60}$/.test(name)) return undefined
  const link = (x: unknown) => (typeof x === 'string' && /^[\w.-]{1,60}$/.test(x) ? x : undefined)
  const textName = link(v.textName)
  const linkName = link(v.linkName)
  return {
    name,
    label: stripTags(str(v.label, 100)),
    ...(textName ? { textName } : {}),
    ...(linkName ? { linkName } : {}),
  }
}

const id = (v: unknown) => (typeof v === 'string' && /^[\w~-]{1,40}$/.test(v) ? v : uid())

function block(raw: unknown, depth: number, count: { n: number }): Block | null {
  if (!isObj(raw) || count.n++ > MAX_BLOCKS) return null
  const base = { id: id(raw.id) }
  const f = field(raw.field)
  const withField = f ? { field: f } : {}
  switch (raw.type) {
    case 'heading':
      return {
        ...base,
        type: 'heading',
        ...withField,
        text: stripTags(str(raw.text, 2000)),
        level: raw.level === 1 || raw.level === 3 ? raw.level : 2,
        color: safeColor(raw.color, '#0f0f1a'),
        align: align(raw.align, 'left'),
        size: num(raw.size, 26, 8, 96),
      }
    case 'text':
      return {
        ...base,
        type: 'text',
        ...withField,
        html: sanitizeHtml(str(raw.html, 50_000)),
        color: safeColor(raw.color, '#3a3a52'),
        align: align(raw.align, 'left'),
        size: num(raw.size, 16, 8, 64),
      }
    case 'button': {
      const href = str(raw.href, 2000).trim()
      return {
        ...base,
        type: 'button',
        ...withField,
        label: stripTags(str(raw.label, 300)),
        href: isSafeUrl(href) ? href : '#',
        bg: safeColor(raw.bg, '#ff007f'),
        color: safeColor(raw.color, '#ffffff'),
        align: align(raw.align, 'left'),
        radius: num(raw.radius, 8, 0, 60),
      }
    }
    case 'image': {
      const src = str(raw.src, 2_000_000).trim()
      return {
        ...base,
        type: 'image',
        ...withField,
        src: isSafeUrl(src, true) ? src : '',
        alt: stripTags(str(raw.alt, 300)),
        width: num(raw.width, 100, 1, 100),
        align: align(raw.align, 'center'),
      }
    }
    case 'divider':
      return { ...base, type: 'divider', color: safeColor(raw.color, '#e3e3ee') }
    case 'spacer':
      return { ...base, type: 'spacer', height: num(raw.height, 24, 0, 400) }
    case 'raw':
      return { ...base, type: 'raw', html: sanitizeHtml(str(raw.html, 50_000)) }
    case 'section':
      return depth < MAX_DEPTH ? section(raw, depth + 1, count) : null
    default:
      return null
  }
}

export function section(raw: unknown, depth = 0, count: { n: number } = { n: 0 }): Section | null {
  if (!isObj(raw) || raw.type !== 'section' || !Array.isArray(raw.cells)) return null
  const cells = raw.cells
    .slice(0, 3)
    .map((cell) => (Array.isArray(cell) ? cell.map((b) => block(b, depth, count)).filter((b): b is Block => !!b) : []))
  if (!cells.length) cells.push([])
  return {
    id: id(raw.id),
    type: 'section',
    columns: cells.length as Columns,
    behavior: raw.behavior === 'side' ? 'side' : 'stack',
    bg: safeColor(raw.bg, '#ffffff'),
    padding: num(raw.padding, 24, 0, 120),
    radius: num(raw.radius, 0, 0, 60),
    cells,
  }
}

export function sanitizeTree(raw: unknown): ModuleTree {
  const t = isObj(raw) ? raw : {}
  const count = { n: 0 }
  return {
    width: num(t.width, 600, 320, 900),
    bg: safeColor(t.bg, '#f2f2f7'),
    font: safeFont(t.font, "'Helvetica Neue', Helvetica, Arial, sans-serif"),
    sections: (Array.isArray(t.sections) ? t.sections.slice(0, 100) : [])
      .map((s) => section(s, 0, count))
      .filter((s): s is Section => !!s),
  }
}
