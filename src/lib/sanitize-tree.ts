import { olClean } from './outlook'
import { safeBgImage, spacingClean } from './look'
import { isSafeUrl, sanitizeHtml, sanitizeStyle, stripTags } from './sanitize'
import { uid } from './types'
import type { Align, Block, Columns, ExtraField, ExtraFieldType, Json, ModuleTree, Section } from './types'

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

// HubSpot definitions and values kept for an exact export: plain JSON only,
// bounded, strings without tags, URLs checked. Never shown as HTML.
const URL_KEY = /^(href|src|url|linkUrl|redirect_url|oembed_url)$/
export function safeJson(v: unknown, depth = 0, key = ''): Json | undefined {
  if (depth > 8) return undefined
  if (v === null || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') {
    const t = str(v, 5000)
    if (URL_KEY.test(key) && !isSafeUrl(t, key === 'src')) return ''
    return key === 'html' || key === 'message' ? sanitizeHtml(t) : stripTags(t)
  }
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => safeJson(x, depth + 1, key)).filter((x): x is Json => x !== undefined)
  if (isObj(v)) {
    const out: { [k: string]: Json } = {}
    for (const [k, x] of Object.entries(v).slice(0, 60)) {
      if (!/^[\w.-]{1,60}$/.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue
      const j = safeJson(x, depth + 1, k)
      if (j !== undefined) out[k] = j
    }
    return out
  }
  return undefined
}
const specObj = (v: unknown) => {
  const j = isObj(v) && JSON.stringify(v).length < 20_000 ? safeJson(v) : undefined
  return j && typeof j === 'object' && !Array.isArray(j) && Object.keys(j).length ? (j as { [k: string]: Json }) : undefined
}

function field(v: unknown) {
  if (!isObj(v)) return undefined
  const name = str(v.name, 60)
  if (!/^[\w.-]{1,60}$/.test(name)) return undefined
  const link = (x: unknown) => (typeof x === 'string' && /^[\w.-]{1,60}$/.test(x) ? x : undefined)
  const textName = link(v.textName)
  const linkName = link(v.linkName)
  const specs: { [n: string]: { [k: string]: Json } } = {}
  if (isObj(v.specs))
    for (const [n, x] of Object.entries(v.specs).slice(0, 4)) {
      const sp = /^[\w.-]{1,60}$/.test(n) ? specObj(x) : undefined
      if (sp) specs[n] = sp
    }
  return {
    name,
    label: stripTags(str(v.label, 100)),
    ...(textName ? { textName } : {}),
    ...(linkName ? { linkName } : {}),
    ...(Object.keys(specs).length ? { specs } : {}),
  }
}

const id = (v: unknown) => (typeof v === 'string' && /^[\w~-]{1,40}$/.test(v) ? v : uid())

// Optional number: kept only when it is one, clamped.
const opt = (v: unknown, key: string, min: number, max: number, decimals = 0): Record<string, number> => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return {}
  const f = 10 ** decimals
  return { [key]: Math.round(Math.min(max, Math.max(min, v)) * f) / f }
}

function block(raw: unknown, depth: number, count: { n: number }): Block | null {
  const b = blockInner(raw, depth, count)
  if (!b || b.type === 'raw' || b.type === 'section' || !isObj(raw)) return b
  const outlook = olClean(raw.outlook)
  const fixed = raw.fixed === true && (b.type === 'heading' || b.type === 'text' || b.type === 'button' || b.type === 'image') ? { fixed: true } : {}
  return { ...b, ...fixed, ...spacingClean(raw), ...(outlook ? { outlook } : {}) }
}

function blockInner(raw: unknown, depth: number, count: { n: number }): Block | null {
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
        ...opt(raw.lineHeight, 'lineHeight', 0.8, 3, 2),
        ...opt(raw.weight, 'weight', 100, 900),
        ...opt(raw.letterSpacing, 'letterSpacing', -5, 20),
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
        ...opt(raw.lineHeight, 'lineHeight', 0.8, 3, 2),
        ...opt(raw.letterSpacing, 'letterSpacing', -5, 20),
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
        ...(typeof raw.vmlWidth === 'number' && raw.vmlWidth >= 80 ? { vmlWidth: num(raw.vmlWidth, 160, 80, 600) } : {}),
        ...(typeof raw.height === 'number' && raw.height > 0 ? { height: num(raw.height, 42, 24, 100) } : {}),
        ...(typeof raw.fontSize === 'number' && raw.fontSize > 0 ? { fontSize: num(raw.fontSize, 15, 10, 36) } : {}),
        ...(raw.bold === false ? { bold: false } : {}),
        ...(raw.msoCell === true ? { msoCell: true } : {}),
        ...(raw.fullWidth === true ? { fullWidth: true } : {}),
        ...opt(raw.padX, 'padX', 0, 80),
        ...(typeof raw.borderWidth === 'number' && raw.borderWidth > 0 ? { borderWidth: num(raw.borderWidth, 1, 1, 8), borderColor: safeColor(raw.borderColor, '#ffffff') } : {}),
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
        ...(typeof raw.href === 'string' && raw.href.trim() && isSafeUrl(raw.href.trim()) ? { href: str(raw.href, 2000).trim() } : {}),
        ...opt(raw.radius, 'radius', 0, 200),
      }
    }
    case 'divider':
      return {
        ...base,
        type: 'divider',
        color: safeColor(raw.color, '#e3e3ee'),
        ...opt(raw.thickness, 'thickness', 1, 20),
        ...(raw.lineStyle === 'dashed' || raw.lineStyle === 'dotted' ? { lineStyle: raw.lineStyle } : {}),
        ...opt(raw.width, 'width', 5, 100),
      }
    case 'spacer':
      return { ...base, type: 'spacer', height: num(raw.height, 24, 0, 400), ...opt(raw.mobileHeight, 'mobileHeight', 0, 400) }
    case 'raw':
      return { ...base, type: 'raw', html: sanitizeHtml(str(raw.html, 50_000)), ...(raw.cols === 2 || raw.cols === 3 ? { cols: raw.cols } : {}) }
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
    ...(olClean(raw.outlook) ? { outlook: olClean(raw.outlook) } : {}),
    ...opt(raw.padY, 'padY', 0, 200),
    ...opt(raw.padX, 'padX', 0, 200),
    ...(typeof raw.borderWidth === 'number' && raw.borderWidth > 0 ? { ...opt(raw.borderWidth, 'borderWidth', 1, 20), borderColor: safeColor(raw.borderColor, '#e3e3ee') } : {}),
    ...(safeBgImage(typeof raw.bgImage === 'string' ? raw.bgImage : '') ? { bgImage: safeBgImage(raw.bgImage as string) } : {}),
    ...(cells.length === 2 ? opt(raw.ratio, 'ratio', 20, 80) : {}),
    ...(raw.valign === 'middle' || raw.valign === 'bottom' ? { valign: raw.valign } : {}),
    ...(typeof raw.css === 'string' && sanitizeStyle(str(raw.css, 2000)) ? { css: sanitizeStyle(str(raw.css, 2000)) } : {}),
    ...spacingClean(raw),
    cells,
  }
}

// Extra module fields (variables of the code): names, types and default values
// rebuilt from a closed list, whatever was sent.
const FIELD_TYPES = new Set<string>(['text', 'richtext', 'number', 'boolean', 'link', 'url', 'image', 'file', 'color', 'font', 'alignment', 'textalignment', 'backgroundimage', 'date', 'datetime', 'choice', 'group', 'json'])
const FIELD_NAME = /^[A-Za-z_]\w{0,59}$/
// HubSpot choice values can be any short string.
const CHOICE_VALUE = /^[^<>]{0,200}$/
const bigNum = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined)

function fieldDefault(type: ExtraFieldType, v: unknown): Json | undefined {
  switch (type) {
    case 'text':
      return typeof v === 'string' ? stripTags(str(v, 1000)) : v === null ? null : undefined
    case 'richtext':
      return typeof v === 'string' ? sanitizeHtml(str(v, 5000)) : undefined
    case 'number':
      return bigNum(v, -1e15, 1e15)
    case 'boolean':
      return typeof v === 'boolean' ? v : undefined
    case 'date':
    case 'datetime':
      return bigNum(v, 0, 4_102_444_800_000)
    case 'choice':
      return typeof v === 'string' && CHOICE_VALUE.test(v) ? stripTags(v) : undefined
    case 'link': {
      if (!isObj(v)) return undefined
      const u = isObj(v.url) ? v.url : {}
      const href = str(u.href, 2000)
      // Other keys of the HubSpot value (sponsored, rel…) are kept, checked.
      const rest = safeJson(v) as { [k: string]: Json }
      return { ...rest, url: { ...(safeJson(u) as { [k: string]: Json }), type: typeof u.type === 'string' ? stripTags(u.type) : 'EXTERNAL', href: isSafeUrl(href) ? href : '', content_id: typeof u.content_id === 'number' ? u.content_id : null }, open_in_new_tab: v.open_in_new_tab === true, no_follow: v.no_follow === true }
    }
    case 'image': {
      if (!isObj(v)) return undefined
      const src = str(v.src, 2000)
      return { ...(safeJson(v) as { [k: string]: Json }), src: isSafeUrl(src, true) ? src : '', alt: stripTags(str(v.alt, 200)), width: num(v.width, 600, 1, 4000), height: num(v.height, 300, 1, 4000) }
    }
    case 'color':
      return isObj(v) ? { color: safeColor(v.color, '#000000'), opacity: num(v.opacity, 100, 0, 100) } : undefined
    default:
      return undefined
  }
}

function extraField(raw: unknown, depth = 0): ExtraField | null {
  if (!isObj(raw) || depth > 4) return null
  const name = str(raw.name, 60)
  const type = typeof raw.type === 'string' && FIELD_TYPES.has(raw.type) ? (raw.type as ExtraFieldType) : null
  if (!FIELD_NAME.test(name) || !type) return null
  const out: ExtraField = { name, label: stripTags(str(raw.label, 100)) || name, type }
  if (typeof raw.hsType === 'string' && /^[a-z_]{2,30}$/.test(raw.hsType)) out.hsType = raw.hsType
  if (raw.repeater === true) out.repeater = true
  if (raw.keep === true) out.keep = true
  const spec = specObj(raw.spec)
  if (spec) out.spec = spec
  // Simple values are checked by type; groups, lists and HubSpot-only types as bounded JSON.
  const one = (v: unknown) => fieldDefault(type, v)
  const d =
    type === 'group' || type === 'json' || ['url', 'file', 'font', 'alignment', 'textalignment', 'backgroundimage'].includes(type)
      ? raw.default === undefined
        ? undefined
        : safeJson(raw.default)
      : out.repeater && Array.isArray(raw.default)
        ? (raw.default.slice(0, 50).map(one).filter((x) => x !== undefined) as Json[])
        : one(raw.default)
  if (d !== undefined) out.default = d
  if (type === 'choice') {
    out.options = (Array.isArray(raw.options) ? raw.options : [])
      .slice(0, 60)
      .map((o) => (isObj(o) && typeof o.value === 'string' && CHOICE_VALUE.test(o.value) ? { value: o.value, label: stripTags(str(o.label, 120)) || o.value } : null))
      .filter((o): o is { value: string; label: string } => !!o)
    if (!out.options.length) return null
    if (!out.repeater && (typeof out.default !== 'string' || !out.options.some((o) => o.value === out.default))) out.default = out.options[0].value
  }
  if (type === 'group') {
    out.children = (Array.isArray(raw.children) ? raw.children : []).slice(0, 40).map((c) => extraField(c, depth + 1)).filter((c): c is ExtraField => !!c)
  }
  return out
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
    ...(t.vml === true ? { vml: true } : {}),
    ...(typeof t.pad === 'number' && Number.isFinite(t.pad) ? { pad: Math.round(Math.min(120, Math.max(0, t.pad))) } : {}),
    ...(() => {
      const seen = new Set<string>()
      const fields = (Array.isArray(t.fields) ? t.fields : [])
        .slice(0, 60)
        .map((f) => extraField(f))
        .filter((f): f is ExtraField => !!f && !seen.has(f.name) && !!seen.add(f.name))
      return fields.length ? { fields } : {}
    })(),
  }
}
