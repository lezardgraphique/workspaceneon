import { Parser } from 'htmlparser2'

// Strict HTML sanitizer shared by the server (before anything is stored) and
// the browser (before anything is shown in the app's own DOM). Allow-list based:
// unknown tags are dropped, only known attributes survive, URLs and inline
// styles are filtered, and the output is re-serialised from scratch (never the
// input string), so what the browser re-parses is what was checked.
//
// HuBL ({{ … }}, {% … %}) is kept: it only appears in text, in URL / style
// values, or as valueless attributes inside a tag, none of which can run code.

const TAGS = new Set(
  (
    'a abbr b blockquote br caption center code col colgroup dd div dl dt em figcaption figure font h1 h2 h3 h4 h5 h6 hr i img ' +
    'li ol p pre q s small span strong sub sup table tbody td tfoot th thead tr u ul'
  ).split(' '),
)
const VOID = new Set(['br', 'col', 'hr', 'img'])
// Their content is never kept, even as text.
const DROP_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'title', 'svg', 'math', 'select', 'option', 'xmp', 'plaintext', 'noembed', 'noframes'])

const ATTRS = new Set(
  (
    'align valign width height bgcolor border cellpadding cellspacing colspan rowspan color face size nowrap scope headers ' +
    'class style title lang dir role alt href src background target rel loading type start span summary'
  ).split(' '),
)
const URL_ATTRS = new Set(['href', 'src', 'background'])

// URL kept as is when it is relative, a template, or one of these schemes.
const SAFE_SCHEME = /^(https?|mailto|tel|sms):/i
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i
// Characters browsers skip inside a URL scheme (control, space, zero-width, line separators).
const IGNORED = new RegExp('[\\u0000-\\u0020\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\ufeff]', 'g')

export function isSafeUrl(value: string, allowDataImage = false): boolean {
  // Browsers ignore control characters and spaces inside the scheme.
  const v = value.replace(IGNORED, '')
  if (!v) return true
  if (/^(\{\{|\{%|#|\/(?!\/)|\.\.?\/|\?)/.test(v)) return true
  if (allowDataImage && DATA_IMAGE.test(v)) return true
  if (SAFE_SCHEME.test(v)) return true
  // Anything else with a scheme (javascript:, data:, vbscript:…) is refused.
  return !ANY_SCHEME.test(v)
}

const HUBL = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g
const BAD_CSS = /url\s*\(|expression|javascript|vbscript|@import|behavior|binding|\\|<|>|\/\*|\bimage-set\b|\battr\s*\(/i
const BAD_PROPS = new Set(['position', 'z-index', 'behavior', '-moz-binding', 'content', 'filter', 'backdrop-filter', 'cursor', 'pointer-events', 'mask', 'mask-image', 'list-style-image'])

// Keeps the declarations that can't load anything, run anything or cover the page.
export function sanitizeStyle(style: string): string {
  const out: string[] = []
  for (const decl of style.split(/;(?![^(]*\))/)) {
    const i = decl.indexOf(':')
    if (i < 1) continue
    const prop = decl.slice(0, i).trim().toLowerCase()
    const value = decl.slice(i + 1).trim()
    if (!/^[a-z-]+$/.test(prop) || BAD_PROPS.has(prop)) continue
    // Template tokens are allowed, but what is around them is checked.
    if (!value || BAD_CSS.test(value.replace(HUBL, ' '))) continue
    if (/[{}]/.test(value.replace(HUBL, ' '))) continue
    out.push(`${prop}:${value}`)
  }
  return out.join(';')
}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Valueless attributes are kept (HuBL statements inside a tag arrive as words)
// unless they look like an event handler or something dangerous.
const WORD = /^[^\s"'<>/=`\u0000-\u001f]{1,60}$/
const BLOCKED_WORD = /^(on|xmlns|formaction|srcdoc|action|ping|is$|slot$|popover|autofocus)/i

// HuBL tokens are swapped for placeholders before parsing (so a `>` or a quote
// inside {% … %} can't derail the parser) and put back in the output, escaped
// for the place where they land.
const PH_OPEN = ''
const PH_CLOSE = ''
const PH = /(\d+)/g
const PH_ONLY = /^(\d+)$/

// In a text node a token can't contain something a browser would read as a tag.
const textToken = (t: string) => (/<[a-zA-Z/!?]/.test(t) ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : t)
// In tag position (between attributes) a token must not be able to end the tag or open a value.
const tagTokenOk = (t: string) => !/[<>"'`]/.test(t)

const cache = new Map<string, string>()

export function sanitizeHtml(html: string): string {
  if (!html) return ''
  const hit = cache.get(html)
  if (hit !== undefined) return hit

  const tokens: string[] = []
  const source = html
    .replace(/[]/g, '')
    .replace(/\{#[\s\S]*?#\}/g, '')
    .replace(HUBL, (t) => `${PH_OPEN}${tokens.push(t) - 1}${PH_CLOSE}`)
  const back = (s: string, fn: (t: string) => string) => s.replace(PH, (_m, i: string) => fn(tokens[Number(i)]))

  let out = ''
  // Open allowed tags, plus a depth counter for dropped-content elements.
  const stack: string[] = []
  let dropDepth = 0
  let dropTag = ''

  // Attribute value → ` name="value"`, quoting so tokens containing quotes stay valid.
  const attr = (k: string, value: string) => {
    const v = back(value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), (t) => t)
    if (!v.includes('"')) return ` ${k}="${v}"`
    if (!v.includes("'")) return ` ${k}='${v}'`
    return ` ${k}="${v.replace(/"/g, '&quot;')}"`
  }

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (dropDepth) {
          if (name === dropTag) dropDepth++
          return
        }
        if (DROP_CONTENT.has(name)) {
          dropDepth = 1
          dropTag = name
          return
        }
        if (!TAGS.has(name)) return
        let attrs = ''
        // Links opening a new tab always get rel=noopener noreferrer.
        const blank = /^_blank$/i.test(attribs.target ?? '')
        let relEmitted = false
        const relValue = (v: string) => {
          const set = new Set(v.split(/\s+/).filter(Boolean))
          if (blank) ['noopener', 'noreferrer'].forEach((r) => set.add(r))
          return [...set].join(' ')
        }
        for (const [key, value] of Object.entries(attribs)) {
          const k = key.toLowerCase()
          // A bare token between attributes: {% if x %} … {% endif %}
          const bare = PH_ONLY.exec(k)
          if (bare && value === '') {
            const t = tokens[Number(bare[1])]
            if (tagTokenOk(t)) attrs += ` ${t}`
            continue
          }
          // `{% if x %}rel="nofollow"{% endif %}`: tokens glued to a real attribute name.
          const parts = k.split(/(\uE000\d+\uE001)/).filter(Boolean)
          const isTok = (x: string) => PH_ONLY.test(x)
          const firstName = parts.findIndex((x) => !isTok(x))
          const lastName = parts.length - 1 - [...parts].reverse().findIndex((x) => !isTok(x))
          const base = parts.filter((x) => !isTok(x)).join('')
          const tok = (x: string) => {
            const t = tokens[Number(PH_ONLY.exec(x)![1])]
            return tagTokenOk(t) ? ` ${t}` : ''
          }
          const hasTok = parts.some(isTok)
          const before = hasTok && firstName > 0 ? parts.slice(0, firstName).map(tok).join('') : ''
          const after = hasTok && lastName < parts.length - 1 ? parts.slice(lastName + 1).map(tok).join('') : ''
          if (hasTok && firstName < 0) {
            attrs += parts.map(tok).join('')
            continue
          }
          if (/^on/i.test(base) || BLOCKED_WORD.test(base)) {
            attrs += before + after
            continue
          }
          const isData = /^data-[a-z0-9-]+$/.test(base)
          const isAria = /^aria-[a-z-]+$/.test(base)
          if (value === '' && !ATTRS.has(base) && !isData && !isAria) {
            attrs += before + (WORD.test(base) ? ` ${base}` : '') + after
            continue
          }
          if (!ATTRS.has(base) && !isData && !isAria) {
            attrs += before + after
            continue
          }
          let v = value
          if (URL_ATTRS.has(base)) {
            const plain = back(v, (t) => t)
            const dynamicStart = PH_OPEN === v[0]
            if (!dynamicStart && !isSafeUrl(plain.replace(HUBL, ''), name === 'img' && base === 'src')) {
              attrs += before + after
              continue
            }
          }
          if (base === 'style') {
            // Filter the declarations; tokens stay as they are.
            v = back(v, (t) => t)
            v = sanitizeStyle(v)
            if (!v) {
              attrs += before + after
              continue
            }
            v = v.replace(HUBL, (t) => `${PH_OPEN}${tokens.push(t) - 1}${PH_CLOSE}`)
          }
          if (base === 'target') {
            if (!/^(_blank|_self)$/i.test(v)) {
              attrs += before + after
              continue
            }
          }
          if (base === 'rel') {
            relEmitted = true
            const merged = relValue(back(v, (t) => t).replace(/[^\w\s{}%#.|"'()-]/g, ''))
            attrs += before + attr('rel', merged.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, (t) => `${PH_OPEN}${tokens.push(t) - 1}${PH_CLOSE}`)) + after
            continue
          }
          if (base === 'type' && name !== 'ol') {
            attrs += before + after
            continue
          }
          attrs += before + attr(base, v) + after
        }
        if (blank && !relEmitted) attrs += ` rel="${relValue('')}"`
        out += `<${name}${attrs}>`
        if (!VOID.has(name)) stack.push(name)
      },
      onclosetag(name) {
        if (dropDepth) {
          if (name === dropTag && --dropDepth === 0) dropTag = ''
          return
        }
        if (!TAGS.has(name) || VOID.has(name)) return
        const i = stack.lastIndexOf(name)
        if (i < 0) return
        // Close anything left open inside, then the tag itself.
        while (stack.length > i) out += `</${stack.pop()}>`
      },
      ontext(text) {
        if (!dropDepth) out += back(escText(text), (t) => textToken(t))
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: false },
  )
  parser.write(source)
  parser.end()
  while (stack.length) out += `</${stack.pop()}>`

  if (cache.size > 400) cache.clear()
  cache.set(html, out)
  return out
}

// Plain text value (heading text, labels): tags removed, no markup kept.
export function stripTags(s: string): string {
  return sanitizeHtml(s).replace(/<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/gi, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
