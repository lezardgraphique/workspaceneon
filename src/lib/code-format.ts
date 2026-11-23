// Layout of a module's own code (module.html with its HuBL, module.css):
// indentation only, never the content. HTML/HuBL lines are re-indented from
// the nesting of block tags and of {% if %} / {% for %}…; CSS is written one
// declaration per line. Strings, <pre>, <script>, <style>, <textarea> and
// {% raw %} keep their text as it is.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const KEEP = /^(pre|script|style|textarea)$/i
const OPENERS = /^(if|for|macro|unless|with|block|call|filter|raw|autoescape)$/
const MIDDLE = /^(elif|else|elseif|empty)$/

const mask = (s: string) => s.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g, (m) => 'x'.repeat(m.length))

interface LineInfo {
  /** Nesting change of the line. */
  delta: number
  /** The line starts by closing something (dedented itself). */
  closesFirst: boolean
  /** else / elif: one step out for this line only. */
  middle: boolean
}

function lineInfo(line: string): LineInfo {
  const t = line.trim()
  const masked = mask(t)
  // HTML tags, read on the masked line (a '>' inside HuBL never ends a tag);
  // a tag named by HuBL (<{{ heading }}>) shows as <xxxx in the mask.
  const items: { at: number; d: number; middle?: boolean }[] = []
  const spans: [number, number][] = []
  for (const m of masked.matchAll(/<(\/?)([a-zA-Z][\w:-]*|x+)([^<>]*?)(\/?)>/g)) {
    const at = m.index ?? 0
    spans.push([at, at + m[0].length])
    const name = /^x+$/.test(m[2]) ? '{{' : m[2].toLowerCase()
    items.push({ at, d: m[1] ? -1 : m[4] || VOID.has(name) ? 0 : 1 })
  }
  // HuBL statements outside tags (those inside a tag are balanced within it).
  for (const m of t.matchAll(/\{%-?\s*(\w+)[\s\S]*?-?%\}/g)) {
    const at = m.index ?? 0
    if (spans.some(([a, b]) => at > a && at < b)) continue
    const k = m[1]
    items.push({ at, d: /^end/.test(k) ? -1 : OPENERS.test(k) ? 1 : 0, middle: MIDDLE.test(k) })
  }
  items.sort((a, b) => a.at - b.at)
  const first = items[0]
  return {
    delta: items.reduce((n, x) => n + x.d, 0),
    closesFirst: !!first && first.d < 0 && first.at === 0,
    middle: !!first && !!first.middle && first.at === 0,
  }
}

/** module.html re-indented (2 spaces), contents untouched. */
export function formatTemplate(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let depth = 0
  let keep: string | null = null
  let inTag = false
  for (const raw of lines) {
    const t = raw.trim()
    // Inside <pre>/<script>/<style>/<textarea>/{% raw %}: as written.
    if (keep) {
      out.push(raw.replace(/\s+$/, ''))
      const end = new RegExp(`</${keep}\\s*>|\\{%-?\\s*endraw`, 'i').exec(raw)
      if (end) {
        keep = null
        // Its closing (and what follows on the line) counts.
        depth = Math.max(0, depth + lineInfo(raw.slice(end.index)).delta)
      }
      continue
    }
    if (!t) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    // Continuation of a tag written over several lines: one step further.
    if (inTag) {
      out.push(`${'  '.repeat(depth + 1)}${t}`)
      const m = mask(t)
      const gt = m.indexOf('>')
      if (gt >= 0) {
        inTag = false
        // <x … /> : its opening counted for nothing.
        if (m[gt - 1] === '/') depth = Math.max(0, depth - 1)
        // What follows the tag on this line (text, closing tags…).
        depth = Math.max(0, depth + lineInfo(t.slice(gt + 1)).delta)
      }
      continue
    }
    const info = lineInfo(t)
    const here = Math.max(0, depth + (info.closesFirst ? -1 : 0) + (info.middle ? -1 : 0))
    out.push(`${'  '.repeat(here)}${t}`)
    depth = Math.max(0, depth + info.delta)
    const m = mask(t)
    const open = /<([a-zA-Z][\w:-]*|\{\{)/.exec(m)
    const opener = /<(pre|script|style|textarea)\b/i.exec(m)
    if (opener && !new RegExp(`</${opener[1]}\\s*>`, 'i').test(m)) keep = opener[1]
    else if (/\{%-?\s*raw\s*-?%\}/.test(t) && !/endraw/.test(t)) keep = 'raw'
    // A tag left open at the end of the line (attributes on the next lines).
    const lastLt = m.lastIndexOf('<')
    if (open && lastLt >= 0 && m.indexOf('>', lastLt) < 0 && /^<\/?([a-zA-Z{])/.test(m.slice(lastLt))) {
      inTag = true
      const name = /^<\/?([a-zA-Z][\w:-]*|\{\{)/.exec(t.slice(lastLt))?.[1]?.toLowerCase() ?? ''
      // Its opening counts now (its '>' comes later).
      if (!m.slice(lastLt).startsWith('</') && !VOID.has(name) && !KEEP.test(name)) depth += 1
      else if (m.slice(lastLt).startsWith('</')) depth = Math.max(0, depth - 1)
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

/** module.css written one rule per block, one declaration per line. */
export function formatCss(css: string): string {
  let out = ''
  let depth = 0
  let buf = ''
  const pad = () => '  '.repeat(depth)
  const flush = (end: string) => {
    // « prop:value » → « prop: value » (first colon of a declaration only).
    const t = buf.replace(/\s+/g, ' ').trim().replace(/^([\w-]+)\s*:\s*/, end === ';' ? '$1: ' : '$1:')
    buf = ''
    if (t) out += `${pad()}${t}${end}\n`
  }
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    // Comments and strings are copied as they are.
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end < 0 ? css.length : end + 2
      flush('')
      out += `${pad()}${css.slice(i, stop).trim()}\n`
      i = stop - 1
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1
      buf += css.slice(i, j + 1)
      i = j
      continue
    }
    if (c === '{') {
      const sel = buf.replace(/\s+/g, ' ').trim()
      buf = ''
      out += `${pad()}${sel} {\n`
      depth++
    } else if (c === '}') {
      flush(';')
      depth = Math.max(0, depth - 1)
      out += `${pad()}}\n`
      if (depth === 0) out += '\n'
    } else if (c === ';') flush(';')
    else buf += c
  }
  flush('')
  return out.replace(/;;\n/g, ';\n').replace(/\n{3,}/g, '\n\n').trim()
}
