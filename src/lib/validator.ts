import { toFieldName } from './fields'

// Code validator: checks the module code (HTML + HuBL) and can repair what is
// mechanical (missing {% endif %}, stray end tags, unclosed HTML tags).
// Pure functions, no DOM: usable in the editor, in Maily's checks and in tests.

export type Severity = 'error' | 'warning'

export interface CodeIssue {
  severity: Severity
  line: number
  message: string
  // The automatic fix handles this one
  fixable?: boolean
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
}

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))
const NEON_TYPES = new Set(['module', 'section', 'column', 'heading', 'text', 'button', 'image', 'divider', 'spacer', 'raw'])

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

const lineAt = (code: string, offset: number) => {
  let n = 1
  for (let i = 0; i < offset && i < code.length; i++) if (code.charCodeAt(i) === 10) n++
  return n
}

const blank = (s: string) => s.replace(/[^\n]/g, ' ')

// Splits out {{ }}, {% %} and {# #}. Unclosed openers are reported.
function tokenize(code: string, issues: CodeIssue[]): Token[] {
  const tokens: Token[] = []
  const open = /\{[{%#]/g
  let from = 0
  for (;;) {
    open.lastIndex = from
    const m = open.exec(code)
    if (!m) break
    const kind = m[0] === '{{' ? 'expr' : m[0] === '{%' ? 'stmt' : 'comment'
    const close = kind === 'expr' ? '}}' : kind === 'stmt' ? '%}' : '#}'
    const at = code.indexOf(close, m.index + 2)
    if (at < 0) {
      issues.push({ severity: 'error', line: lineAt(code, m.index), message: `${m[0]} n'est jamais refermé (manque ${close})` })
      break
    }
    // `{% raw %}` keeps everything up to `{% endraw %}` untouched.
    const end = at + 2
    const body = code.slice(m.index + 2, at).replace(/^-/, '').replace(/-$/, '').trim()
    tokens.push({ kind, start: m.index, end, body })
    from = end
    if (kind === 'stmt' && /^raw$/.test(body)) {
      const e = /\{%-?\s*endraw\s*-?%\}/.exec(code.slice(from))
      if (e) {
        // The raw content is neither parsed nor checked: mask it as a comment.
        if (e.index) tokens.push({ kind: 'comment', start: from, end: from + e.index, body: '' })
        from += e.index
      }
    }
  }
  return tokens
}

// Unbalanced quotes or brackets inside {{ … }} / {% … %}.
function checkInside(code: string, t: Token, issues: CodeIssue[]) {
  const line = lineAt(code, t.start)
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const stack: string[] = []
  let quote = ''
  for (let i = 0; i < t.body.length; i++) {
    const c = t.body[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if ('([{'.includes(c)) stack.push(c)
    else if (c in pairs) {
      if (stack.pop() !== pairs[c]) {
        issues.push({ severity: 'error', line, message: `Parenthèse ou crochet « ${c} » en trop dans ${t.kind === 'expr' ? '{{ … }}' : '{% … %}'}` })
        return
      }
    }
  }
  if (quote) issues.push({ severity: 'error', line, message: `Guillemet ${quote} non fermé dans ${t.kind === 'expr' ? '{{ … }}' : '{% … %}'}` })
  else if (stack.length) issues.push({ severity: 'error', line, message: `Parenthèse ou crochet « ${stack.at(-1)} » non fermé dans ${t.kind === 'expr' ? '{{ … }}' : '{% … %}'}` })
}

interface Fix {
  remove: [number, number][]
  append: string[]
}

export function lintCode(code: string): LintResult & { fix: Fix } {
  const issues: CodeIssue[] = []
  const fix: Fix = { remove: [], append: [] }

  if (!code.trim()) {
    issues.push({ severity: 'error', line: 1, message: 'Le code est vide' })
    return { issues, errors: 1, warnings: 0, ok: false, fix }
  }

  const tokens = tokenize(code, issues)

  // --- HuBL statements -----------------------------------------------------
  const stack: { name: string; start: number }[] = []
  for (const t of tokens) {
    if (t.kind === 'comment') continue
    const line = lineAt(code, t.start)
    if (!t.body) {
      issues.push({ severity: t.kind === 'expr' ? 'warning' : 'error', line, message: t.kind === 'expr' ? 'Variable {{ }} vide' : 'Instruction {% %} vide' })
      continue
    }
    checkInside(code, t, issues)
    if (t.kind !== 'stmt') continue

    const [name, ...restParts] = t.body.split(/\s+/)
    const rest = restParts.join(' ')
    if (name in BLOCKS) {
      // `{% set x = 1 %}` is a statement, only `{% set x %}` opens a block.
      if (name === 'set' && /=/.test(rest)) continue
      if ((name === 'if' || name === 'unless') && !rest) issues.push({ severity: 'error', line, message: `{% ${name} %} sans condition` })
      if (name === 'for' && !/\S\s+in\s+\S/.test(rest)) issues.push({ severity: 'error', line, message: '{% for %} doit avoir la forme {% for x in liste %}' })
      stack.push({ name, start: t.start })
    } else if (CLOSERS.has(name)) {
      const expected = CLOSERS.get(name)!
      const idx = stack.map((s) => s.name).lastIndexOf(expected)
      if (idx < 0) {
        issues.push({ severity: 'error', line, message: `{% ${name} %} sans {% ${expected} %} correspondant`, fixable: true })
        fix.remove.push([t.start, t.end])
      } else {
        // Blocks left open between the opener and this closer.
        for (const open of stack.splice(idx).slice(1).reverse()) {
          issues.push({
            severity: 'error',
            line: lineAt(code, open.start),
            message: `{% ${open.name} %} n'est pas refermé avant {% ${name} %} (manque {% ${BLOCKS[open.name]} %})`,
          })
        }
      }
    } else if (name === 'elif' || name === 'else') {
      const top = stack.at(-1)?.name
      if (name === 'elif' && top !== 'if' && top !== 'unless') {
        issues.push({ severity: 'error', line, message: '{% elif %} en dehors d\'un {% if %}', fixable: true })
        fix.remove.push([t.start, t.end])
      } else if (name === 'else' && top !== 'if' && top !== 'unless' && top !== 'for') {
        issues.push({ severity: 'error', line, message: '{% else %} en dehors d\'un {% if %} ou {% for %}', fixable: true })
        fix.remove.push([t.start, t.end])
      } else if (name === 'elif' && !rest) {
        issues.push({ severity: 'error', line, message: '{% elif %} sans condition' })
      }
    }
  }
  for (const open of stack) {
    issues.push({
      severity: 'error',
      line: lineAt(code, open.start),
      message: `{% ${open.name} %} n'est jamais refermé (manque {% ${BLOCKS[open.name]} %})`,
      fixable: true,
    })
  }
  fix.append.push(...stack.map((s) => `{% ${BLOCKS[s.name]} %}`).reverse())

  // --- HTML ----------------------------------------------------------------
  // Mask everything that isn't markup, keeping offsets (and so line numbers).
  let masked = code
  for (const t of tokens) masked = masked.slice(0, t.start) + blank(masked.slice(t.start, t.end)) + masked.slice(t.end)
  masked = masked
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_m, o: string, _n: string, body: string, c: string) => o + blank(body) + c)

  const htmlStack: { name: string; start: number }[] = []
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(>?)/g
  for (const m of masked.matchAll(tag)) {
    const [whole, slash, rawName, , end] = m
    const name = rawName.toLowerCase()
    const line = lineAt(code, m.index)
    if (!end) {
      issues.push({ severity: 'error', line, message: `La balise <${name}> n'est pas terminée (manque >)` })
      continue
    }
    if (VOID.has(name) || whole.endsWith('/>')) continue
    if (!slash) {
      htmlStack.push({ name, start: m.index })
      continue
    }
    const idx = htmlStack.map((s) => s.name).lastIndexOf(name)
    if (idx < 0) {
      // Often legitimate around {% if %} branches, hence a warning.
      issues.push({ severity: 'warning', line, message: `</${name}> sans <${name}> correspondant`, fixable: true })
      fix.remove.push([m.index, m.index + whole.length])
      continue
    }
    for (const skipped of htmlStack.splice(idx).slice(1)) {
      issues.push({ severity: 'warning', line: lineAt(code, skipped.start), message: `<${skipped.name}> n'est pas refermé avant </${name}>` })
    }
  }
  for (const open of htmlStack) {
    issues.push({ severity: 'warning', line: lineAt(code, open.start), message: `<${open.name}> n'est jamais refermé`, fixable: true })
  }
  fix.append.push(...htmlStack.map((s) => `</${s.name}>`).reverse())

  // Stray closers outside any statement.
  for (const m of masked.matchAll(/%\}|#\}|\}\}/g)) {
    // Not inside a style/script block (blanked) — a real stray closer.
    issues.push({ severity: m[0] === '}}' ? 'warning' : 'error', line: lineAt(code, m.index), message: `« ${m[0]} » sans ouverture correspondante` })
  }

  // --- Module markers and fields ----------------------------------------------
  const modules = [...code.matchAll(/data-neon=["']module["']/g)]
  if (modules.length > 1) issues.push({ severity: 'error', line: lineAt(code, modules[1].index!), message: 'Plusieurs data-neon="module" : un seul module par code' })
  for (const m of code.matchAll(/data-neon=["']([^"']*)["']/g)) {
    if (!NEON_TYPES.has(m[1])) issues.push({ severity: 'warning', line: lineAt(code, m.index), message: `data-neon="${m[1]}" inconnu (attendus : ${[...NEON_TYPES].join(', ')})` })
  }
  const seen = new Map<string, number>()
  for (const m of code.matchAll(/\sdata-field=["']([^"']*)["']/g)) {
    const line = lineAt(code, m.index)
    if (toFieldName(m[1]) !== m[1]) {
      issues.push({ severity: 'warning', line, message: `Nom de champ « ${m[1]} » normalisé en « ${toFieldName(m[1]) || 'champ'} » (minuscules, sans accent ni espace)` })
    }
    if (seen.has(m[1])) issues.push({ severity: 'warning', line, message: `Nom de champ « ${m[1]} » déjà utilisé ligne ${seen.get(m[1])} : un suffixe _2 sera ajouté` })
    else seen.set(m[1], line)
  }

  issues.sort((a, b) => a.line - b.line || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  const errors = issues.filter((i) => i.severity === 'error').length
  return { issues, errors, warnings: issues.length - errors, ok: errors === 0, fix }
}

export function validateSyntax(code: string): LintResult {
  const { fix: _fix, ...res } = lintCode(code)
  return res
}

// Mechanical repairs: removes stray closers and closes what was left open.
export function fixCode(code: string): { code: string; fixed: number } {
  const { fix, issues } = lintCode(code)
  let out = code
  for (const [a, b] of [...fix.remove].sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + out.slice(b)
  // HuBL blocks first (innermost HTML closers last would break nesting), then HTML.
  if (fix.append.length) out = `${out.replace(/\s+$/, '')}\n${fix.append.join('\n')}\n`
  return { code: out, fixed: issues.filter((i) => i.fixable).length }
}
