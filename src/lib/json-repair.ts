// Tolerant JSON reading for imports: what people paste is often almost JSON
// (copied from a file with comments, cut a bit short, trailing commas, curly
// quotes from a word processor). Strict JSON first; otherwise a few mechanical
// repairs, never guesses about content.

export interface Lenient {
  value: unknown
  /** What had to be repaired (French, for the import report); empty = valid JSON. */
  repairs: string[]
}

export function parseLenient(text: string): Lenient | null {
  const src = text.replace(/^﻿/, '').trim()
  if (!src) return null
  try {
    return { value: JSON.parse(src), repairs: [] }
  } catch {
    /* repaired below */
  }
  const repairs: string[] = []
  let s = src
  // Curly quotes used as JSON quotes (outside strings they can only be that).
  if (/[“”]/.test(s) && !/"/.test(s.replace(/[“”]/g, ''))) {
    s = s.replace(/[“”]/g, '"')
    repairs.push('guillemets typographiques remplacés par des guillemets droits')
  }
  // Comments, trailing commas, missing closers: one pass that knows about strings.
  let out = ''
  const stack: string[] = []
  let inStr = false
  let comments = 0
  let commas = 0
  let closers = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      out += c
      if (c === '\\') out += s[++i] ?? ''
      else if (c === '"') inStr = false
      else if (c === '\n') {
        // A string cut by a raw line break: keep it as \n.
        out = out.slice(0, -1) + '\\n'
      }
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      continue
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++
      comments++
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      i = end < 0 ? s.length : end + 1
      comments++
      continue
    }
    if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']')
    if (c === '}' || c === ']') {
      // Trailing comma before a closer.
      const t = out.replace(/\s+$/, '')
      if (t.endsWith(',')) {
        out = t.slice(0, -1)
        commas++
      }
      // A closer of the other kind: close what's open first.
      while (stack.length && stack[stack.length - 1] !== c && stack.includes(c)) {
        out += stack.pop()
        closers++
      }
      if (stack[stack.length - 1] === c) stack.pop()
      else continue // stray closer
    }
    out += c
  }
  if (inStr) {
    out += '"'
    closers++
  }
  const t = out.replace(/\s+$/, '')
  if (t.endsWith(',')) {
    out = t.slice(0, -1)
    commas++
  }
  // Text cut in the middle of a pair ("key": or "key") can't be completed: drop it.
  out = out.replace(/,\s*"[^"]*"\s*:?\s*$/, '')
  if (stack.length) closers += stack.length
  out += stack.reverse().join('')
  try {
    const value = JSON.parse(out)
    if (comments) repairs.push(`${comments} commentaire${comments > 1 ? 's' : ''} retiré${comments > 1 ? 's' : ''}`)
    if (commas) repairs.push(`${commas} virgule${commas > 1 ? 's' : ''} en trop retirée${commas > 1 ? 's' : ''}`)
    if (closers) repairs.push(`${closers} fermeture${closers > 1 ? 's' : ''} manquante${closers > 1 ? 's' : ''} ajoutée${closers > 1 ? 's' : ''}`)
    return { value, repairs: repairs.length ? repairs : ['JSON réparé'] }
  } catch {
    return null
  }
}

/** JSON.parse that accepts almost-JSON; undefined when nothing can be read. */
export const parseJsonLoose = (text: string): unknown => parseLenient(text)?.value
