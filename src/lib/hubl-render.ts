import { collectFields } from './fields'
import { scopeValue } from './extra-fields'
import { stripTags } from './sanitize'
import type { Block, ModuleTree, Section } from './types'

// HuBL interpreter for previews: evaluates {{ … }}, {% if/elif/else/unless %},
// {% for %}, {% set %} and the usual filters against sample data, the way the
// email platform would at send time. Pure functions, no DOM.
//
// The exported code (page.html / module.html) is never interpreted: HuBL stays
// in it for the platform. Only the previews use this file.

export type Scope = Record<string, unknown>

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

type Fn = (s: Scope) => unknown

const truthy = (v: unknown) => {
  if (v === undefined || v === null || v === false || v === '' || v === 0) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

const toStr = (v: unknown): string => {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(toStr).join(', ')
  return ''
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number.parseFloat(toStr(v)) || 0)

// Keyword arguments (attribute='x', reverse=true) reach a filter as one trailing object.
type Kw = { __kw: true } & Record<string, unknown>
const isKw = (v: unknown): v is Kw => !!v && typeof v === 'object' && (v as Kw).__kw === true
const splitArgs = (a: unknown[]): [unknown[], Kw] => {
  const kw = (a.find(isKw) ?? { __kw: true }) as Kw
  return [a.filter((x) => !isKw(x)), kw]
}
// item.a.b (HubSpot attribute paths)
const attrOf = (o: unknown, path: unknown) => toStr(path).split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o)
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as object) : typeof v === 'string' ? v.split('') : [])
const cmpValues = (x: unknown, y: unknown) => (typeof x === 'number' && typeof y === 'number' ? x - y : toStr(x).localeCompare(toStr(y), 'fr', { sensitivity: 'base' }))
const runTest = (v: unknown, name: unknown, arg: unknown) => {
  const t = TESTS[toStr(name) || 'truthy']
  return t ? t(v, arg) : truthy(v)
}

const FILTERS: Record<string, (v: unknown, ...a: unknown[]) => unknown> = {
  default: (v, d = '') => (truthy(v) ? v : d),
  d: (v, d = '') => (truthy(v) ? v : d),
  upper: (v) => toStr(v).toUpperCase(),
  lower: (v) => toStr(v).toLowerCase(),
  capitalize: (v) => {
    const s = toStr(v)
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  },
  title: (v) => toStr(v).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
  trim: (v) => toStr(v).trim(),
  safe: (v) => v,
  escape: (v) => toStr(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!),
  e: (v) => FILTERS.escape(v),
  striptags: (v) => stripTags(toStr(v)),
  length: (v) => (Array.isArray(v) || typeof v === 'string' ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0),
  count: (v) => FILTERS.length(v),
  truncate: (v, n = 255, end = '...') => {
    const s = toStr(v)
    return s.length > num(n) ? s.slice(0, Math.max(0, num(n) - toStr(end).length)).trimEnd() + toStr(end) : s
  },
  replace: (v, a = '', b = '') => toStr(v).split(toStr(a)).join(toStr(b)),
  join: (v, sep = '') => (Array.isArray(v) ? v.map(toStr).join(toStr(sep)) : toStr(v)),
  first: (v) => (Array.isArray(v) ? v[0] : toStr(v)[0]),
  last: (v) => (Array.isArray(v) ? v.at(-1) : toStr(v).at(-1)),
  reverse: (v) => (Array.isArray(v) ? [...v].reverse() : toStr(v).split('').reverse().join('')),
  // sort(reverse, case_sensitive, attribute) — positional or keywords.
  sort: (v, ...a) => {
    if (!Array.isArray(v)) return v
    const [pos, kw] = splitArgs(a)
    const reverse = truthy(kw.reverse ?? pos[0])
    const attr = kw.attribute ?? pos[2]
    const out = [...v].sort((x, y) => cmpValues(attr ? attrOf(x, attr) : x, attr ? attrOf(y, attr) : y))
    return reverse ? out.reverse() : out
  },
  // [a,b,c,d,e]|batch(2) → [[a,b],[c,d],[e]]
  batch: (v, n = 1, fill?: unknown) => {
    const list = asList(v)
    const size = Math.max(1, Math.trunc(num(n)) || 1)
    const out: unknown[][] = []
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
    if (fill !== undefined && !isKw(fill) && out.length && out.at(-1)!.length < size) while (out.at(-1)!.length < size) out.at(-1)!.push(fill)
    return out
  },
  // n columns: [a..e]|slice(2) → [[a,b,c],[d,e]]
  slice: (v, n = 1) => {
    const list = asList(v)
    const k = Math.max(1, Math.trunc(num(n)) || 1)
    const per = Math.floor(list.length / k)
    const extra = list.length % k
    const out: unknown[][] = []
    let at = 0
    for (let i = 0; i < k; i++) {
      const len = per + (i < extra ? 1 : 0)
      out.push(list.slice(at, at + len))
      at += len
    }
    return out
  },
  map: (v, ...a) => {
    const [pos, kw] = splitArgs(a)
    const list = asList(v)
    if (kw.attribute !== undefined) return list.map((x) => attrOf(x, kw.attribute) ?? kw.default)
    const f = FILTERS[toStr(pos[0])]
    return f ? list.map((x) => f(x, ...pos.slice(1))) : list
  },
  selectattr: (v, attr, test?: unknown, arg?: unknown) => asList(v).filter((x) => runTest(attrOf(x, attr), test, arg)),
  rejectattr: (v, attr, test?: unknown, arg?: unknown) => asList(v).filter((x) => !runTest(attrOf(x, attr), test, arg)),
  select: (v, test?: unknown, arg?: unknown) => asList(v).filter((x) => runTest(x, test, arg)),
  reject: (v, test?: unknown, arg?: unknown) => asList(v).filter((x) => !runTest(x, test, arg)),
  sum: (v, ...a) => {
    const [pos, kw] = splitArgs(a)
    const attr = kw.attribute ?? pos[1]
    return asList(v).reduce<number>((t, x) => t + num(attr ? attrOf(x, attr) : x), num(kw.start ?? pos[0] ?? 0))
  },
  min: (v) => asList(v).reduce<unknown>((m, x) => (m === undefined || cmpValues(x, m) < 0 ? x : m), undefined),
  max: (v) => asList(v).reduce<unknown>((m, x) => (m === undefined || cmpValues(x, m) > 0 ? x : m), undefined),
  unique: (v, ...a) => {
    const [pos, kw] = splitArgs(a)
    const attr = kw.attr ?? kw.attribute ?? pos[0]
    const seen = new Set<string>()
    return asList(v).filter((x) => {
      const k = JSON.stringify(attr ? attrOf(x, attr) : x)
      return seen.has(k) ? false : (seen.add(k), true)
    })
  },
  attr: (v, name) => attrOf(v, name),
  dictsort: (v) => Object.entries((v && typeof v === 'object' ? v : {}) as object).sort(([a], [b]) => a.localeCompare(b)),
  items: (v) => Object.entries((v && typeof v === 'object' ? v : {}) as object),
  shuffle: (v) => v,
  random: (v) => (Array.isArray(v) ? v[0] : v),
  add: (v, x = 0) => num(v) + num(x),
  minus: (v, x = 0) => num(v) - num(x),
  multiply: (v, x = 1) => num(v) * num(x),
  divide: (v, x = 1) => (num(x) ? num(v) / num(x) : 0),
  divisible: (v, x = 1) => num(x) !== 0 && num(v) % num(x) === 0,
  log: (v, base = Math.E) => Math.log(num(v)) / Math.log(num(base) || Math.E),
  root: (v, n = 2) => Math.pow(num(v), 1 / (num(n) || 2)),
  ceil: (v) => Math.ceil(num(v)),
  floor: (v) => Math.floor(num(v)),
  bool: (v) => truthy(v) && !/^(false|0|no|non)$/i.test(toStr(v)),
  wordcount: (v) => stripTags(toStr(v)).split(/\s+/).filter(Boolean).length,
  cut: (v, s = '') => toStr(v).split(toStr(s)).join(''),
  center: (v) => toStr(v),
  indent: (v) => toStr(v),
  wordwrap: (v) => v,
  forceescape: (v) => FILTERS.escape(v),
  escape_html: (v) => FILTERS.escape(v),
  escape_attr: (v) => FILTERS.escape(v),
  escape_url: (v) => encodeURI(toStr(v)),
  escape_jinjava: (v) => toStr(v).replace(/[{}]/g, ''),
  escapejs: (v) => toStr(v).replace(/[\\'"\n]/g, (c) => '\\' + (c === '\n' ? 'n' : c)),
  url_encode: (v) => encodeURIComponent(toStr(v)),
  tojson: (v) => JSON.stringify(v ?? null),
  fromjson: (v) => {
    try {
      return JSON.parse(toStr(v))
    } catch {
      return undefined
    }
  },
  regex_replace: (v, re = '', to = '') => {
    try {
      return toStr(v).replace(new RegExp(toStr(re), 'g'), toStr(to))
    } catch {
      return toStr(v)
    }
  },
  truncatehtml: (v, n = 255, end = '...') => FILTERS.truncate(stripTags(toStr(v)), n, end),
  sanitize_html: (v) => v,
  format_currency_value: (v, locale = 'fr-FR', currency = 'EUR') => {
    try {
      return new Intl.NumberFormat(toStr(locale).replace('_', '-') || 'fr-FR', { style: 'currency', currency: toStr(currency) || 'EUR' }).format(num(v))
    } catch {
      return num(v).toLocaleString('fr-FR')
    }
  },
  filesizeformat: (v) => {
    const n = num(v)
    return n < 1024 ? `${n} octets` : n < 1048576 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / 1048576).toFixed(1)} Mo`
  },
  pprint: (v) => (typeof v === 'object' ? JSON.stringify(v) : toStr(v)),
  list: (v) => (Array.isArray(v) ? v : toStr(v).split('')),
  split: (v, sep = ' ') => toStr(v).split(toStr(sep)),
  int: (v) => Math.trunc(num(v)),
  float: (v) => num(v),
  string: (v) => toStr(v),
  abs: (v) => Math.abs(num(v)),
  round: (v, p = 0) => Number(num(v).toFixed(num(p))),
  urlencode: (v) => encodeURIComponent(toStr(v)),
  format_number: (v) => num(v).toLocaleString('fr-FR'),
  datetimeformat: (v) => {
    const d = typeof v === 'number' || typeof v === 'string' ? new Date(v) : new Date()
    return (Number.isNaN(d.getTime()) ? new Date() : d).toLocaleDateString('fr-FR')
  },
  format_date: (v) => FILTERS.datetimeformat(v),
  // HubSpot: a datetime to milliseconds since 1970 (local_dt is already that here).
  unixtimestamp: (v) => (typeof v === 'number' ? v : Date.parse(toStr(v)) || Date.now()),
  // format_datetime(pattern, timezone, locale) with the usual Java letters.
  format_datetime: (v, pattern = 'd MMMM yyyy', tz = 'Europe/Paris', locale = 'fr') => {
    const ms = typeof v === 'number' ? v : Date.parse(toStr(v))
    if (!Number.isFinite(ms)) return ''
    try {
      const parts = new Intl.DateTimeFormat(toStr(locale) || 'fr', { timeZone: toStr(tz) || 'Europe/Paris', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms)
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
      const short = new Intl.DateTimeFormat(toStr(locale) || 'fr', { timeZone: toStr(tz) || 'Europe/Paris', month: 'short' }).format(ms)
      const month2 = new Intl.DateTimeFormat('en', { timeZone: toStr(tz) || 'Europe/Paris', month: '2-digit' }).format(ms)
      return toStr(pattern).replace(/'([^']*)'|yyyy|MMMM|MMM|MM|dd|d|HH|mm/g, (m, lit) =>
        lit !== undefined ? lit : m === 'yyyy' ? get('year') : m === 'MMMM' ? get('month') : m === 'MMM' ? short : m === 'MM' ? month2 : m === 'dd' ? get('day').padStart(2, '0') : m === 'd' ? get('day') : m === 'HH' ? get('hour') : get('minute'),
      )
    } catch {
      return ''
    }
  },
}

const FUNCTIONS: Record<string, (...a: unknown[]) => unknown> = {
  range: (a, b) => {
    const [from, to] = b === undefined ? [0, num(a)] : [num(a), num(b)]
    return Array.from({ length: Math.max(0, Math.min(200, to - from)) }, (_, i) => from + i)
  },
  unixtimestamp: () => Date.now(),
  local_dt: () => new Date().toLocaleDateString('fr-FR'),
}

const TESTS: Record<string, (v: unknown, ...a: unknown[]) => boolean> = {
  defined: (v) => v !== undefined,
  undefined: (v) => v === undefined,
  none: (v) => v === null || v === undefined,
  truthy: (v) => truthy(v),
  falsy: (v) => !truthy(v),
  true: (v) => v === true,
  false: (v) => v === false,
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  mapping: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
  iterable: (v) => Array.isArray(v) || typeof v === 'string',
  sequence: (v) => Array.isArray(v) || typeof v === 'string',
  even: (v) => num(v) % 2 === 0,
  odd: (v) => num(v) % 2 === 1,
  equalto: (v, o) => v === o,
  sameas: (v, o) => v === o,
  ne: (v, o) => v !== o,
  lt: (v, o) => num(v) < num(o),
  lessthan: (v, o) => num(v) < num(o),
  le: (v, o) => num(v) <= num(o),
  gt: (v, o) => num(v) > num(o),
  greaterthan: (v, o) => num(v) > num(o),
  ge: (v, o) => num(v) >= num(o),
  divisibleby: (v, o) => num(o) !== 0 && num(v) % num(o) === 0,
  within: (v, o) => (Array.isArray(o) ? o.includes(v) : false),
  lower: (v) => typeof v === 'string' && v === v.toLowerCase(),
  upper: (v) => typeof v === 'string' && v === v.toUpperCase(),
  integer: (v) => Number.isInteger(v),
  float: (v) => typeof v === 'number' && !Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  eq: (v, o) => v === o,
  string_containing: (v, o) => toStr(v).includes(toStr(o)),
  string_startingwith: (v, o) => toStr(v).startsWith(toStr(o)),
  containing: (v, o) => (Array.isArray(v) ? v.includes(o) : toStr(v).includes(toStr(o))),
}

const TOKEN =
  /\s*(?:(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_]\w*)|(==|!=|<=|>=|\/\/|[-+*/%~<>()[\]{},.:|=]))/y

function tokenizeExpr(src: string): { t: string; v: string }[] {
  const out: { t: string; v: string }[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < src.length) {
    const start = TOKEN.lastIndex
    const m = TOKEN.exec(src)
    if (!m) {
      if (!src.slice(start).trim()) break
      throw new Error(`Expression illisible : ${src.slice(start, start + 12)}`)
    }
    if (m[1] !== undefined) out.push({ t: 'num', v: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2].slice(1, -1).replace(/\\(.)/g, '$1') })
    else if (m[3] !== undefined) out.push({ t: 'id', v: m[3] })
    else out.push({ t: 'op', v: m[4] })
  }
  return out
}

const member = (o: unknown, k: unknown): unknown => {
  if (o === undefined || o === null) return undefined
  if (Array.isArray(o) && k === 'length') return o.length
  if (typeof o === 'string') return k === 'length' ? o.length : undefined
  if (typeof o === 'object') return (o as Record<string, unknown>)[String(k)]
  return undefined
}

export function compileExpr(src: string): Fn {
  const toks = tokenizeExpr(src)
  let i = 0
  const peek = () => toks[i]
  const isOp = (v: string) => toks[i]?.t === 'op' && toks[i].v === v
  const isId = (v: string) => toks[i]?.t === 'id' && toks[i].v === v
  const eatOp = (v: string) => (isOp(v) ? (i++, true) : false)

  const ternary = (): Fn => {
    const value = or()
    if (isId('if')) {
      i++
      const cond = or()
      let other: Fn = () => ''
      if (isId('else')) {
        i++
        other = ternary()
      }
      return (s) => (truthy(cond(s)) ? value(s) : other(s))
    }
    return value
  }
  const or = (): Fn => {
    let l = and()
    while (isId('or')) {
      i++
      const a = l
      const r = and()
      l = (s) => truthy(a(s)) || truthy(r(s))
    }
    return l
  }
  const and = (): Fn => {
    let l = not()
    while (isId('and')) {
      i++
      const a = l
      const r = not()
      l = (s) => truthy(a(s)) && truthy(r(s))
    }
    return l
  }
  const not = (): Fn => {
    if (isId('not')) {
      i++
      const x = not()
      return (s) => !truthy(x(s))
    }
    return cmp()
  }
  const cmp = (): Fn => {
    let l = add()
    for (;;) {
      const t = peek()
      if (!t) return l
      const a = l
      if (t.t === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(t.v)) {
        i++
        const r = add()
        const op = t.v
        l = (s) => {
          const x = a(s)
          const y = r(s)
          switch (op) {
            case '==':
              return x === y || (x == null && y == null)
            case '!=':
              return !(x === y || (x == null && y == null))
            case '<':
              return (x as number) < (y as number)
            case '>':
              return (x as number) > (y as number)
            case '<=':
              return (x as number) <= (y as number)
            default:
              return (x as number) >= (y as number)
          }
        }
      } else if (isId('in') || (isId('not') && toks[i + 1]?.v === 'in')) {
        const negate = isId('not')
        i += negate ? 2 : 1
        const r = add()
        l = (s) => {
          const c = r(s)
          const x = a(s)
          const has = Array.isArray(c) ? c.includes(x) : typeof c === 'string' ? c.includes(toStr(x)) : !!c && typeof c === 'object' && toStr(x) in (c as object)
          return negate ? !has : has
        }
      } else if (isId('is')) {
        i++
        const negate = isId('not')
        if (negate) i++
        const name = toks[i++]?.v ?? 'defined'
        const arg = isOp('(') ? (i++, ((e) => (eatOp(')'), e))(ternary())) : undefined
        l = (s) => {
          const test = TESTS[name]
          const res = test ? test(a(s), arg?.(s)) : false
          return negate ? !res : res
        }
      } else return l
    }
  }
  const add = (): Fn => {
    let l = mul()
    while (isOp('+') || isOp('-') || isOp('~')) {
      const op = toks[i++].v
      const a = l
      const r = mul()
      l = (s) => {
        const x = a(s)
        const y = r(s)
        if (op === '~') return toStr(x) + toStr(y)
        if (op === '+' && (typeof x === 'string' || typeof y === 'string')) return toStr(x) + toStr(y)
        return op === '+' ? num(x) + num(y) : num(x) - num(y)
      }
    }
    return l
  }
  const mul = (): Fn => {
    let l = unary()
    while (isOp('*') || isOp('/') || isOp('%') || isOp('//')) {
      const op = toks[i++].v
      const a = l
      const r = unary()
      l = (s) => {
        const x = num(a(s))
        const y = num(r(s))
        return op === '*' ? x * y : op === '/' ? (y ? x / y : 0) : op === '%' ? (y ? x % y : 0) : y ? Math.floor(x / y) : 0
      }
    }
    return l
  }
  const unary = (): Fn => {
    if (eatOp('-')) {
      const x = unary()
      return (s) => -num(x(s))
    }
    return postfix()
  }
  const postfix = (): Fn => {
    let v = primary()
    for (;;) {
      if (eatOp('.')) {
        const k = toks[i++]?.v ?? ''
        const o = v
        v = (s) => member(o(s), k)
      } else if (eatOp('[')) {
        const k = ternary()
        eatOp(']')
        const o = v
        v = (s) => member(o(s), k(s))
      } else if (isOp('(')) {
        i++
        const args = list(')')
        const f = v
        v = (s) => {
          const fn = f(s)
          return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown)(...args.map((a) => a(s))) : undefined
        }
      } else if (eatOp('|')) {
        const name = toks[i++]?.v ?? ''
        const args = isOp('(') ? (i++, list(')')) : []
        const o = v
        v = (s) => {
          const f = FILTERS[name]
          return f ? f(o(s), ...args.map((a) => a(s))) : o(s)
        }
      } else return v
    }
  }
  const list = (close: string): Fn[] => {
    const items: Fn[] = []
    const kws: [string, Fn][] = []
    while (i < toks.length && !isOp(close)) {
      // name=value (a keyword argument; == stays a comparison)
      if (toks[i]?.t === 'id' && toks[i + 1]?.t === 'op' && toks[i + 1].v === '=') {
        const k = toks[i].v
        i += 2
        kws.push([k, ternary()])
      } else items.push(ternary())
      if (!eatOp(',')) break
    }
    if (kws.length) items.push((s) => Object.fromEntries([['__kw', true], ...kws.map(([k, f]) => [k, f(s)])]))
    eatOp(close)
    return items
  }
  const primary = (): Fn => {
    const t = toks[i++]
    if (!t) return () => undefined
    if (t.t === 'num') return () => Number(t.v)
    if (t.t === 'str') return () => t.v
    if (t.t === 'id') {
      switch (t.v) {
        case 'true':
        case 'True':
          return () => true
        case 'false':
        case 'False':
          return () => false
        case 'none':
        case 'None':
        case 'null':
          return () => null
      }
      const name = t.v
      if (name === 'local_dt') return (s) => (name in s ? s[name] : Date.now())
      return (s) => (name in s ? s[name] : name in FUNCTIONS ? FUNCTIONS[name] : undefined)
    }
    if (t.v === '(') {
      const e = ternary()
      eatOp(')')
      return e
    }
    if (t.v === '[') {
      const items = list(']')
      return (s) => items.map((x) => x(s))
    }
    if (t.v === '{') {
      const pairs: [Fn, Fn][] = []
      while (i < toks.length && !isOp('}')) {
        const k = ternary()
        eatOp(':')
        pairs.push([k, ternary()])
        if (!eatOp(',')) break
      }
      eatOp('}')
      return (s) => Object.fromEntries(pairs.map(([k, v]) => [toStr(k(s)), v(s)]))
    }
    return () => undefined
  }

  const root = ternary()
  return (s) => {
    try {
      return root(s)
    } catch {
      return undefined
    }
  }
}

const cache = new Map<string, Fn>()
const expr = (src: string): Fn => {
  let f = cache.get(src)
  if (!f) {
    try {
      f = compileExpr(src)
    } catch {
      f = () => undefined
    }
    if (cache.size > 500) cache.clear()
    cache.set(src, f)
  }
  return f
}

export const evalExpr = (src: string, scope: Scope) => expr(src)(scope)
export const evalCondition = (src: string, scope: Scope) => truthy(evalExpr(src, scope))

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

type Node =
  | { t: 'text'; v: string }
  | { t: 'out'; e: string }
  | { t: 'if'; branches: { c: string | null; body: Node[] }[] }
  | { t: 'for'; names: string[]; it: string; body: Node[]; other: Node[] }
  | { t: 'set'; name: string; e: string }
  | { t: 'seq'; body: Node[] }
  | { t: 'macro'; name: string; params: { name: string; def?: string }[]; body: Node[] }

const chip = (label: string) =>
  `<span style="display:inline-block;padding:10px 18px;border-radius:6px;background:#ff007f;color:#ffffff;font:700 14px/1.2 Arial,sans-serif;">${label}</span>`
const PLACEHOLDERS: Record<string, string> = {
  cta: chip('CTA HubSpot'),
  icon: '<span style="font:16px/1 Arial,sans-serif;color:#ff007f;">★</span>',
  form: '<span style="display:block;padding:16px;border:1px dashed #b4b4c8;border-radius:8px;color:#5c5c78;font:13px/1.4 Arial,sans-serif;text-align:center;">Formulaire HubSpot</span>',
  video_player: '<span style="display:block;padding:40px 16px;background:#0f0f1a;color:#ffffff;font:13px/1.4 Arial,sans-serif;text-align:center;">▶ Vidéo HubSpot</span>',
}

const SKIP_BLOCKS = new Set(['widget_block', 'scope_css', 'require_css', 'require_js', 'set', 'call_skip'])
const SEQ_BLOCKS = new Set(['block', 'call'])

function parse(src: string): Node[] {
  const root: Node[] = []
  // Frames: where nodes are appended and how the current block is closed.
  const frames: { kind: string; list: Node[]; node?: Node; skip?: boolean }[] = [{ kind: 'root', list: root }]
  const cur = () => frames[frames.length - 1]
  const re = /\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}|\{#[\s\S]*?#\}/g
  let last = 0
  const addText = (v: string) => {
    if (v && !cur().skip) cur().list.push({ t: 'text', v })
  }
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let text = src.slice(last, m.index)
    // Whitespace control: {%- … -%}
    if (/^\{[{%]-/.test(m[0])) text = text.replace(/\s+$/, '')
    addText(text)
    last = m.index + m[0].length
    if (/-[}%]\}$/.test(m[0])) {
      const rest = src.slice(last)
      last += rest.length - rest.replace(/^\s+/, '').length
      re.lastIndex = last
    }
    if (m[1] !== undefined) {
      if (!cur().skip) cur().list.push({ t: 'out', e: m[1].trim() })
      continue
    }
    if (m[2] === undefined) continue
    const body = m[2].trim()
    const name = body.split(/\s+/)[0]
    const rest = body.slice(name.length).trim()

    if (name === 'raw') {
      const end = /\{%-?\s*endraw\s*-?%\}/.exec(src.slice(last))
      const stop = end ? last + end.index : src.length
      addText(src.slice(last, stop))
      last = end ? stop + end[0].length : src.length
      re.lastIndex = last
      continue
    }
    if (name === 'if' || name === 'unless') {
      const node: Node = { t: 'if', branches: [{ c: name === 'unless' ? `not (${rest})` : rest, body: [] }] }
      if (!cur().skip) cur().list.push(node)
      frames.push({ kind: 'if', list: node.branches[0].body, node, skip: cur().skip })
    } else if (name === 'elif' && cur().kind === 'if') {
      const node = cur().node as Extract<Node, { t: 'if' }>
      const b = { c: rest, body: [] as Node[] }
      node.branches.push(b)
      cur().list = b.body
    } else if (name === 'else' && cur().kind === 'if') {
      const node = cur().node as Extract<Node, { t: 'if' }>
      const b = { c: null, body: [] as Node[] }
      node.branches.push(b)
      cur().list = b.body
    } else if (name === 'for') {
      const f = /^(.+?)\s+in\s+([\s\S]+)$/.exec(rest)
      const node: Node = { t: 'for', names: (f?.[1] ?? 'item').split(',').map((s) => s.trim()), it: f?.[2] ?? '[]', body: [], other: [] }
      if (!cur().skip) cur().list.push(node)
      frames.push({ kind: 'for', list: node.body, node, skip: cur().skip })
    } else if (name === 'else' && cur().kind === 'for') {
      cur().list = (cur().node as Extract<Node, { t: 'for' }>).other
    } else if (name === 'set' && !rest.includes('=')) {
      frames.push({ kind: 'set', list: [], skip: true })
    } else if (name === 'set') {
      const f = /^([\w.]+)\s*=\s*([\s\S]+)$/.exec(rest)
      if (f && !cur().skip) cur().list.push({ t: 'set', name: f[1], e: f[2] })
    } else if (name === 'macro') {
      // {% macro name(a, b=1) %}…{% endmacro %}: a function printing its body.
      const f = /^([A-Za-z_]\w*)\s*\(([\s\S]*)\)\s*$/.exec(rest)
      const params = (f?.[2] ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const [n, ...d] = p.split('=')
          return { name: n.trim(), ...(d.length ? { def: d.join('=').trim() } : {}) }
        })
      const node: Node = { t: 'macro', name: f?.[1] ?? '', params, body: [] }
      if (!cur().skip && f) cur().list.push(node)
      frames.push({ kind: 'macro', list: node.body, node, skip: cur().skip || !f })
    } else if (SKIP_BLOCKS.has(name) && name !== 'set') {
      frames.push({ kind: name, list: [], skip: true })
    } else if (SEQ_BLOCKS.has(name)) {
      const node: Node = { t: 'seq', body: [] }
      if (!cur().skip) cur().list.push(node)
      frames.push({ kind: name, list: node.body, node, skip: cur().skip })
    } else if (name === 'inline_text' || name === 'inline_rich_text') {
      // HubSpot's inline editing tags print their value.
      const v = /value\s*=\s*(["'])\s*\{\{([\s\S]*?)\}\}\s*\1|value\s*=\s*([A-Za-z_][\w.]*)/.exec(rest)
      const f = /field\s*=\s*["']([A-Za-z_]\w*)["']/.exec(rest)
      const e = v ? (v[2] ?? v[3]).trim() : f ? `module.${f[1]}` : ''
      if (e && !cur().skip) cur().list.push({ t: 'out', e })
    } else if (PLACEHOLDERS[name]) {
      // Tags drawn by HubSpot at send time: a recognisable stand-in in the preview.
      if (!cur().skip) cur().list.push({ t: 'text', v: PLACEHOLDERS[name] })
    } else if (/^end/.test(name) || name === 'end_widget_block' || name === 'end_scope_css') {
      if (frames.length > 1) frames.pop()
    }
    // Everything else ({% module %}, {% require_css %}…) renders nothing.
  }
  addText(src.slice(last))
  return root
}

function run(nodes: Node[], scope: Scope, budget: { n: number }): string {
  let out = ''
  for (const n of nodes) {
    if (budget.n-- <= 0) return out
    switch (n.t) {
      case 'text':
        out += n.v
        break
      case 'out':
        out += toStr(evalExpr(n.e, scope))
        break
      case 'if': {
        const hit = n.branches.find((b) => b.c === null || evalCondition(b.c, scope))
        if (hit) out += run(hit.body, scope, budget)
        break
      }
      case 'for': {
        const raw = evalExpr(n.it, scope)
        const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw) : []
        if (!items.length) {
          out += run(n.other, scope, budget)
          break
        }
        items.slice(0, 50).forEach((item, idx, arr) => {
          const child: Scope = Object.create(scope)
          const vals = n.names.length > 1 && Array.isArray(item) ? item : [item]
          n.names.forEach((name, k) => (child[name] = vals[k]))
          child.loop = { index: idx + 1, index0: idx, first: idx === 0, last: idx === arr.length - 1, length: arr.length }
          out += run(n.body, child, budget)
        })
        break
      }
      case 'set': {
        const path = n.name.split('.')
        const val = evalExpr(n.e, scope)
        if (path.length === 1) scope[path[0]] = val
        else {
          const o = path.slice(0, -1).reduce<unknown>((x, k) => member(x, k), scope)
          if (o && typeof o === 'object') (o as Record<string, unknown>)[path.at(-1)!] = val
        }
        break
      }
      case 'seq':
        out += run(n.body, scope, budget)
        break
      case 'macro': {
        const def = n
        const outer = scope
        scope[def.name] = (...args: unknown[]) => {
          const child: Scope = Object.create(outer)
          const kw = (args.find(isKw) ?? {}) as Record<string, unknown>
          const pos = args.filter((a) => !isKw(a))
          def.params.forEach((p, i) => (child[p.name] = i < pos.length ? pos[i] : p.name in kw ? kw[p.name] : p.def !== undefined ? evalExpr(p.def, outer) : undefined))
          return run(def.body, child, { n: 5_000 })
        }
        break
      }
    }
  }
  return out
}

// Defines the macros of a template in `scope` (a raw block holding {% macro %} definitions).
export function defineMacros(src: string, scope: Scope) {
  try {
    run(
      parse(src).filter((n) => n.t === 'macro'),
      scope,
      { n: 1_000 },
    )
  } catch {
    /* a broken macro simply stays undefined */
  }
}

const parsed = new Map<string, Node[]>()

// Renders a HuBL template with the given data. Never throws.
export function renderHubl(src: string, data: Scope): string {
  if (!/\{[{%#]/.test(src)) return src
  try {
    let ast = parsed.get(src)
    if (!ast) {
      ast = parse(src)
      if (parsed.size > 300) parsed.clear()
      parsed.set(src, ast)
    }
    return run(ast, Object.create(data), { n: 20_000 })
  } catch {
    return src
  }
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

export type SampleContact = 'known' | 'unknown'

const CONTACT = {
  firstname: 'Camille',
  lastname: 'Martin',
  email: 'camille.martin@exemple.fr',
  company: 'Exemple SAS',
  jobtitle: 'Responsable formation',
  phone: '01 23 45 67 89',
  city: 'Paris',
  zip: '75001',
  country: 'France',
}

// Data the previews feed to the interpreter: a sample contact, the sender's
// site settings and the module's own fields ({{ module.nom }}).
export function previewScope(tree: ModuleTree, contact: SampleContact = 'known'): Scope {
  const mod: Record<string, unknown> = {}
  for (const f of collectFields(tree)) {
    const b = f.block
    const base = b.field?.name ? f.name : f.name
    if (b.type === 'heading') mod[base] = b.text
    else if (b.type === 'text') mod[base] = b.html
    else if (b.type === 'image') mod[base] = { src: b.src, alt: b.alt, width: b.width }
    else if (b.type === 'button') {
      mod[b.field?.textName || `${base}_label`] = b.label
      mod[b.field?.linkName || `${base}_link`] = { url: { href: b.href, type: 'EXTERNAL' }, open_in_new_tab: true }
    }
  }
  // Variables of the code that no block owns, with their default values.
  for (const f of tree.fields ?? []) if (!(f.name in mod)) mod[f.name] = scopeValue(f)
  // A field with no value yet shows its name instead of nothing.
  const module = new Proxy(mod, { get: (t, k) => (typeof k === 'string' && !(k in t) ? `[${k}]` : t[k as string]) })
  const contactData = contact === 'known' ? CONTACT : {}
  return {
    module,
    // Older modules call their fields widget.<name>.
    widget: module,
    contact: contactData,
    company: { name: 'Votre entreprise' },
    site_settings: { company_name: 'Votre entreprise', company_domain: 'exemple.fr', company_street_address_1: '1 rue de l\'Exemple', company_city: 'Paris' },
    unsubscribe_link: '#',
    unsubscribe_link_all: '#',
    view_as_page_url: '#',
    subscription_preference_url: '#',
    year: new Date().getFullYear(),
  }
}

// ---------------------------------------------------------------------------
// Tree preview
// ---------------------------------------------------------------------------

// One statement only: no `%}` / `#}` inside, so `{% if x %}Bonjour{% endif %}` is content, not logic.
const STATEMENT = /^\s*(?:\{#(?:(?!#\})[\s\S])*#\}|\{%(?:(?!%\})[\s\S])*%\})\s*$/

// A raw block that is a single {% … %} statement or {# … #} comment: the logic
// around other blocks, not content.
// Tags that print something (inline editing, CTA, icon, form…) are content, not logic.
// {% macro %}…{% endmacro %} definitions (several allowed): they print nothing where they are written.
const MACROS = /^\s*(?:\{%-?\s*macro\b[\s\S]*?\{%-?\s*endmacro\s*-?%\}\s*)+$/
export const isMacroBlock = (b: Block): boolean => b.type === 'raw' && MACROS.test(b.html)
export const isLogicBlock = (b: Block): boolean =>
  isMacroBlock(b) || b.type === 'raw' && STATEMENT.test(b.html) && !/^\s*\{%-?\s*(raw|module|inline_text|inline_rich_text|inline_link|cta|icon|form|video_player|image|logo|linked_image|menu|simple_menu)\b/.test(b.html)

function statementOf(b: Block): { name: string; rest: string } | null {
  if (b.type !== 'raw') return null
  const m = /^\s*\{%-?\s*((?:(?!%\})[\s\S])*?)\s*-?%\}\s*$/.exec(b.html)
  if (!m) return null
  const name = m[1].split(/\s+/)[0]
  return { name, rest: m[1].slice(name.length).trim() }
}

const hasHubl = (s: string) => /\{[{%#]/.test(s)

// The tree as the platform would render it for the sample data: logic blocks
// resolved ({% if %} branches kept or dropped, {% for %} shown once), variables
// replaced, the statements themselves hidden. `keepId` leaves that block's
// text untouched so in-place editing works on the source, not the preview.
export function interpretTree(tree: ModuleTree, data: Scope, keepId?: string | null): ModuleTree {
  const scope: Scope = Object.create(data)

  const text = (s: string, sc: Scope) => (hasHubl(s) ? renderHubl(s, sc) : s)

  // Index of the {% endfor %} closing the {% for %} at `from` (or the end of the list).
  const matchEnd = (blocks: Block[], from: number): number => {
    let depth = 0
    for (let j = from + 1; j < blocks.length; j++) {
      const n = isLogicBlock(blocks[j]) ? statementOf(blocks[j])?.name : undefined
      if (n === 'for') depth++
      else if (n === 'endfor') {
        if (depth === 0) return j
        depth--
      }
    }
    return blocks.length
  }

  // Loop clones need ids of their own (the editor maps `id~k` back to `id`).
  // The loop's own id is part of the suffix, so nested loops never produce the same id twice.
  const suffixIds = (b: Block, k: number | string): Block =>
    b.type === 'section' ? { ...b, id: `${b.id}~${k}`, cells: b.cells.map((c) => c.map((x) => suffixIds(x, k))) } : { ...b, id: `${b.id}~${k}` }

  const list = (blocks: Block[], parent: Scope): Block[] => {
    const sc: Scope = Object.create(parent)
    const out: Block[] = []
    // Open {% if %} / {% for %} frames: is the current branch visible?
    const frames: { kind: 'if'; active: boolean; taken: boolean; parent: boolean }[] = []
    let active = true
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      const st = isLogicBlock(b) ? statementOf(b) : null
      if (isLogicBlock(b)) {
        if (!st) {
          // Macro definitions: callable from every block of the module ({{ CTA(…) }}).
          if (b.type === 'raw' && isMacroBlock(b) && active) {
            defineMacros(b.html, scope)
            defineMacros(b.html, sc)
          }
          continue // comment
        }
        const top = frames[frames.length - 1]
        switch (st.name) {
          case 'if':
          case 'unless': {
            const cond: boolean = active && evalCondition(st.name === 'unless' ? `not (${st.rest})` : st.rest, sc)
            frames.push({ kind: 'if', active: cond, taken: cond, parent: active })
            active = cond
            break
          }
          case 'elif':
            if (top?.kind === 'if') {
              const cond = top.parent && !top.taken && evalCondition(st.rest, sc)
              top.taken ||= cond
              active = cond
            }
            break
          case 'else':
            if (top?.kind === 'if') {
              active = top.parent && !top.taken
              top.taken = true
            }
            break
          case 'endif':
            if (top) {
              frames.pop()
              active = top.parent
            }
            break
          case 'for': {
            const end = matchEnd(blocks, i)
            if (active) {
              const f = /^(.+?)\s+in\s+([\s\S]+)$/.exec(st.rest)
              const range = blocks.slice(i + 1, end)
              let elseAt = -1
              let depth = 0
              range.forEach((x, k) => {
                const s2 = isLogicBlock(x) ? statementOf(x) : null
                // {% else %} of the loop itself, not of an {% if %} inside it.
                if (s2?.name === 'for' || s2?.name === 'if' || s2?.name === 'unless') depth++
                else if (s2?.name === 'endfor' || s2?.name === 'endif' || s2?.name === 'endunless') depth--
                else if (s2?.name === 'else' && depth === 0 && elseAt < 0) elseAt = k
              })
              const body = elseAt < 0 ? range : range.slice(0, elseAt)
              const other = elseAt < 0 ? [] : range.slice(elseAt + 1)
              const iter: unknown = f ? evalExpr(f[2], sc) : undefined
              const found: unknown[] | undefined = Array.isArray(iter) ? iter : iter && typeof iter === 'object' ? Object.entries(iter) : undefined
              // Unknown list: show the body once with empty data.
              const items: unknown[] = found ?? [{}]
              const names = (f?.[1] ?? 'item').split(',').map((n) => n.trim())
              if (!items.length) out.push(...list(other, sc))
              const cols = b.type === 'raw' ? b.cols : undefined
              const grid: Block[][] = []
              items.slice(0, 20).forEach((item, k, arr) => {
                const child: Scope = Object.create(sc)
                const vals = names.length > 1 && Array.isArray(item) ? item : [item]
                names.forEach((n, j) => (child[n] = vals[j] ?? {}))
                child.loop = { index: k + 1, index0: k, first: k === 0, last: k === arr.length - 1, length: arr.length }
                const res = list(body, child)
                const placed = k === 0 ? res : res.map((x) => suffixIds(x, `${b.id}.${k}`))
                if (cols) grid.push(placed)
                else out.push(...placed)
              })
              // Items laid out side by side: rows of `cols` columns.
              for (let r = 0; r < grid.length; r += cols ?? 1) {
                const row = grid.slice(r, r + cols!)
                while (row.length < cols!) row.push([])
                out.push({ id: `${b.id}~row${r}`, type: 'section', columns: cols!, behavior: 'stack', bg: 'transparent', padding: 0, padX: 12, radius: 0, mt: 0, mb: 0, cells: row })
              }
            }
            i = end
            break
          }
          case 'set': {
            const f = /^([\w]+)\s*=\s*([\s\S]+)$/.exec(st.rest)
            if (f && active) {
              sc[f[1]] = evalExpr(f[2], sc)
              // A variable set outside any loop is the whole module's (the import
              // spreads one template over several sections).
              if (!(f[1] in scope)) scope[f[1]] = sc[f[1]]
            }
            break
          }
        }
        continue
      }
      if (!active) continue
      const done = block(b, sc)
      // A text whose variables print nothing ({{ SP("after_title", L) }} without spacer) takes no room.
      if (done.type === 'text' && b.type === 'text' && b.id !== keepId && hasHubl(b.html) && !stripTags(done.html).replace(/\s/g, '') && !/<(img|table|hr|br)\b/i.test(done.html)) continue
      out.push(done)
    }
    return out
  }

  const block = (b: Block, sc: Scope): Block => {
    switch (b.type) {
      case 'section':
        return { ...b, bg: text(b.bg, sc), ...(b.css ? { css: text(b.css, sc) } : {}), cells: b.cells.map((c) => list(c, sc)) }
      case 'raw':
        // The selected HTML block is edited from its own code (variables shown as written).
        return b.id === keepId ? b : { ...b, html: text(b.html, sc) }
      case 'heading':
        return b.id === keepId ? b : { ...b, text: text(b.text, sc), color: text(b.color, sc) }
      case 'text':
        return b.id === keepId ? b : { ...b, html: text(b.html, sc), color: text(b.color, sc) }
      case 'button':
        return b.id === keepId ? b : { ...b, label: text(b.label, sc), href: text(b.href, sc), bg: text(b.bg, sc), color: text(b.color, sc) }
      case 'image':
        return b.id === keepId ? b : { ...b, src: text(b.src, sc), alt: text(b.alt, sc) }
      case 'divider':
        return { ...b, color: text(b.color, sc) }
      default:
        return b
    }
  }

  // A section holding only logic ({% set %} lines…) shows nothing: it is left out
  // of the preview instead of leaving an empty band.
  const onlyLogic = (s: Section) => s.cells.every((c) => c.length > 0 && c.every((b) => isLogicBlock(b)))
  return {
    ...tree,
    sections: tree.sections.map((s) => ({ ...s, bg: text(s.bg, scope), ...(s.css ? { css: text(s.css, scope) } : {}), cells: s.cells.map((c) => list(c, scope)) })).filter((_s, i) => !onlyLogic(tree.sections[i]) || tree.sections[i].id === keepId),
  }
}
