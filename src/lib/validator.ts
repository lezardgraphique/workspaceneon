import { toFieldName } from './fields'

// Code validator: checks the module code (HTML + HuBL) and gives every issue it
// can repair its own exact correction (`fix`): edits at precise offsets of the
// code (a missing {% endif %} goes right before the end of the element where the
// block was opened, a stray closer is removed, an unfinished {{ x } becomes
// {{ x }}…), so one issue can be fixed alone and the rest of the code is kept
// byte for byte. Pure functions, no DOM: usable in the editor, in Maily's
// checks and in tests.

export type Severity = 'error' | 'warning'

/** Replace `code.slice(from, to)` by `text` (from = to: insertion). */
export interface CodeEdit {
  from: number
  to: number
  text: string
  /** Several insertions at the same offset: the lowest order comes first in the code. */
  order?: number
}

export interface IssueFix {
  /** What the button does, in plain words (« Ajouter {% endif %} ligne 12 »). */
  label: string
  edits: CodeEdit[]
  /** Mechanical, keeps every piece of content and logic: applied by « Corriger » everywhere (import, Maily, reformat). */
  safe: boolean
}

export interface CodeIssue {
  severity: Severity
  line: number
  message: string
  /** An exact correction exists for this issue (same as `!!fix`). */
  fixable?: boolean
  fix?: IssueFix
}

export interface LintResult {
  issues: CodeIssue[]
  errors: number
  warnings: number
  ok: boolean
}

interface Token {
  kind: 'expr' | 'stmt' | 'comment'
  start: number
  end: number
  body: string
  /** Raw text between the delimiters. */
  innerStart: number
  innerEnd: number
}

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))
const NEON_TYPES = ['module', 'section', 'column', 'heading', 'text', 'button', 'image', 'divider', 'spacer', 'raw']
const NEON_SET = new Set(NEON_TYPES)

// Statements that open a block and the one that closes it.
const BLOCKS: Record<string, string> = {
  if: 'endif',
  unless: 'endunless',
  for: 'endfor',
  macro: 'endmacro',
  block: 'endblock',
  call: 'endcall',
  raw: 'endraw',
  widget_block: 'end_widget_block',
  scope_css: 'end_scope_css',
  require_css: 'end_require_css',
  require_js: 'end_require_js',
  set: 'endset',
}
const CLOSERS = new Map(Object.entries(BLOCKS).map(([open, close]) => [close, open]))

const blank = (s: string) => s.replace(/[^\n]/g, ' ')

function lineFinder(code: string) {
  const starts = [0]
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) starts.push(i + 1)
  return (offset: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

// A real tag (not a comparison such as `a<b`).
const TAG_START = /^(?:<!--|<\/?[a-zA-Z][\w:-]*(?:\s[^<>]*)?\/?>)/
// Where an unfinished {{ … / {% … obviously stops: another HuBL opener or an
// HTML tag outside quotes (or a line break when no closer comes at all).
function breakPoint(s: string, atNewline: boolean): number {
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      else if (c === '\n') quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '{' && /[{%#]/.test(s[i + 1] ?? '')) return i
    else if (c === '<' && TAG_START.test(s.slice(i, i + 400))) return i
    else if (atNewline && c === '\n') return i
  }
  return -1
}

// A wrong closer typed instead of the right one (`{{ x }`, `{% if x }}`,
// `{{ x %}`), outside quotes and dict braces: [start, end] in `s`.
function wrongCloser(s: string, kind: Token['kind']): [number, number] | null {
  let quote = ''
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '{') depth++
    else if (c === '}' && depth > 0) depth--
    else if (c === '}') return [i, s[i + 1] === '}' ? i + 2 : i + 1]
    else if (c === '%' && s[i + 1] === '}' && kind !== 'stmt') return [i, i + 2]
    else if (c === '#' && s[i + 1] === '}' && kind !== 'comment') return [i, i + 2]
    else if (kind === 'stmt' && c === '%' && /^\s*$/.test(s.slice(i + 1))) return [i, i + 1]
  }
  return null
}

// Splits out {{ }}, {% %} and {# #}. An unfinished opener is reported with the
// exact repair (closer added where its content stops) and parsing goes on.
function tokenize(code: string, issues: CodeIssue[], lineAt: (n: number) => number): Token[] {
  const tokens: Token[] = []
  const open = /\{[{%#]/g
  let from = 0
  for (;;) {
    open.lastIndex = from
    const m = open.exec(code)
    if (!m) break
    const kind = m[0] === '{{' ? 'expr' : m[0] === '{%' ? 'stmt' : 'comment'
    const close = kind === 'expr' ? '}}' : kind === 'stmt' ? '%}' : '#}'
    const innerStart = m.index + 2
    const at = code.indexOf(close, innerStart)
    const inner = at < 0 ? code.slice(innerStart) : code.slice(innerStart, at)
    // A comment may hold anything; {{ }} and {% %} stop at the next opener or tag.
    let cut = kind === 'comment' ? (at < 0 ? breakPoint(inner, true) : -1) : breakPoint(inner, at < 0)
    if (cut < 0 && at < 0) cut = inner.length
    if (cut >= 0) {
      const part = inner.slice(0, cut)
      const wrong = wrongCloser(part, kind)
      const trimmed = part.replace(/\s+$/, '').length
      const contentEnd = innerStart + (wrong ? part.slice(0, wrong[0]).replace(/\s+$/, '').length : trimmed)
      const partEnd = innerStart + (wrong ? wrong[1] : trimmed)
      const body = code.slice(innerStart, contentEnd).replace(/^-/, '').trim()
      const fixEdit: CodeEdit = wrong
        ? { from: contentEnd, to: partEnd, text: ` ${close}` }
        : { from: partEnd, to: partEnd, text: ` ${close}` }
      issues.push({
        severity: 'error',
        line: lineAt(m.index),
        message: `${m[0]} n'est jamais refermé (manque ${close})`,
        fix: {
          label: wrong ? `Remplacer « ${part.slice(wrong[0], wrong[1])} » par ${close}` : `Ajouter ${close} après « ${body.slice(-24) || m[0]} »`,
          edits: [fixEdit],
          safe: true,
        },
      })
      // Read on as if it were closed, so the rest of the code is still checked.
      tokens.push({ kind, start: m.index, end: partEnd, body, innerStart, innerEnd: contentEnd })
      from = Math.max(partEnd, innerStart)
      continue
    }
    const end = at + 2
    const body = inner.replace(/^-/, '').replace(/-$/, '').trim()
    tokens.push({ kind, start: m.index, end, body, innerStart, innerEnd: at })
    from = end
    // `{% raw %}` keeps everything up to `{% endraw %}` untouched.
    if (kind === 'stmt' && /^raw$/.test(body)) {
      const e = /\{%-?\s*endraw\s*-?%\}/.exec(code.slice(from))
      if (e) {
        if (e.index) tokens.push({ kind: 'comment', start: from, end: from + e.index, body: '', innerStart: from, innerEnd: from + e.index })
        from += e.index
      }
    }
  }
  return tokens
}

// End of the meaningful content inside a token (before a whitespace-control
// dash and the spaces in front of the closer).
function contentEnd(code: string, t: Token): number {
  let e = t.innerEnd
  if (code[e - 1] === '-' && e - 1 > t.innerStart) e--
  while (e > t.innerStart && /\s/.test(code[e - 1])) e--
  return e
}

// Unbalanced quotes or brackets inside {{ … }} / {% … %}.
function checkInside(code: string, t: Token, issues: CodeIssue[], line: number) {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const match: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const where = t.kind === 'expr' ? '{{ … }}' : '{% … %}'
  const stack: string[] = []
  let quote = ''
  for (let i = t.innerStart; i < t.innerEnd; i++) {
    const c = code[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if ('([{'.includes(c)) stack.push(c)
    else if (c in pairs) {
      if (stack.at(-1) !== pairs[c]) {
        issues.push({
          severity: 'error',
          line,
          message: `Parenthèse ou crochet « ${c} » en trop dans ${where}`,
          fix: { label: `Retirer le « ${c} » en trop`, edits: [{ from: i, to: i + 1, text: '' }], safe: true },
        })
        return
      }
      stack.pop()
    }
  }
  const end = contentEnd(code, t)
  const closers = stack.map((c) => match[c]).reverse().join('')
  if (quote) {
    issues.push({
      severity: 'error',
      line,
      message: `Guillemet ${quote} non fermé dans ${where}`,
      fix: { label: `Fermer le guillemet ${quote}${closers ? ` puis ${closers}` : ''}`, edits: [{ from: end, to: end, text: quote + closers }], safe: true },
    })
  } else if (stack.length) {
    issues.push({
      severity: 'error',
      line,
      message: `Parenthèse ou crochet « ${stack.at(-1)} » non fermé dans ${where}`,
      fix: { label: `Ajouter « ${closers} » en fin d'instruction`, edits: [{ from: end, to: end, text: closers }], safe: true },
    })
  }
}

// ---- HTML structure ----------------------------------------------------------

interface HtmlEvent {
  kind: 'open' | 'close'
  name: string
  start: number
  end: number
}

interface HtmlScan {
  events: HtmlEvent[]
  unterminated: { name: string; start: number; end: number }[]
  /** Opening tag start → its closing event. */
  closeOf: Map<number, HtmlEvent>
  strays: HtmlEvent[]
  /** Elements implicitly closed by a closer of an outer element. */
  skipped: { open: HtmlEvent; before: HtmlEvent }[]
  unclosed: HtmlEvent[]
}

function scanHtml(masked: string): HtmlScan {
  const events: HtmlEvent[] = []
  const unterminated: HtmlScan['unterminated'] = []
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^<>"'])*)(>?)/g
  for (const m of masked.matchAll(tag)) {
    const [whole, slash, rawName, , end] = m
    const name = rawName.toLowerCase()
    if (!end) {
      unterminated.push({ name, start: m.index, end: m.index + whole.replace(/\s+$/, '').length })
      continue
    }
    if (!slash && (VOID.has(name) || whole.endsWith('/>'))) continue
    events.push({ kind: slash ? 'close' : 'open', name, start: m.index, end: m.index + whole.length })
  }
  const closeOf = new Map<number, HtmlEvent>()
  const strays: HtmlEvent[] = []
  const skipped: HtmlScan['skipped'] = []
  const stack: HtmlEvent[] = []
  for (const e of events) {
    if (e.kind === 'open') {
      stack.push(e)
      continue
    }
    if (VOID.has(e.name)) continue
    const idx = stack.map((s) => s.name).lastIndexOf(e.name)
    if (idx < 0) {
      strays.push(e)
      continue
    }
    const popped = stack.splice(idx)
    closeOf.set(popped[0].start, e)
    for (const s of popped.slice(1)) skipped.push({ open: s, before: e })
  }
  return { events, unterminated, closeOf, strays, skipped, unclosed: stack }
}

// Offset of the closing tag of the element that contains `pos` (null: none).
function parentClose(events: HtmlEvent[], pos: number): number | null {
  const stack: string[] = []
  let i = 0
  for (; i < events.length && events[i].start < pos; i++) {
    const e = events[i]
    if (e.kind === 'open') stack.push(e.name)
    else {
      const idx = stack.lastIndexOf(e.name)
      if (idx >= 0) stack.splice(idx)
    }
  }
  const depth = stack.length
  if (!depth) return null
  for (; i < events.length; i++) {
    const e = events[i]
    if (e.kind === 'open') {
      stack.push(e.name)
      continue
    }
    const idx = stack.lastIndexOf(e.name)
    if (idx < 0) continue
    if (idx < depth) return e.start
    stack.splice(idx)
  }
  return null
}

// Closest known value (typos such as « headng »), or nothing.
function closest(value: string, options: string[]): string | undefined {
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0]
      d[0] = i
      for (let j = 1; j <= b.length; j++) {
        const tmp = d[j]
        d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
        prev = tmp
      }
    }
    return d[b.length]
  }
  const v = value.trim().toLowerCase()
  const best = options.map((o) => ({ o, d: dist(v, o) })).sort((a, b) => a.d - b.d)[0]
  return best && best.d <= Math.max(1, Math.floor(best.o.length / 3)) ? best.o : undefined
}

interface OpenBlock {
  name: string
  token: Token
  branches: Token[]
  closer?: Token
  /** Issues whose fix needs the whole block (filled once its closer is known). */
  pending: ((b: OpenBlock) => void)[]
}

export function lintCode(code: string): LintResult {
  const issues: CodeIssue[] = []
  const lineAt = lineFinder(code)

  if (!code.trim()) {
    issues.push({ severity: 'error', line: 1, message: 'Le code est vide' })
    return { issues, errors: 1, warnings: 0, ok: false }
  }

  const tokens = tokenize(code, issues, lineAt)
  // Mask everything that isn't markup, keeping offsets (and so line numbers).
  const parts: string[] = []
  let last = 0
  for (const t of tokens) {
    parts.push(code.slice(last, t.start), blank(code.slice(t.start, t.end)))
    last = t.end
  }
  parts.push(code.slice(last))
  const masked = parts
    .join('')
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_m, o: string, _n: string, body: string, c: string) => o + blank(body) + c)
  const html = scanHtml(masked)
  const endOfCode = code.replace(/\s+$/, '').length
  let seq = 0
  // Where a missing closer for something opened at `pos` belongs.
  const closeSpot = (pos: number) => {
    const at = parentClose(html.events, pos)
    return at ?? endOfCode
  }
  const insertAt = (at: number, text: string): CodeEdit => ({ from: at, to: at, text: at === endOfCode && at > 0 ? `\n${text}` : text, order: seq++ })
  const remove = (t: { start: number; end: number }): CodeEdit => ({ from: t.start, to: t.end, text: '' })

  // --- HuBL statements -----------------------------------------------------
  const stack: OpenBlock[] = []
  // Ranges of {% if %} blocks with several branches (HTML may differ between branches).
  const branchy: [number, number][] = []
  for (const t of tokens) {
    if (t.kind === 'comment') continue
    const line = lineAt(t.start)
    if (!t.body) {
      issues.push({
        severity: t.kind === 'expr' ? 'warning' : 'error',
        line,
        message: t.kind === 'expr' ? 'Variable {{ }} vide' : 'Instruction {% %} vide',
        fix: { label: 'Supprimer la balise vide', edits: [remove(t)], safe: true },
      })
      continue
    }
    checkInside(code, t, issues, line)
    if (t.kind !== 'stmt') continue

    const [name, ...restParts] = t.body.split(/\s+/)
    const rest = restParts.join(' ')
    if (name in BLOCKS) {
      // `{% set x = 1 %}` is a statement, only `{% set x %}` opens a block.
      if (name === 'set' && /=/.test(rest)) continue
      const block: OpenBlock = { name, token: t, branches: [], pending: [] }
      if ((name === 'if' || name === 'unless') && !rest) {
        const issue: CodeIssue = { severity: 'error', line, message: `{% ${name} %} sans condition` }
        issues.push(issue)
        block.pending.push((b) => (issue.fix = unwrap(b, `Retirer ce {% ${name} %} vide (garder le contenu de sa première branche)`)))
      }
      if (name === 'for' && !/\S\s+in\s+\S/.test(rest)) {
        const issue: CodeIssue = { severity: 'error', line, message: '{% for %} doit avoir la forme {% for x in liste %}' }
        issues.push(issue)
        block.pending.push((b) => (issue.fix = unwrap(b, 'Retirer la boucle incomplète (garder son contenu une fois)')))
      }
      stack.push(block)
    } else if (CLOSERS.has(name)) {
      const expected = CLOSERS.get(name)!
      const idx = stack.map((s) => s.name).lastIndexOf(expected)
      if (idx < 0) {
        issues.push({
          severity: 'error',
          line,
          message: `{% ${name} %} sans {% ${expected} %} correspondant`,
          fix: { label: `Supprimer ce {% ${name} %} en trop`, edits: [remove(t)], safe: true },
        })
      } else {
        const popped = stack.splice(idx)
        // Blocks left open between the opener and this closer: closed right before it.
        for (const open of popped.slice(1).reverse()) {
          issues.push({
            severity: 'error',
            line: lineAt(open.token.start),
            message: `{% ${open.name} %} n'est pas refermé avant {% ${name} %} (manque {% ${BLOCKS[open.name]} %})`,
            fix: { label: `Ajouter {% ${BLOCKS[open.name]} %} juste avant {% ${name} %} (ligne ${line})`, edits: [insertAt(t.start, `{% ${BLOCKS[open.name]} %}`)], safe: true },
          })
          open.pending.forEach((f) => f(open))
        }
        const done = popped[0]
        done.closer = t
        if (done.branches.length) branchy.push([done.token.start, t.end])
        done.pending.forEach((f) => f(done))
      }
    } else if (name === 'elif' || name === 'else') {
      const top = stack.at(-1)
      const topName = top?.name
      if (name === 'elif' && topName !== 'if' && topName !== 'unless') {
        issues.push({ severity: 'error', line, message: "{% elif %} en dehors d'un {% if %}", fix: { label: 'Supprimer ce {% elif %} isolé', edits: [remove(t)], safe: true } })
      } else if (name === 'else' && topName !== 'if' && topName !== 'unless' && topName !== 'for') {
        issues.push({ severity: 'error', line, message: "{% else %} en dehors d'un {% if %} ou {% for %}", fix: { label: 'Supprimer ce {% else %} isolé', edits: [remove(t)], safe: true } })
      } else {
        top!.branches.push(t)
        if (name === 'elif' && !rest) {
          const issue: CodeIssue = { severity: 'error', line, message: '{% elif %} sans condition' }
          issues.push(issue)
          top!.pending.push((b) => {
            const i = b.branches.indexOf(t)
            const later = b.branches.slice(i + 1)
            if (!later.some((x) => /^else\b/.test(x.body))) {
              issue.fix = { label: 'Remplacer par {% else %}', edits: [{ from: t.start, to: t.end, text: '{% else %}' }], safe: false }
            } else {
              const next = later[0] ?? b.closer
              issue.fix = next ? { label: 'Retirer cette branche sans condition', edits: [{ from: t.start, to: next.start, text: '' }], safe: false } : undefined
            }
          })
        }
      }
    }
  }
  for (const open of [...stack].reverse()) {
    const closer = `{% ${BLOCKS[open.name]} %}`
    const at = closeSpot(open.token.end)
    issues.push({
      severity: 'error',
      line: lineAt(open.token.start),
      message: `{% ${open.name} %} n'est jamais refermé (manque ${closer})`,
      fix: { label: `Ajouter ${closer} ${at === endOfCode ? 'à la fin du code' : `avant la fin de l'élément qui le contient (ligne ${lineAt(at)})`}`, edits: [insertAt(at, closer)], safe: true },
    })
    open.pending.forEach((f) => f(open))
  }

  // Keeps the first branch of a block (or its body) without the tags.
  function unwrap(b: OpenBlock, label: string): IssueFix {
    const edits: CodeEdit[] = [remove(b.token)]
    const firstBranch = b.branches[0]
    if (firstBranch) edits.push({ from: firstBranch.start, to: b.closer ? b.closer.end : firstBranch.end, text: '' })
    else if (b.closer) edits.push(remove(b.closer))
    return { label, edits, safe: false }
  }

  // --- HTML ----------------------------------------------------------------
  const inBranch = (pos: number) => branchy.some(([a, b]) => pos > a && pos < b)
  for (const u of html.unterminated) {
    issues.push({
      severity: 'error',
      line: lineAt(u.start),
      message: `La balise <${u.name}> n'est pas terminée (manque >)`,
      fix: { label: `Ajouter > à la fin de <${u.name}>`, edits: [{ from: u.end, to: u.end, text: '>' }], safe: true },
    })
  }
  for (const e of html.strays) {
    // Often legitimate around {% if %} branches, hence a warning.
    issues.push({
      severity: 'warning',
      line: lineAt(e.start),
      message: `</${e.name}> sans <${e.name}> correspondant`,
      fix: { label: `Supprimer ce </${e.name}> en trop`, edits: [remove(e)], safe: !inBranch(e.start) },
    })
  }
  const skippedBy = new Map<HtmlEvent, HtmlEvent[]>()
  for (const s of html.skipped) skippedBy.set(s.before, [...(skippedBy.get(s.before) ?? []), s.open])
  for (const [before, opens] of skippedBy) {
    // Innermost first: it must be closed first.
    for (const o of [...opens].reverse()) {
      issues.push({
        severity: 'warning',
        line: lineAt(o.start),
        message: `<${o.name}> n'est pas refermé avant </${before.name}>`,
        fix: { label: `Ajouter </${o.name}> juste avant </${before.name}> (ligne ${lineAt(before.start)})`, edits: [insertAt(before.start, `</${o.name}>`)], safe: !inBranch(o.start) },
      })
    }
  }
  for (const o of [...html.unclosed].reverse()) {
    issues.push({
      severity: 'warning',
      line: lineAt(o.start),
      message: `<${o.name}> n'est jamais refermé`,
      fix: { label: `Ajouter </${o.name}> à la fin du code`, edits: [insertAt(endOfCode, `</${o.name}>`)], safe: !inBranch(o.start) },
    })
  }

  // Stray closers outside any statement.
  for (const m of masked.matchAll(/%\}|#\}|\}\}/g)) {
    issues.push({
      severity: m[0] === '}}' ? 'warning' : 'error',
      line: lineAt(m.index),
      message: `« ${m[0]} » sans ouverture correspondante`,
      fix: { label: `Supprimer ce « ${m[0]} » en trop`, edits: [{ from: m.index, to: m.index + 2, text: '' }], safe: true },
    })
  }

  // --- Module markers and fields ----------------------------------------------
  const tagAround = (pos: number) => html.events.find((e) => e.kind === 'open' && e.start <= pos && pos < e.end)
  const modules = [...code.matchAll(/data-neon=["']module["']/g)]
  if (modules.length > 1) {
    const first = tagAround(modules[0].index!)
    const second = tagAround(modules[1].index!)
    const firstClose = first && html.closeOf.get(first.start)
    const secondClose = second && html.closeOf.get(second.start)
    let fix: IssueFix | undefined
    if (first && second && firstClose && secondClose) {
      fix =
        second.start < firstClose.start
          ? { label: 'Retirer le second conteneur (son contenu reste dans le premier)', edits: [remove(second), remove(secondClose)], safe: false }
          : {
              label: 'Déplacer le contenu du second module dans le premier',
              edits: [insertAt(firstClose.start, code.slice(second.end, secondClose.start)), { from: second.start, to: secondClose.end, text: '' }],
              safe: false,
            }
    }
    issues.push({ severity: 'error', line: lineAt(modules[1].index!), message: 'Plusieurs data-neon="module" : un seul module par code', fix })
  }
  for (const m of code.matchAll(/data-neon=(["'])([^"']*)\1/g)) {
    if (NEON_SET.has(m[2])) continue
    const valueStart = m.index! + 'data-neon='.length + 1
    const near = closest(m[2], NEON_TYPES)
    issues.push({
      severity: 'warning',
      line: lineAt(m.index!),
      message: `data-neon="${m[2]}" inconnu (attendus : ${NEON_TYPES.join(', ')})`,
      fix: near
        ? { label: `Remplacer par data-neon="${near}"`, edits: [{ from: valueStart, to: valueStart + m[2].length, text: near }], safe: true }
        : { label: 'Remplacer par data-neon="raw" (Bloc HTML)', edits: [{ from: valueStart, to: valueStart + m[2].length, text: 'raw' }], safe: false },
    })
  }
  const fieldRefs = [...code.matchAll(/\sdata-field=(["'])([^"']*)\1/g)]
  const taken = new Set(fieldRefs.map((m) => toFieldName(m[2])))
  const seen = new Map<string, number>()
  for (const m of fieldRefs) {
    const name = m[2]
    const line = lineAt(m.index!)
    const valueStart = m.index! + m[0].length - 1 - name.length
    const norm = toFieldName(name) || 'champ'
    if (norm !== name) {
      // Another field already has (or will get) this name: a free suffix instead.
      let target = norm
      if (fieldRefs.some((r) => r !== m && (toFieldName(r[2]) || 'champ') === norm)) {
        let k = 2
        while (taken.has(`${norm}_${k}`)) k++
        target = `${norm}_${k}`
        taken.add(target)
      }
      issues.push({
        severity: 'warning',
        line,
        message: `Nom de champ « ${name} » normalisé en « ${norm} » (minuscules, sans accent ni espace)`,
        fix: { label: `Renommer en « ${target} »`, edits: [{ from: valueStart, to: valueStart + name.length, text: target }], safe: true },
      })
    }
    if (seen.has(name)) {
      let k = 2
      while (taken.has(`${norm}_${k}`)) k++
      const unique = `${norm}_${k}`
      taken.add(unique)
      issues.push({
        severity: 'warning',
        line,
        message: `Nom de champ « ${name} » déjà utilisé ligne ${seen.get(name)} : un suffixe _2 sera ajouté`,
        fix: { label: `Renommer en « ${unique} »`, edits: [{ from: valueStart, to: valueStart + name.length, text: unique }], safe: true },
      })
    } else seen.set(name, line)
  }

  for (const i of issues) i.fixable = !!i.fix
  issues.sort((a, b) => a.line - b.line || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  const errors = issues.filter((i) => i.severity === 'error').length
  return { issues, errors, warnings: issues.length - errors, ok: errors === 0 }
}

// Why an issue matters and how to fix it, in plain words (shown under it).
const HELP: [RegExp, string][] = [
  [/^\{[{%#] n'est jamais refermé/, 'Une balise HuBL ouverte doit être refermée (}} pour une variable, %} pour une instruction). Sans fermeture, tout ce qui suit est avalé. « Corriger » ajoute la fermeture là où son contenu s’arrête.'],
  [/^\{% (\w+) %\} n'est jamais refermé/, 'Chaque {% if %}, {% for %} ou {% macro %} doit être fermé par sa balise de fin ({% endif %}, {% endfor %}, {% endmacro %}). Sans elle, HubSpot refuse le module ou masque tout ce qui suit. « Corriger » l’ajoute juste avant la fin de l’élément HTML où le bloc a été ouvert.'],
  [/n'est pas refermé avant \{%/, 'Les balises se ferment dans l’ordre inverse de leur ouverture : la plus récente d’abord. « Corriger » ferme le bloc resté ouvert juste avant.'],
  [/sans \{% end\w+ %\} correspondant|sans \{% \w+ %\} correspondant/, 'Cette balise de fin ne ferme rien : elle est en trop, ou sa balise d’ouverture a été effacée. « Corriger » la retire.'],
  [/en dehors d'un \{% if %\}/, '{% elif %} et {% else %} ne s’utilisent qu’à l’intérieur d’un {% if %} … {% endif %} (ou {% else %} dans un {% for %}). « Corriger » retire la balise isolée.'],
  [/^\{% elif %\} sans condition/, 'Il faut écrire ce qu’on teste, par exemple {% elif module.style == "sombre" %}. « Corriger » en fait un {% else %} (ou retire la branche s’il y en a déjà un) ; tu peux aussi écrire la condition toi-même.'],
  [/sans condition/, 'Il faut écrire ce qu’on teste, par exemple {% if module.afficher %}. « Corriger » retire la condition et garde le contenu affiché ; tu peux aussi écrire la condition toi-même.'],
  [/doit avoir la forme/, 'Une boucle parcourt une liste : {% for item in module.liste %} … {% endfor %}. « Corriger » retire la boucle et garde son contenu une fois ; tu peux aussi compléter la boucle toi-même.'],
  [/Guillemet/, 'Un texte entre guillemets doit être fermé par le même guillemet, sinon toute la suite de la ligne est lue comme du texte. « Corriger » le ferme en fin d’instruction.'],
  [/Parenthèse ou crochet .* en trop/, 'Cette parenthèse ou ce crochet ne ferme rien. « Corriger » le retire.'],
  [/Parenthèse ou crochet/, 'Chaque ( ou [ ouvert doit être refermé dans la même balise HuBL. « Corriger » ajoute la fermeture en fin d’instruction.'],
  [/sans ouverture correspondante/, 'Une fin de balise HuBL (}} ou %}) sans son ouverture ({{ ou {%) s’affiche telle quelle dans l’email. « Corriger » la retire.'],
  [/^Variable \{\{ \}\} vide|^Instruction \{% %\} vide/, 'Balise vide : il manque le nom de la variable ou de l’instruction. « Corriger » la supprime ; tu peux aussi la compléter.'],
  [/n'est pas terminée \(manque >\)/, 'Une balise HTML doit se fermer par > ; sans lui, le navigateur avale le texte qui suit. « Corriger » ajoute le >.'],
  [/<\/\w+> sans <\w+> correspondant/, 'Cette fermeture HTML ne correspond à aucune ouverture : elle est en trop (sauf si elle ferme une balise ouverte dans une autre branche d’un {% if %}). « Corriger » la retire.'],
  [/n'est pas refermé avant <\//, 'Cette balise HTML est encore ouverte quand son parent se ferme. « Corriger » ajoute sa fermeture juste avant celle du parent.'],
  [/n'est jamais refermé$/, 'Une balise HTML ouverte sans fermeture peut décaler toute la mise en page dans certaines messageries (Outlook surtout). « Corriger » ajoute la fermeture.'],
  [/Plusieurs data-neon="module"/, 'Le code d’un module n’a qu’un seul conteneur data-neon="module". « Corriger » réunit leur contenu dans le premier.'],
  [/data-neon="[^"]*" inconnu/, 'Ce marqueur n’est pas reconnu : le bloc serait gardé comme HTML brut. « Corriger » met le marqueur le plus proche.'],
  [/normalisé|déjà utilisé/, 'Les noms de champs HubSpot n’ont ni accent ni espace et sont uniques dans le module. « Corriger » écrit le nom définitif dans le code.'],
  [/Le code est vide/, 'Colle ton code ou utilise « Importer » pour reprendre un module existant.'],
]
export const explainIssue = (message: string): string | undefined => HELP.find(([re]) => re.test(message))?.[1]

export function validateSyntax(code: string): LintResult {
  return lintCode(code)
}

/** Applies edits to the code (from the end, so offsets stay valid). */
export function applyEdits(code: string, edits: CodeEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.from - a.from || (b.order ?? 0) - (a.order ?? 0))
  let out = code
  for (const e of sorted) out = out.slice(0, e.from) + e.text + out.slice(e.to)
  return out
}

const overlaps = (a: CodeEdit, b: CodeEdit) =>
  a.from === a.to && b.from === b.to ? false : a.from === a.to ? b.from < a.from && a.from < b.to : b.from === b.to ? a.from < b.from && b.from < a.to : a.from < b.to && b.from < a.to

/** Applies several fixes at once: each fix whole or not at all (one that touches an accepted fix waits for the next pass). */
function applyFixes(code: string, fixes: IssueFix[]): { code: string; applied: number } {
  const accepted: CodeEdit[] = []
  let applied = 0
  for (const f of fixes) {
    if (f.edits.some((e) => accepted.some((a) => overlaps(a, e) || (a.from === e.from && a.to === e.to && a.text === e.text && a.from !== a.to)))) continue
    // The same insertion asked twice (two issues with one cure) is made once.
    const fresh = f.edits.filter((e) => !accepted.some((a) => a.from === e.from && a.to === e.to && a.text === e.text))
    accepted.push(...fresh)
    applied++
  }
  return { code: applyEdits(code, accepted), applied }
}

/** The code with this one issue corrected (unchanged when it has no fix). */
export const applyIssueFix = (code: string, issue: CodeIssue): string => (issue.fix ? applyEdits(code, issue.fix.edits) : code)

/**
 * Corrects every issue that has a fix, pass after pass (a fix can reveal the
 * next one). `all: false` (default) applies only the safe, mechanical fixes;
 * `all: true` also the ones that remove empty logic or merge containers.
 */
export function fixCode(code: string, opts: { all?: boolean } = {}): { code: string; fixed: number } {
  let out = code
  let fixed = 0
  for (let pass = 0; pass < 6; pass++) {
    const { issues } = lintCode(out)
    const todo = issues.filter((i) => i.fix && (opts.all || i.fix.safe))
    if (!todo.length) break
    // Errors before warnings when two fixes touch the same place.
    const res = applyFixes(out, todo.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1)).map((i) => i.fix!))
    if (res.code === out) break
    fixed += res.applied
    out = res.code
  }
  return { code: out, fixed }
}
