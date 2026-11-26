// Inlines HuBL macro calls so a template built on macros can be cut into
// editable blocks: `{{ CARD(f) }}` becomes the body of `CARD` with its
// parameters replaced by the arguments of the call. Used by the import when
// the user asks to cut a HubSpot module into blocks (« Découper en blocs »).
//
// Only plain output calls are inlined (`{{ NAME(args) }}`, optional `|safe`).
// Calls inside expressions (`{% set x = NAME() %}`), `{% call %}` blocks and
// macros using `caller()` / `varargs` / `kwargs` are left as they are, and
// their definition is kept so they still work.

export interface MacroExpansion {
  code: string
  /** Names of the macros whose calls were all inlined (definitions removed). */
  inlined: string[]
  /** Macros kept (some calls could not be inlined). */
  kept: string[]
}

interface Macro {
  name: string
  params: { name: string; def?: string }[]
  body: string
  /** The whole definition, as written. */
  text: string
  inlinable: boolean
}

const MACRO_RE = /\{%-?\s*macro\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*-?%\}([\s\S]*?)\{%-?\s*endmacro\s*-?%\}/g

/** Splits on commas outside quotes and brackets. */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === '\\') {
        cur += s[++i] ?? ''
        continue
      }
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    if (c === ')' || c === ']' || c === '}') depth--
    if (c === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** `name=value` at depth 0 (not `==`). */
function keyword(arg: string): [string, string] | null {
  const m = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]+)$/.exec(arg)
  return m ? [m[1], m[2].trim()] : null
}

function parseMacros(code: string): Macro[] {
  const list: Macro[] = []
  for (const m of code.matchAll(MACRO_RE)) {
    const params = splitArgs(m[2]).map((p) => {
      const kw = keyword(p)
      return kw ? { name: kw[0], def: kw[1] } : { name: p.trim() }
    })
    const body = m[3]
    const assigned = params.some((p) => new RegExp(`\\{%-?\\s*set\\s+${p.name}\\s*=`).test(body))
    const inlinable = !/\b(caller|varargs|kwargs)\b/.test(body) && !/\{%-?\s*macro\b/.test(body) && !assigned && params.every((p) => /^[A-Za-z_]\w*$/.test(p.name))
    list.push({ name: m[1], params, body, text: m[0], inlinable })
  }
  return list
}

const simple = (e: string) => /^[A-Za-z_][\w.]*$|^-?\d+(\.\d+)?$|^"[^"]*"$|^'[^']*'$/.test(e.trim())

/**
 * Replaces each parameter by its value in the HuBL of the body (inside
 * `{{ }}` and `{% %}` only, not in quotes, not after a dot).
 */
function substitute(body: string, values: Map<string, string>): string {
  if (!values.size) return body
  const names = [...values.keys()].sort((a, b) => b.length - a.length)
  // (No lookbehind: older Safari.) The character before the name is kept.
  const re = new RegExp(`(^|[^\\w.])(${names.join('|')})(?!\\w)`, 'g')
  const inExpr = (expr: string) => {
    // Leave quoted strings alone.
    return expr.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([^"']+)/g, (_m, q: string | undefined, rest: string | undefined) =>
      q ?? (rest ?? '').replace(re, (_n, before: string, name: string, off: number, all: string) => {
        const at = off + before.length
        // `name=` as a keyword argument of a call stays a name.
        if (/^\s*=(?!=)/.test(all.slice(at + name.length)) && /[(,]\s*$/.test(all.slice(0, at))) return before + name
        const v = values.get(name)!
        return before + (simple(v) ? v : `(${v})`)
      }),
    )
  }
  return body.replace(/(\{\{-?|\{%-?)([\s\S]*?)(-?\}\}|-?%\})/g, (_m, open: string, expr: string, close: string) => `${open}${inExpr(expr)}${close}`)
}

const CALL_RE = /\{\{-?\s*([A-Za-z_]\w*)\s*\(([^{}]*?)\)\s*(\|\s*safe\s*)?-?\}\}/g

/** Inlines the macro calls of `code` (nested calls too, up to 8 levels). */
export function expandMacros(code: string): MacroExpansion {
  const macros = parseMacros(code)
  if (!macros.length) return { code, inlined: [], kept: [] }
  const byName = new Map(macros.map((m) => [m.name, m]))
  // Definitions leave the code first; those still needed come back at the top.
  let out = code
  for (const m of macros) out = out.replace(m.text, '')
  const failed = new Set<string>()
  const used = new Set<string>()
  const expand = (src: string): string =>
    src.replace(CALL_RE, (whole, name: string, argText: string) => {
      const m = byName.get(name)
      if (!m) return whole
      used.add(name)
      if (!m.inlinable) {
        failed.add(name)
        return whole
      }
      const values = new Map<string, string>()
      const args = splitArgs(argText)
      let pos = 0
      for (const a of args) {
        const kw = keyword(a)
        if (kw && m.params.some((p) => p.name === kw[0])) values.set(kw[0], kw[1])
        else if (!kw && pos < m.params.length) values.set(m.params[pos++].name, a)
        else {
          failed.add(name)
          return whole
        }
      }
      for (const p of m.params) if (!values.has(p.name)) values.set(p.name, p.def ?? 'none')
      // Identity arguments (CARD(f) with parameter f) need no change.
      for (const [k, v] of [...values]) if (k === v.trim()) values.delete(k)
      return substitute(m.body, values)
    })
  for (let i = 0; i < 8; i++) {
    const next = expand(out)
    if (next === out) break
    out = next
  }
  // Calls left (in expressions, failed, or too deep) keep their definition.
  const kept = macros.filter((m) => failed.has(m.name) || new RegExp(`\\b${m.name}\\s*\\(`).test(out))
  if (kept.length) out = kept.map((m) => m.text).join('') + out
  return { code: out, inlined: macros.filter((m) => used.has(m.name) && !kept.includes(m)).map((m) => m.name), kept: kept.map((m) => m.name) }
}
