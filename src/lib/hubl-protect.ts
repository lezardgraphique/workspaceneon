// Keeps HuBL where it was written when markup goes through the browser's HTML
// parser (DOMParser), which would otherwise:
// - move text out of tables: `{% for %}` between two <tr> lands *before* the
//   table ("foster parenting"), so a repeated row is no longer repeated;
// - split a statement written inside a tag (`<a {% if x %}target="_blank"{% endif %}>`)
//   into junk attributes.
// Tokens between tags become comments (comments stay in place, even in a table)
// and are turned back into text nodes right after parsing. Statements inside a
// tag become `data-nsp-t<n>` attributes, swapped back in the final strings.

const TOKEN = /\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/y
const COMMENT = /^nsp-hubl:(\d+)$/
const ATTR = / ?data-nsp-t(\d+)(?:=(?:""|''))?/g

export interface Protected {
  html: string
  tokens: string[]
}

export function protectHubl(src: string): Protected {
  const tokens: string[] = []
  let out = ''
  let i = 0
  let inTag = false
  let quote = ''
  // Raw-text elements: their content is not markup, leave it untouched.
  let rawUntil = ''
  while (i < src.length) {
    if (rawUntil) {
      const end = src.toLowerCase().indexOf(rawUntil, i)
      const stop = end < 0 ? src.length : end
      out += src.slice(i, stop)
      i = stop
      rawUntil = ''
      continue
    }
    if (src[i] === '{' && (src[i + 1] === '%' || src[i + 1] === '{')) {
      TOKEN.lastIndex = i
      const m = TOKEN.exec(src)
      if (m) {
        const t = m[0]
        if (inTag && !quote) {
          // Only statements need protecting inside a tag; {{ }} there is a value.
          out += t.startsWith('{%') ? ` data-nsp-t${tokens.push(t) - 1}` : t
        } else if (!inTag) out += `<!--nsp-hubl:${tokens.push(t) - 1}-->`
        else out += t
        i += t.length
        continue
      }
    }
    const c = src[i]
    if (!inTag) {
      if (c === '<' && src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4)
        const stop = end < 0 ? src.length : end + 3
        out += src.slice(i, stop)
        i = stop
        continue
      }
      if (c === '<' && /[a-zA-Z/!?]/.test(src[i + 1] ?? '')) {
        inTag = true
        const name = /^<([a-zA-Z][\w-]*)/.exec(src.slice(i, i + 20))?.[1]?.toLowerCase()
        if (name && ['style', 'script', 'textarea', 'title'].includes(name)) rawUntil = `</${name}`
      }
    } else if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '>') {
      inTag = false
      if (rawUntil) {
        out += c
        i++
        continue
      }
    }
    out += c
    i++
  }
  return { html: out, tokens }
}

// Right after parsing: the comments become text again, in place.
export function restoreDom(root: Node, tokens: string[]) {
  if (!tokens.length) return
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, 0x80 /* SHOW_COMMENT */)
  const found: Comment[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) found.push(n as Comment)
  for (const c of found) {
    const m = COMMENT.exec(c.data)
    if (m) c.replaceWith(doc.createTextNode(tokens[Number(m[1])]))
  }
}

// In the strings taken from the DOM: the attributes become statements again.
export const restoreAttrs = (s: string, tokens: string[]) => (tokens.length && s.includes('data-nsp-t') ? s.replace(ATTR, (_m, n: string) => ` ${tokens[Number(n)]}`) : s)

// Every string of a parsed tree (block html, labels, links…).
export function restoreTree<T>(value: T, tokens: string[]): T {
  if (!tokens.length) return value
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return restoreAttrs(v, tokens)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(value) as T
}
