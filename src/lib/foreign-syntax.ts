// Module code from other e-mail and CMS platforms, turned into HuBL before the
// import: Liquid (Shopify, Klaviyo, Braze, Brevo…), Django-style filters,
// Handlebars / Mustache (SendGrid, Postmark, Iterable…), Mailchimp merge tags,
// Salesforce AMPscript and personalization strings, Mailjet, Marketo (with its
// <meta class="mkto…"> variables) and MJML. What can't work in a module (other
// tools' logic, includes, unknown filters) is removed instead of showing as
// code in the e-mail; personal data becomes contact.<property>, unsubscribe /
// web version links the module's own, and the remaining data (order.name,
// params.CODE, *|COUPON|*…) becomes editable module fields. Pure (no DOM).
import { parseDocument } from 'htmlparser2'
import { FILTER_NAMES } from './hubl-render'
import type { FieldSpec } from './module-fields'

export interface ForeignResult {
  code: string
  /** What was converted, in French (shown in the import report). */
  repairs: string[]
  /** Field definitions read from the code (Marketo variables). */
  specs: FieldSpec[]
  /** Platforms recognised. */
  platforms: string[]
}

type ChildNode = ReturnType<typeof parseDocument>['children'][number]
type Element = Extract<ChildNode, { attribs: Record<string, string> }>

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.]+/g, '')
const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .replace(/^(\d)/, '_$1') || 'champ'
// Names the field analyzer reads as list/dict methods (dict.items()…): renamed as module fields.
const fieldName = (s: string) => {
  const n = snake(s)
  return /^(items|keys|values|length|name)$/.test(n) ? `${n}_list`.replace('name_list', 'nom') : n
}
const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

// ---------------------------------------------------------------------------
// Where personal data and system links go in a module.

const PERSONAL: Record<string, string> = {}
const person = (prop: string, names: string[]) => names.forEach((n) => (PERSONAL[norm(n)] = `contact.${prop}`))
person('firstname', ['firstname', 'first_name', 'fname', 'prenom', 'prénom', 'given_name', 'givenname', 'name', 'contact_name'])
person('lastname', ['lastname', 'last_name', 'lname', 'nom', 'family_name', 'surname'])
person('email', ['email', 'emailaddr', 'email_address', 'emailaddress', 'mail', 'courriel'])
person('company', ['company', 'company_name', 'companyname', 'societe', 'société', 'entreprise', 'organization_name'])
person('phone', ['phone', 'phone_number', 'telephone', 'téléphone', 'mobile', 'sms'])
person('city', ['city', 'ville'])
person('country', ['country', 'pays'])
person('zip', ['zip', 'zipcode', 'postal_code', 'postcode', 'code_postal', 'cp'])
person('jobtitle', ['jobtitle', 'job_title', 'title_job', 'poste', 'fonction'])

const SYSTEM: Record<string, string> = {}
const sys = (v: string, names: string[]) => names.forEach((n) => (SYSTEM[norm(n)] = v))
sys('unsubscribe_link', ['unsubscribe', 'unsubscribe_url', 'unsubscribe_link', 'unsubscribelink', 'unsub', 'unsub_link', 'unsub_center_url', 'unsubscribe_all', 'desinscription', 'optout', 'opt_out_url'])
sys('view_as_page_url', ['mirror', 'view_online', 'view_in_browser', 'web_view', 'web_view_url', 'webversion', 'web_version', 'permalink', 'archive', 'view_email_url', 'viewaswebpagelink', 'browser_link', 'view_online_url'])
sys('subscription_preference_url', ['update_profile', 'manage_preferences', 'manage_preferences_url', 'preferences_url', 'profile_center_url', 'subscription_center_url', 'email_preference_center', 'preference_center', 'update_profile_url'])
sys('year', ['current_year', 'currentyear', 'year', 'xtyear'])
sys('site_settings.company_name', ['list_company', 'listcompany', 'member_busname', 'sender_name', 'organization', 'company_signature'])
sys('site_settings.company_street_address_1', ['list_address', 'member_addr', 'sender_address', 'organization_address', 'physical_address'])

// Roots whose properties are the recipient's (person.first_name, customer.email…).
const PERSON_ROOTS = new Set(['person', 'customer', 'profile', 'contact', 'subscriber', 'recipient', 'lead', 'user', 'member', 'attributes', 'custom_attributes', 'custom_attribute', 'customattributes', 'client'])
// Roots whose properties are the sender's.
const SENDER_ROOTS = new Set(['organization', 'shop', 'store', 'sender', 'brand', 'account', 'site', 'list', 'system'])
// Containers of the message's own data: their properties become the module's fields.
const DATA_ROOTS = new Set(['params', 'data', 'dynamic_template_data', 'vars', 'var', 'custom', 'event', 'payload', 'my', 'merge', 'template', 'context', 'properties', 'campaign', 'trigger'])
// What a HuBL module already knows.
const HUBL_GLOBALS = new Set([
  'module', 'widget', 'widget_data', 'contact', 'company', 'site_settings', 'request', 'content', 'loop', 'local_dt', 'year', 'true', 'false', 'none', 'null',
  'True', 'False', 'None', 'unsubscribe_link', 'unsubscribe_link_all', 'view_as_page_url', 'subscription_preference_url', 'range', 'caller', 'varargs', 'kwargs', 'super',
])
const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'if', 'else', 'elif', 'true', 'false', 'none', 'null', 'True', 'False', 'None', 'defined', 'undefined'])

/** A variable path of another tool (`person.first_name`) as a module expression. */
function mapPath(path: string): string {
  const parts = path.split('.')
  const root = parts[0]
  const r = norm(root)
  if (parts.length === 1) return PERSONAL[r] ?? (SYSTEM[r] ? SYSTEM[r] : `module.${fieldName(root)}`)
  const rest = parts.slice(1)
  const leaf = norm(rest.join('_'))
  if (PERSON_ROOTS.has(root.toLowerCase())) return SYSTEM[leaf] ?? PERSONAL[leaf] ?? `contact.${snake(rest.join('_'))}`
  if (SENDER_ROOTS.has(root.toLowerCase())) {
    if (SYSTEM[leaf]) return SYSTEM[leaf]
    if (/name$/.test(leaf)) return 'site_settings.company_name'
    if (/addr|address/.test(leaf)) return 'site_settings.company_street_address_1'
    if (/domain|url$/.test(leaf)) return 'site_settings.company_domain'
  }
  if (DATA_ROOTS.has(root.toLowerCase())) {
    if (rest.length === 1 && (PERSONAL[leaf] || SYSTEM[leaf])) return PERSONAL[leaf] ?? SYSTEM[leaf]
    return `module.${rest.map(fieldName).join('.')}`
  }
  return `module.${[root, ...rest].map(fieldName).join('.')}`
}

/**
 * Rewrites the free variables of a HuBL expression (not the locals, the
 * module's own globals, filters, functions, keyword arguments or strings).
 */
function mapVars(expr: string, locals: Set<string>): string {
  let out = ''
  let i = 0
  while (i < expr.length) {
    const c = expr[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < expr.length && expr[j] !== c) j += expr[j] === '\\' ? 2 : 1
      out += expr.slice(i, j + 1)
      i = j + 1
      continue
    }
    const m = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_][\w]*)*/.exec(expr.slice(i))
    if (m && !/[\w.$]/.test(expr[i - 1] ?? '')) {
      const path = m[0]
      const root = path.split('.')[0]
      const before = expr.slice(0, i).replace(/\s+$/, '')
      const after = expr.slice(i + path.length).replace(/^\s+/, '')
      const isFilter = /\|$/.test(before) || /\bis(?:\s+not)?$/.test(before)
      const isCall = after.startsWith('(')
      const isKw = /^=(?!=)/.test(after) && /[(,]$/.test(before)
      const isNum = /^\d/.test(path)
      // contact.PRENOM (Brevo), contact.first_name: HubSpot's property names.
      const contactProp = root === 'contact' && path.includes('.') && !locals.has(root)
      if (!contactProp && (isFilter || isCall || isKw || isNum || KEYWORDS.has(root) || locals.has(root) || HUBL_GLOBALS.has(root))) out += path
      else out += mapPath(path.replace(/^\$/, ''))
      i += path.length
      continue
    }
    out += c
    i++
  }
  return out
}

// ---------------------------------------------------------------------------
// MJML → table HTML (the parts e-mails use; the rest keeps its content).

function mjmlToHtml(src: string): string | null {
  if (!/<mj-(?:body|section|column|text)\b/i.test(src)) return null
  const doc = parseDocument(src, { xmlMode: false, lowerCaseAttributeNames: true, recognizeSelfClosing: true })
  const styles: string[] = []
  const esc = (s: string) => s.replace(/"/g, '&quot;')
  const css = (pairs: Record<string, string | undefined>) =>
    Object.entries(pairs)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}:${v}`)
      .join(';')
  const inner = (n: Element): string => n.children.map(html).join('')
  const raw = (n: ChildNode): string => {
    if (n.type === 'text') return (n as unknown as { data: string }).data
    if (n.type === 'comment') return ''
    if (!('name' in n)) return ''
    const el = n as Element
    const attrs = Object.entries(el.attribs)
      .map(([k, v]) => ` ${k}="${esc(v)}"`)
      .join('')
    if (/^(br|img|hr|meta|link|input)$/.test(el.name)) return `<${el.name}${attrs}>`
    return `<${el.name}${attrs}>${el.children.map(raw).join('')}</${el.name}>`
  }
  const html = (n: ChildNode): string => {
    if (n.type === 'text') return (n as unknown as { data: string }).data
    if (n.type === 'comment' || !('name' in n)) return ''
    const el = n as Element
    const a = el.attribs
    const pad = a.padding
    switch (el.name) {
      case 'mjml':
      case 'mj-body':
        return inner(el)
      case 'mj-head':
        el.children.forEach((c) => 'name' in c && (c as Element).name === 'mj-style' && styles.push((c as Element).children.map(raw).join('')))
        return ''
      case 'mj-wrapper':
      case 'mj-hero':
      case 'mj-section': {
        const cols = el.children.filter((c): c is Element => 'name' in c && /^mj-(column|group)$/.test((c as Element).name))
        const bg = a['background-color']
        const style = css({ padding: pad ?? '20px 0', background: bg, 'background-image': a['background-url'] ? `url('${a['background-url']}')` : undefined, 'border-radius': a['border-radius'], 'text-align': a['text-align'] })
        if (el.name === 'mj-wrapper' || !cols.length)
          return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="${style}">${inner(el)}</td></tr></table>\n`
        const tds = cols
          .map((c) => {
            const w = c.attribs.width ?? `${Math.round(100 / cols.length)}%`
            const cs = css({ padding: c.attribs.padding ?? '0 12px', background: c.attribs['background-color'], 'vertical-align': c.attribs['vertical-align'] ?? 'top' })
            return `<td width="${esc(w)}" valign="top" style="${cs}">${inner(c)}</td>`
          })
          .join('')
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${style}"><tr>${tds}</tr></table>\n`
      }
      case 'mj-column':
      case 'mj-group':
        return inner(el)
      case 'mj-text': {
        const style = css({ 'font-size': a['font-size'], color: a.color, 'font-family': a['font-family'], 'line-height': a['line-height'], 'text-align': a.align, 'font-weight': a['font-weight'], padding: pad, margin: '0 0 12px' })
        const body = el.children.map(raw).join('').trim()
        // A big short text is a title.
        if ((Number.parseInt(a['font-size'] ?? '') || 0) >= 22 && !/<[a-z]/i.test(body) && body.length <= 120) return `<h2 style="${style}">${body}</h2>\n`
        return /^<(h[1-6]|p|ul|ol|table|div)\b/i.test(body) ? `<div style="${style}">${body}</div>\n` : `<p style="${style}">${body}</p>\n`
      }
      case 'mj-image': {
        const w = a.width ? Number.parseInt(a.width) || 600 : 600
        const img = `<img src="${esc(a.src ?? '')}" alt="${esc(a.alt ?? '')}" width="${w}" style="display:block;max-width:100%;height:auto${a['border-radius'] ? `;border-radius:${a['border-radius']}` : ''}">`
        const linked = a.href ? `<a href="${esc(a.href)}">${img}</a>` : img
        return `<div style="text-align:${a.align ?? 'center'};margin:0 0 12px">${linked}</div>\n`
      }
      case 'mj-button': {
        const style = css({
          display: 'inline-block',
          background: a['background-color'] ?? '#414141',
          color: a.color ?? '#ffffff',
          padding: a['inner-padding'] ?? '10px 25px',
          'border-radius': a['border-radius'] ?? '3px',
          'font-size': a['font-size'] ?? '13px',
          'font-weight': a['font-weight'],
          'font-family': a['font-family'],
          'text-decoration': 'none',
        })
        return `<p style="text-align:${a.align ?? 'center'};margin:0 0 12px"><a href="${esc(a.href ?? '#')}" style="${style}">${el.children.map(raw).join('').trim()}</a></p>\n`
      }
      case 'mj-divider':
        return `<hr style="border:0;border-top:${a['border-width'] ?? '4px'} ${a['border-style'] ?? 'solid'} ${a['border-color'] ?? '#000000'};margin:16px 0">\n`
      case 'mj-spacer':
        return `<div style="height:${a.height ?? '20px'};line-height:${a.height ?? '20px'}">&nbsp;</div>\n`
      case 'mj-raw':
        return el.children.map(raw).join('')
      case 'mj-social':
        return `<p style="text-align:${a.align ?? 'center'}">${el.children
          .filter((c): c is Element => 'name' in c)
          .map((c) => `<a href="${esc(c.attribs.href ?? '#')}" style="color:${c.attribs.color ?? a.color ?? '#333333'};margin:0 6px">${c.children.map(raw).join('').trim() || c.attribs.name || 'Lien'}</a>`)
          .join(' ')}</p>\n`
      case 'mj-navbar':
        return `<p style="text-align:${a.align ?? 'center'}">${el.children
          .filter((c): c is Element => 'name' in c)
          .map((c) => `<a href="${esc(c.attribs.href ?? '#')}" style="color:${c.attribs.color ?? '#333333'};margin:0 8px;text-decoration:none">${c.children.map(raw).join('').trim()}</a>`)
          .join(' ')}</p>\n`
      case 'mj-attributes':
      case 'mj-preview':
      case 'mj-title':
      case 'mj-font':
      case 'mj-breakpoint':
      case 'mj-style':
        return ''
      default:
        return /^mj-/.test(el.name) ? inner(el) : raw(el)
    }
  }
  const body = doc.children.map(html).join('').trim()
  return `${styles.length ? `<style>\n${styles.join('\n')}\n</style>\n` : ''}${body}`
}

// ---------------------------------------------------------------------------
// Handlebars / Mustache → HuBL.

const HB_MARK = /\{\{\s*[#^/!>]|\{\{\s*else\s*\}\}|\{\{\{|\{\{\s*@(?:index|first|last|key)\b/
const HB_OPS: Record<string, string> = {
  eq: '==', is: '==', equals: '==', equal: '==', ifequals: '==', ne: '!=', neq: '!=', isnt: '!=', notequals: '!=', noteq: '!=',
  gt: '>', greaterthan: '>', gte: '>=', lt: '<', lessthan: '<', lte: '<=',
}

function hbArgs(s: string): string[] {
  const out: string[] = []
  const re = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()]|\([^()]*\))*\)|[^\s()]+/g
  for (let m = re.exec(s); m; m = re.exec(s)) out.push(m[0])
  return out
}

function convertHandlebars(code: string): { code: string; n: number } {
  if (!HB_MARK.test(code)) return { code, n: 0 }
  let n = 0
  code = code.replace(/\{\{!--[\s\S]*?--\}\}|\{\{![\s\S]*?\}\}/g, () => (n++, ''))
  code = code.replace(/\{\{\s*>[^}]*\}\}/g, () => (n++, '')) // partials: not in the pasted code
  code = code.replace(/\{\{\{\s*([\s\S]*?)\s*\}\}\}/g, (_m, e: string) => (n++, `{{ ${e} }}`)).replace(/\{\{&\s*([^}]*?)\s*\}\}/g, (_m, e: string) => (n++, `{{ ${e} }}`))
  const stack: { kind: 'if' | 'unless' | 'for' | 'with'; item?: string; prefix?: string }[] = []
  const used = new Set<string>()
  const itemName = (list: string) => {
    const base = snake(list.split('.').pop() ?? 'item').replace(/(ies)$/, 'y').replace(/s$/, '') || 'item'
    let name = base === snake(list.split('.').pop() ?? '') ? `${base}_item` : base
    while (used.has(name)) name = `${name}_`
    used.add(name)
    return name
  }
  // A Handlebars path in the current context.
  const path = (p: string): string => {
    if (/^["'\d]/.test(p) || p === 'true' || p === 'false' || p === 'null') return p
    if (p.startsWith('(')) return sub(p.slice(1, -1))
    const loop = [...stack].reverse().find((f) => f.kind === 'for')
    if (p === '@index') return 'loop.index0'
    if (p === '@first') return 'loop.first'
    if (p === '@last') return 'loop.last'
    if (p === '@key') return 'loop.index0'
    if (p.startsWith('@root.')) return p.slice(6)
    if (/^(\.\.\/)+/.test(p)) return p.replace(/^(\.\.\/)+/, '')
    const withF = [...stack].reverse().find((f) => f.kind === 'with')
    if (p === 'this' || p === '.') return loop?.item ?? 'item'
    if (p.startsWith('this.')) return `${loop?.item ?? 'item'}.${p.slice(5)}`
    if (loop) return `${loop.item}.${p}`
    if (withF?.prefix) return `${withF.prefix}.${p}`
    return p
  }
  const sub = (expr: string): string => {
    const [h, ...args] = hbArgs(expr.trim())
    const op = HB_OPS[(h ?? '').toLowerCase()]
    if (op && args.length >= 2) return `(${path(args[0])} ${op} ${path(args[1])})`
    if (/^(and|or)$/i.test(h) && args.length) return `(${args.map(path).join(` ${h.toLowerCase()} `)})`
    if (/^not$/i.test(h) && args.length) return `(not ${path(args[0])})`
    if (args.length) return path(args[0])
    return path(h ?? '')
  }
  code = code.replace(/\{\{~?\s*([#^/]?)\s*([\s\S]*?)\s*~?\}\}/g, (m, sigil: string, body: string) => {
    if (sigil === '#') {
      const [h, ...args] = hbArgs(body)
      const name = (h ?? '').toLowerCase()
      n++
      if (name === 'if' || name === 'unless') {
        stack.push({ kind: name })
        return `{% ${name} ${sub(args.join(' '))} %}`
      }
      if (name === 'each') {
        const as = /\bas\s+\|\s*(\w+)/.exec(body)
        const list = path(args[0] ?? 'items')
        const item = as?.[1] ?? itemName(args[0] ?? 'items')
        stack.push({ kind: 'for', item })
        return `{% for ${item} in ${list} %}`
      }
      if (name === 'with') {
        stack.push({ kind: 'with', prefix: path(args[0] ?? '') })
        return ''
      }
      if (HB_OPS[name] || name === 'and' || name === 'or' || name === 'not') {
        stack.push({ kind: 'if' })
        return `{% if ${sub(body)} %}`
      }
      // Mustache section: shown when the value is there.
      stack.push({ kind: 'if' })
      return `{% if ${path(h ?? '')} %}`
    }
    if (sigil === '^') {
      n++
      stack.push({ kind: 'if' })
      return `{% if not ${path(body.split(/\s+/)[0])} %}`
    }
    if (sigil === '/') {
      n++
      const f = stack.pop()
      return !f || f.kind === 'with' ? '' : f.kind === 'for' ? '{% endfor %}' : f.kind === 'unless' ? '{% endunless %}' : '{% endif %}'
    }
    const elseIf = /^else\s+if\s+([\s\S]+)$/.exec(body)
    if (elseIf) return (n++, `{% elif ${sub(elseIf[1])} %}`)
    if (body === 'else') return (n++, '{% else %}')
    if (!stack.length && !/^[@.]|^this\b|\s/.test(body)) return m.replace(/^\{\{~/, '{{').replace(/~\}\}$/, '}}')
    // A value, or a helper with arguments ({{formatDate date "…"}}, {{insert name "default=x"}}).
    const args = hbArgs(body)
    if (args.length > 1 && /^[A-Za-z_]\w*$/.test(args[0]) && !/^(and|or|if|is|in|not|~|\||\+|-|\*|\/|==|!=)$/.test(args[1])) {
      n++
      const def = args.find((a) => /^["']default=/.test(a))
      return `{{ ${path(args[1])}${def ? `|default(${quote(def.slice(9, -1))})` : ''} }}`
    }
    if (/^[@.]|^this\b|^\.\.\//.test(body) || stack.some((f) => f.kind === 'for' || f.kind === 'with')) {
      n++
      return `{{ ${path(body)} }}`
    }
    return m
  })
  return { code, n }
}

// ---------------------------------------------------------------------------
// Liquid / Django templates → HuBL.

const LIQUID_MARK = /\{%-?\s*(?:assign|capture|comment|elsif|case|when|endcase|tablerow|render|liquid|increment|decrement|cycle|unsubscribe|manage_preferences|web_view|connected_content|abort_message|load|firstof|with|empty)\b|forloop\.|\{\{[^}]*\|\s*\w+\s*:/
const LIQUID_FILTERS: Record<string, string> = {
  upcase: 'upper', downcase: 'lower', capitalize: 'capitalize', strip: 'trim', lstrip: 'trim', rstrip: 'trim', size: 'length', length: 'length',
  date: 'datetimeformat', escape: 'escape', escape_once: 'escape', url_encode: 'urlencode', urlencode: 'urlencode', truncate: 'truncate', truncatechars: 'truncate',
  truncatewords: 'wordcount', join: 'join', first: 'first', last: 'last', reverse: 'reverse', sort: 'sort', uniq: 'unique', round: 'round', abs: 'abs',
  replace: 'replace', remove: 'replace', split: 'split', title: 'title', lower: 'lower', upper: 'upper', default: 'default', striptags: 'striptags',
  strip_html: 'striptags', newline_to_br: 'replace', floatformat: 'round', safe: '', raw: '', json: 'tojson', jsonify: 'tojson', map: 'map', where: 'selectattr',
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let q = ''
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '\\') {
        cur += c + (s[i + 1] ?? '')
        i++
        continue
      }
      if (c === q) q = ''
    } else if (c === '"' || c === "'") q = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && c === sep && !(sep === '|' && (s[i + 1] === '|' || s[i - 1] === '|'))) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

/** `x | default: "toi" | upcase` → `x|default("toi")|upper` (unknown filters dropped). */
function liquidChain(expr: string, dropped: { n: number }, liquid = true): string {
  const parts = splitTop(expr, '|')
  if (parts.length < 2) return expr
  // Only chains written the Liquid way (name: args, or, in Liquid code, names HuBL lacks).
  if (!parts.slice(1).some((p) => /^\s*\w+\s*:/.test(p) || (liquid && !/\(/.test(p) && !FILTER_NAMES.has(p.trim()) && p.trim() in LIQUID_FILTERS))) return expr
  let base = parts[0].trim()
  for (const p of parts.slice(1)) {
    const m = /^\s*(\w+)\s*(?::\s*([\s\S]*))?$/.exec(p)
    if (!m) {
      base = `${base}|${p.trim()}`
      continue
    }
    const name = m[1]
    const args = m[2] ? splitTop(m[2], ',').map((a) => a.trim()).filter(Boolean) : []
    if (/^(append|prepend|plus|minus|times|divided_by|modulo|add)$/.test(name) && args[0]) {
      const op = { append: '~', add: '+', plus: '+', minus: '-', times: '*', divided_by: '/', modulo: '%' }[name as 'append']
      base = name === 'prepend' ? `(${args[0]} ~ ${base})` : `(${base} ${op} ${args[0]})`
      continue
    }
    if (name === 'remove' && args[0]) {
      base = `${base}|replace(${args[0]}, "")`
      continue
    }
    if (name === 'newline_to_br') {
      base = `${base}|replace("\\n", "<br>")`
      continue
    }
    const to = FILTER_NAMES.has(name) && !(name in LIQUID_FILTERS) ? name : LIQUID_FILTERS[name]
    if (to === '') continue
    if (!to || !FILTER_NAMES.has(to)) {
      // HuBL code keeps the filters the preview doesn't know; another tool's are dropped.
      if (liquid) {
        dropped.n++
        continue
      }
      base = `${base}|${name}${args.length ? `(${args.join(', ')})` : ''}`
      continue
    }
    base = `${base}|${to}${args.length ? `(${args.join(', ')})` : ''}`
  }
  return base
}

const OPERAND = String.raw`(?:"[^"]*"|'[^']*'|[\w.$\[\]]+)`
function liquidCondition(c: string): string {
  return c
    .replace(new RegExp(`(${OPERAND})\\s+contains\\s+(${OPERAND})`, 'g'), '$2 in $1')
    .replace(new RegExp(`(${OPERAND})\\s*(==|!=)\\s*(?:blank|empty)\\b`, 'g'), (_m, a: string, op: string) => (op === '==' ? `not ${a}` : a))
    .replace(/\bnil\b/g, 'none')
    .replace(/\bforloop\.(index0|index|first|last|length|rindex|counter0|counter)\b/g, (_m, k: string) => `loop.${k === 'counter' ? 'index' : k === 'counter0' ? 'index0' : k === 'rindex' ? 'revindex' : k}`)
}

function convertLiquid(code: string, force: boolean): { code: string; n: number; dropped: number; removed: number } {
  const liquid = force || LIQUID_MARK.test(code)
  let n = 0
  let removed = 0
  const dropped = { n: 0 }
  // Filters and forloop everywhere, even without other Liquid tags (Brevo, Django).
  const exprs = (s: string) =>
    s.replace(/\{\{(-?)([\s\S]*?)(-?)\}\}/g, (m, a: string, e: string, b: string) => {
      const next = liquid ? liquidCondition(liquidChain(e.trim(), dropped)) : liquidChain(e.trim(), dropped, false)
      if (next === e.trim()) return m
      n++
      return `{{${a} ${next} ${b}}}`
    })
  // Braze ${first_name} and Klaviyo person|lookup:'VIP' inside HuBL delimiters.
  code = code.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, (m) =>
    m.replace(/\$\{\s*([\w.]+)\s*\}/g, (_x, v: string) => (n++, v)).replace(/([\w.]+)\s*\|\s*lookup\s*:\s*["']([\w ]+)["']/g, (_x, o: string, k: string) => (n++, `${o}.${k.replace(/\s+/g, '_')}`)),
  )
  code = exprs(code)
  if (!liquid) return { code, n, dropped: dropped.n, removed }

  code = code.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, () => (n++, ''))
  code = code.replace(/\{%-?\s*#[^%]*-?%\}/g, () => (n++, ''))
  code = code.replace(/\{%-?\s*liquid\b[\s\S]*?-?%\}/g, () => (removed++, ''))
  code = code.replace(/\{%-?\s*connected_content\b[\s\S]*?-?%\}|\{%-?\s*abort_message\b[\s\S]*?-?%\}|\{%-?\s*(?:load|csrf_token|increment|decrement|layout|paginate|endpaginate|form|endform|schema|endschema|javascript|endjavascript|stylesheet|endstylesheet)\b[^%]*-?%\}/g, () => (removed++, ''))
  code = code.replace(/\{%-?\s*(?:render|include|section|sections)\s+['"][^'"]*['"][^%]*-?%\}/g, () => (removed++, ''))
  // Klaviyo links.
  const link = (href: string, text: string) => `<a href="{{ ${href} }}">${text}</a>`
  code = code
    .replace(/\{%-?\s*unsubscribe(?:_link)?(?:\s+['"]([^'"]*)['"])?\s*-?%\}/g, (_m, t?: string) => (n++, link('unsubscribe_link', t || 'Se désinscrire')))
    .replace(/\{%-?\s*unsubscribe_url\s*-?%\}/g, () => (n++, '{{ unsubscribe_link }}'))
    .replace(/\{%-?\s*manage_preferences(?:_link)?(?:\s+['"]([^'"]*)['"])?\s*-?%\}/g, (_m, t?: string) => (n++, link('subscription_preference_url', t || 'Gérer mes préférences')))
    .replace(/\{%-?\s*manage_preferences_url\s*-?%\}/g, () => (n++, '{{ subscription_preference_url }}'))
    .replace(/\{%-?\s*web_view(?:_link)?(?:\s+['"]([^'"]*)['"])?\s*-?%\}/g, (_m, t?: string) => (n++, link('view_as_page_url', t || 'Voir en ligne')))
    .replace(/\{%-?\s*web_view_url\s*-?%\}/g, () => (n++, '{{ view_as_page_url }}'))
    .replace(/\{%-?\s*now\s+['"][^'"]*['"]\s*-?%\}/g, () => (n++, '{{ year }}'))
  // {% firstof a b "x" %} (Django)
  code = code.replace(/\{%-?\s*firstof\s+([\s\S]*?)\s*-?%\}/g, (_m, a: string) => (n++, `{{ ${hbArgs(a).join(' or ')} }}`))

  // {% capture x %}…{% endcapture %}: inlined where printed, or a plain {% set %}.
  const captures = new Map<string, string>()
  code = code.replace(/\{%-?\s*capture\s+(\w+)\s*-?%\}([\s\S]*?)\{%-?\s*endcapture\s*-?%\}/g, (_m, name: string, body: string) => {
    n++
    const b = body.trim()
    if (!/\{%/.test(b) && !/\{\{/.test(b)) return `{% set ${name} = ${quote(b)} %}`
    captures.set(name, b)
    return ''
  })
  for (const [name, body] of captures) code = code.replace(new RegExp(`\\{\\{-?\\s*${name}\\s*-?\\}\\}`, 'g'), body)

  // {% case x %}{% when a, b %}…{% else %}…{% endcase %} → if / elif / else.
  code = code.replace(/\{%-?\s*case\s+([\s\S]*?)\s*-?%\}([\s\S]*?)\{%-?\s*endcase\s*-?%\}/g, (_m, subject: string, body: string) => {
    n++
    let first = true
    const start = body.search(/\{%-?\s*(when|else)\b/)
    return (
      (start < 0 ? '' : body.slice(start)).replace(/\{%-?\s*when\s+([\s\S]*?)\s*-?%\}/g, (_w, vals: string) => {
        const list = splitTop(vals.replace(/\s+or\s+/g, ','), ',').map((v) => v.trim()).filter(Boolean)
        const cond = list.length > 1 ? `${subject} in [${list.join(', ')}]` : `${subject} == ${list[0]}`
        const tag = first ? `{% if ${cond} %}` : `{% elif ${cond} %}`
        first = false
        return tag
      }) + (first ? '' : '{% endif %}')
    )
  })

  code = code.replace(/\{%(-?)\s*(\w+)([\s\S]*?)(-?)%\}/g, (m, a: string, tag: string, rest: string, b: string) => {
    const r = rest.trim()
    const wrap = (s: string) => `{%${a} ${s} ${b}%}`
    switch (tag) {
      case 'assign': {
        const f = /^([\w.]+)\s*=\s*([\s\S]+)$/.exec(r)
        n++
        return f ? wrap(`set ${f[1]} = ${liquidCondition(liquidChain(f[2], dropped))}`) : ''
      }
      case 'elsif':
        n++
        return wrap(`elif ${liquidCondition(r)}`)
      case 'if':
      case 'elif':
      case 'unless': {
        const c = liquidCondition(liquidChain(r, dropped))
        if (c !== r) n++
        return wrap(`${tag} ${c}`)
      }
      case 'for':
      case 'tablerow': {
        const f = /^(\w+(?:\s*,\s*\w+)?)\s+in\s+(\([^)]*\)|[^\s]+)\s*([\s\S]*)$/.exec(r)
        if (!f) return m
        const opts = f[3]
        if (!opts && tag === 'for') return m
        n++
        let list = f[2]
        const range = /^\((\S+)\.\.(\S+)\)$/.exec(list)
        if (range) list = `range(${range[1]}, ${range[2]} + 1)`
        if (/\breversed\b/.test(opts)) list = `${list}|reverse`
        return wrap(`for ${f[1]} in ${list}`)
      }
      case 'endtablerow':
        n++
        return wrap('endfor')
      case 'empty':
        n++
        return wrap('else')
      case 'with': {
        const sets = [...r.matchAll(/(\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g)].map((x) => `{% set ${x[1]} = ${x[2]} %}`)
        n++
        return sets.join('')
      }
      case 'endwith':
      case 'endunless':
        if (tag === 'endwith') {
          n++
          return ''
        }
        return m
      case 'cycle':
        n++
        return `{{ ${hbArgs(r.replace(/^[^:]*:\s*/, '').replace(/,/g, ' '))[0] ?? '""'} }}`
      default:
        return m
    }
  })
  return { code, n, dropped: dropped.n, removed }
}

// ---------------------------------------------------------------------------
// Mailchimp *|MERGE|* tags.

function convertMailchimp(code: string): { code: string; n: number } {
  if (!/\*\|[^|*]+\|\*|\bmc:(?:edit|repeatable|variant|hideable)/.test(code)) return { code, n: 0 }
  let n = 0
  code = code.replace(/\s+mc:(?:edit|repeatable|variant|hideable|label|allowdesigner|allowtext)(?:="[^"]*")?/g, '')
  const v = (name: string) => name.trim().replace(/^MERGE\d*$/i, (x) => x.toLowerCase())
  const cond = (c: string) => {
    const m = /^([\w:]+)\s*(=|!=|>=|<=|>|<)\s*(.+)$/.exec(c.trim())
    if (!m) return v(c)
    const value = /^-?\d+(\.\d+)?$/.test(m[3].trim()) ? m[3].trim() : quote(m[3].trim())
    return `${v(m[1])} ${m[2] === '=' ? '==' : m[2]} ${value}`
  }
  code = code.replace(/\*\|([^|*]+)\|\*/g, (_m, raw: string) => {
    const t = raw.trim()
    n++
    let m: RegExpExecArray | null
    if ((m = /^IF:(.+)$/i.exec(t))) return `{% if ${cond(m[1])} %}`
    if ((m = /^IFNOT:(.+)$/i.exec(t))) return `{% if not (${cond(m[1])}) %}`
    if ((m = /^ELSEIF:(.+)$/i.exec(t))) return `{% elif ${cond(m[1])} %}`
    if (/^ELSE:?$/i.test(t)) return '{% else %}'
    if (/^END:(IF|INTERESTED)$/i.test(t)) return '{% endif %}'
    if (/^INTERESTED:/i.test(t)) return '{% if true %}'
    if (/^(UNSUB|UNSUBSCRIBE)$/i.test(t)) return '{{ unsubscribe_link }}'
    if (/^(UPDATE_PROFILE|EMAIL_PREFS)$/i.test(t)) return '{{ subscription_preference_url }}'
    if (/^(ARCHIVE|ARCHIVE_LINK_SHORT)$/i.test(t)) return '{{ view_as_page_url }}'
    if (/^FORWARD$/i.test(t)) return '#'
    if (/^(LIST:(COMPANY|NAME)|LIST_COMPANY)$/i.test(t)) return '{{ site_settings.company_name }}'
    if (/^(LIST:ADDRESS(LINE)?|HTML:LIST_ADDRESS(_HTML)?|LIST:ADDRESS_VCARD|LIST_ADDRESS)$/i.test(t)) return '{{ site_settings.company_street_address_1 }}, {{ site_settings.company_city }}'
    if (/^(CURRENT_YEAR|DATE:Y)$/i.test(t)) return '{{ year }}'
    if (/^(MC:DATE|DATE:.*)$/i.test(t)) return '{{ local_dt|datetimeformat("%d/%m/%Y") }}'
    if (/^(MC_PREVIEW_TEXT|MC:SUBJECT|MC:TOC|REWARDS|REWARDS_TEXT|MC_LANGUAGE(_LABEL)?|LIST:DESCRIPTION|LIST:URL|LIST:SUB|USER:.*|ABOUT_LIST|POSTAL_ADDRESS|MC:SHARE|MC:TRANSLATE|LIST:RECIPIENTS|MC_ACCOUNT_.*)$/i.test(t)) return ''
    if ((m = /^HTML:(.+)$/i.exec(t))) return `{{ ${v(m[1])} }}`
    if ((m = /^(TITLE|LOWER|UPPER):(.+)$/i.exec(t))) return `{{ ${v(m[2])}|${m[1].toLowerCase()} }}`
    return `{{ ${v(t)} }}`
  })
  return { code, n }
}

// ---------------------------------------------------------------------------
// Salesforce Marketing Cloud AMPscript and personalization strings (also Pardot).

function convertAmpscript(code: string): { code: string; n: number; dropped: number } {
  if (!/%%\[|%%=|%%[A-Za-z_][\w]*%%/.test(code)) return { code, n: 0, dropped: 0 }
  let n = 0
  let dropped = 0
  const alias = new Map<string, string>()
  const attr = (s: string) => {
    const m = /^\s*(?:AttributeValue\(\s*["']([^"']+)["']\s*\)|\[([^\]]+)\])\s*$/i.exec(s)
    return m ? (m[1] ?? m[2]) : null
  }
  code = code.replace(/%%\[([\s\S]*?)\]%%/g, (_m, body: string) => {
    n++
    const sets: string[] = []
    for (const m of body.matchAll(/\bSET\s+@(\w+)\s*=\s*([^\n]+?)(?=\s+(?:SET|IF|ELSE|ENDIF|VAR|ENDFOR|NEXT)\b|\n|$)/gi)) {
      const a = attr(m[2])
      if (a) alias.set(m[1].toLowerCase(), a)
      else if (/^\s*(["'])[^"']*\1\s*$/.test(m[2]) && !alias.has(m[1].toLowerCase())) sets.push(`{% set ${snake(m[1])} = ${m[2].trim()} %}`)
    }
    if (/\b(IF|FOR|LookupRows|Lookup|InsertDE|UpsertDE|HTTPGet|ContentBlockBy)/i.test(body)) dropped++
    return sets.join('\n')
  })
  const value = (e: string): string => {
    const t = e.trim()
    let m: RegExpExecArray | null
    if ((m = /^v\(\s*@(\w+)\s*\)$/i.exec(t)) || (m = /^@(\w+)$/.exec(t))) return alias.get(m[1].toLowerCase()) ?? snake(m[1])
    if ((m = /^(?:RedirectTo|Concat|Trim|ProperCase|Lowercase|Uppercase)\(\s*([\s\S]+?)\s*\)$/i.exec(t))) return value(m[1])
    if ((m = /^AttributeValue\(\s*["']([^"']+)["']\s*\)$/i.exec(t))) return m[1]
    if ((m = /^["']([^"']*)["']$/.exec(t))) return `"${m[1]}"`
    return ''
  }
  code = code.replace(/%%=([\s\S]*?)=%%/g, (_m, e: string) => {
    n++
    const v = value(e)
    if (!v) {
      dropped++
      return ''
    }
    if (/^"/.test(v)) return v.slice(1, -1)
    return `{{ ${v} }}`
  })
  code = code.replace(/%%([A-Za-z_][\w]*)%%/g, (_m, name: string) => (n++, `{{ ${name} }}`))
  // Aliases set from attributes ({{ name }} after SET @name = AttributeValue("FirstName")).
  for (const [a, f] of alias) code = code.replace(new RegExp(`\\{\\{\\s*${a}\\s*\\}\\}`, 'gi'), `{{ ${f.replace(/\s+/g, '_')} }}`)
  return { code, n, dropped }
}

// ---------------------------------------------------------------------------
// Mailjet ([[var:x:"…"]], {{var:x}}, [[data:x]], [[UNSUB_LINK_FR]]…).

function convertMailjet(code: string): { code: string; n: number } {
  if (!/\[\[(?:var|data):|\{\{\s*(?:var|data):|\[\[(?:UNSUB_LINK|PERMALINK|SHORT_PERMALINK|UPDATE_PROFILE)|\{%[^%]*\b(?:var|data):\w/.test(code)) return { code, n: 0 }
  let n = 0
  const ref = (kind: string, name: string, def?: string) => `${kind === 'data' ? `contact.${snake(name)}` : name}${def !== undefined ? `|default(${quote(def)})` : ''}`
  code = code.replace(/(?:\[\[|\{\{)\s*(var|data):([\w.]+)(?::\s*"([^"]*)")?\s*(?:\]\]|\}\})/g, (_m, k: string, name: string, def?: string) => (n++, `{{ ${ref(k, name, def)} }}`))
  code = code.replace(/\[\[(UNSUB_LINK(?:_\w+)?)\]\]/g, () => (n++, '{{ unsubscribe_link }}'))
  code = code.replace(/\[\[(?:SHORT_)?PERMALINK\]\]/g, () => (n++, '{{ view_as_page_url }}'))
  code = code.replace(/\[\[UPDATE_PROFILE(?:_\w+)?\]\]/g, () => (n++, '{{ subscription_preference_url }}'))
  code = code.replace(/\{%([\s\S]*?)%\}/g, (m, body: string) => (/\b(?:var|data):\w/.test(body) ? (n++, `{%${body.replace(/\b(var|data):([\w.]+)/g, (_x, k: string, name: string) => ref(k, name))}%}`) : m))
  return { code, n }
}

// ---------------------------------------------------------------------------
// Marketo: <meta class="mktoString" id="x" mktoName="…" default="…"> variables
// used as ${x}, and {{lead.First Name:default=…}} / {{my.Token}} tokens.

const MKTO_TYPES: Record<string, string> = { mktostring: 'text', mktohtml: 'richtext', mktocolor: 'color', mktoboolean: 'boolean', mktonumber: 'number', mktoimg: 'image', mktolist: 'choice' }

function convertMarketo(code: string, specs: FieldSpec[]): { code: string; n: number } {
  // {{ company.name }} is also HuBL: Marketo's company / campaign tokens only in a Marketo template.
  const mkto = /class=["']mkto|mktoName/.test(code)
  if (!mkto && !/\{\{\s*(?:lead|my|system|member|trigger)\.[^}]+\}\}/.test(code)) return { code, n: 0 }
  let n = 0
  const kinds = new Map<string, string>()
  code = code.replace(/<meta\b[^>]*\bclass=["'](mkto\w+)["'][^>]*>/gi, (tag, cls: string) => {
    const type = MKTO_TYPES[cls.toLowerCase()]
    const at = (k: string) => new RegExp(`\\b${k}=["']([^"']*)["']`, 'i').exec(tag)?.[1]
    const id = at('id')
    if (!type || !id) return ''
    n++
    const name = snake(id)
    kinds.set(id, type)
    const def = at('default') ?? ''
    const spec: FieldSpec = { name, label: at('mktoName') ?? id, type, default: type === 'image' ? { src: def, alt: '' } : type === 'boolean' ? /^true$/i.test(def) : type === 'number' ? Number(def) || 0 : type === 'color' ? { color: def || '#000000', opacity: 100 } : def }
    if (type === 'choice') {
      const values = (at('values') ?? '').split(',').map((v) => v.trim()).filter(Boolean)
      spec.raw = { name, label: spec.label, type, choices: values.map((v) => [v, v]), default: def || values[0] }
      spec.default = def || values[0]
    }
    if (!specs.some((s) => s.name === name)) specs.push(spec)
    return ''
  })
  code = code.replace(/\$\{([A-Za-z_][\w]*)\}/g, (m, id: string) => {
    const type = kinds.get(id)
    if (!type) return m
    n++
    return `{{ module.${snake(id)}${type === 'image' ? '.src' : type === 'color' ? '.color' : ''} }}`
  })
  const tokens = mkto ? /\{\{\s*(lead|my|system|company|member|trigger|campaign)\.([^}:]+?)\s*(?::default=([^}]*))?\}\}/g : /\{\{\s*(lead|my|system|member|trigger)\.([^}:]+?)\s*(?::default=([^}]*))?\}\}/g
  code = code.replace(tokens, (_m, root: string, prop: string, def?: string) => {
    n++
    const p = prop.trim()
    const target =
      root === 'system'
        ? (SYSTEM[norm(p.replace(/link$/i, ''))] ?? SYSTEM[norm(p)] ?? (/unsubscribe/i.test(p) ? 'unsubscribe_link' : /webpage|view/i.test(p) ? 'view_as_page_url' : /date/i.test(p) ? 'year' : `module.${snake(p)}`))
        : root === 'lead' || root === 'member'
          ? (PERSONAL[norm(p)] ?? `contact.${snake(p)}`)
          : root === 'company'
            ? (/name/i.test(p) ? 'contact.company' : `contact.${snake(p)}`)
            : `module.${snake(p)}`
    return `{{ ${target}${def ? `|default(${quote(def.trim())})` : ''} }}`
  })
  return { code, n }
}

// ---------------------------------------------------------------------------

/** Variables, set names, loop variables and macro parameters defined by the code itself. */
function localsOf(code: string): Set<string> {
  const out = new Set<string>(['item', 'loop'])
  for (const m of code.matchAll(/\{%-?\s*set\s+(\w+)/g)) out.add(m[1])
  for (const m of code.matchAll(/\{%-?\s*for\s+([\w\s,]+?)\s+in\b/g)) m[1].split(',').forEach((x) => out.add(x.trim()))
  for (const m of code.matchAll(/\{%-?\s*macro\s+(\w+)\s*\(([^)]*)\)/g)) {
    out.add(m[1])
    m[2].split(',').forEach((p) => p.trim() && out.add(p.split('=')[0].trim()))
  }
  return out
}

/** Free variables of another tool's code → contact / system / module fields. */
function mapVariables(code: string): { code: string; n: number } {
  const locals = localsOf(code)
  let n = 0
  const map = (e: string) => {
    const next = mapVars(e, locals)
    if (next !== e) n++
    return next
  }
  code = code.replace(/\{\{(-?)([\s\S]*?)(-?)\}\}/g, (_m, a: string, e: string, b: string) => `{{${a} ${map(e.trim())} ${b}}}`)
  code = code.replace(/\{%(-?)\s*(if|elif|unless|for|set)\b([\s\S]*?)(-?)%\}/g, (m, a: string, tag: string, rest: string, b: string) => {
    if (tag === 'for') {
      const f = /^\s*([\w\s,]+?)\s+in\s+([\s\S]+?)\s*$/.exec(rest)
      return f ? `{%${a} for ${f[1]} in ${map(f[2])} ${b}%}` : m
    }
    if (tag === 'set') {
      const f = /^\s*(\w+)\s*=\s*([\s\S]+?)\s*$/.exec(rest)
      return f ? `{%${a} set ${f[1]} = ${map(f[2])} ${b}%}` : m
    }
    return `{%${a} ${tag} ${map(rest.trim())} ${b}%}`
  })
  return { code, n }
}

/** Converts what another platform wrote into HuBL; HuBL code comes back unchanged. */
export function convertForeign(input: string): ForeignResult {
  const repairs: string[] = []
  const platforms: string[] = []
  const specs: FieldSpec[] = []
  let code = input
  const hubspot = /\bmodule\.[A-Za-z_]|\bwidget(?:_data)?\.|\{%-?\s*(?:module|dnd_module|inline_text|inline_rich_text|widget_block)\b/.test(code)

  const mj = mjmlToHtml(code)
  if (mj !== null) {
    code = mj
    platforms.push('MJML')
    repairs.push('MJML converti en HTML d’e-mail (sections, colonnes, textes, images, boutons)')
  }

  const mk = convertMarketo(code, specs)
  if (mk.n) {
    code = mk.code
    platforms.push('Marketo')
    repairs.push(`Marketo : ${plural(mk.n, 'variable ou jeton converti', 'variables et jetons convertis')}${specs.length ? ` (${plural(specs.length, 'champ repris', 'champs repris')} de ses balises meta)` : ''}`)
  }

  const amp = convertAmpscript(code)
  if (amp.n) {
    code = amp.code
    platforms.push('AMPscript')
    repairs.push(`AMPscript (Salesforce) : ${plural(amp.n, 'élément converti', 'éléments convertis')} en variables${amp.dropped ? ` ; ${plural(amp.dropped, 'traitement retiré', 'traitements retirés')} (recherches, conditions de script : à recréer avec les champs du module)` : ''}`)
  }

  const mc = convertMailchimp(code)
  if (mc.n) {
    code = mc.code
    platforms.push('Mailchimp')
    repairs.push(`Mailchimp : ${plural(mc.n, 'balise de fusion convertie', 'balises de fusion converties')} (*|PRÉNOM|*, *|IF:|*, liens de désinscription…)`)
  }

  const mj2 = convertMailjet(code)
  if (mj2.n) {
    code = mj2.code
    platforms.push('Mailjet')
    repairs.push(`Mailjet : ${plural(mj2.n, 'variable convertie', 'variables converties')}`)
  }

  const hb = convertHandlebars(code)
  if (hb.n) {
    code = hb.code
    platforms.push('Handlebars')
    repairs.push(`Handlebars / Mustache : ${plural(hb.n, 'balise convertie', 'balises converties')} ({{#if}}, {{#each}}, commentaires…)`)
  }

  const liq = convertLiquid(code, platforms.length > 0 && !hubspot)
  if (liq.n || liq.removed || liq.dropped) {
    code = liq.code
    if (!platforms.includes('Handlebars')) platforms.push('Liquid')
    const extra = [liq.removed ? `${plural(liq.removed, 'balise sans équivalent retirée', 'balises sans équivalent retirées')} (inclusions, appels externes…)` : '', liq.dropped ? `${plural(liq.dropped, 'filtre inconnu retiré', 'filtres inconnus retirés')}` : '']
      .filter(Boolean)
      .join(', ')
    if (liq.n || extra) repairs.push(`Liquid / Django : ${liq.n ? plural(liq.n, 'balise convertie', 'balises converties') : 'syntaxe reprise'} (assign, capture, case, filtres…)${extra ? ` ; ${extra}` : ''}`)
  }

  // Brevo writes contact attributes in capitals.
  const brevo = /\{\{\s*contact\.[A-Z][A-Z0-9_]+|\{\{\s*params\.\w|\{\{\s*(?:mirror|unsubscribe|update_profile)\s*\}\}/.test(code)
  if (brevo && !hubspot) platforms.push('Brevo')

  // Free variables of another tool: the module's fields, the contact, its links.
  if (platforms.length && !hubspot) {
    const vars = mapVariables(code)
    if (vars.n) {
      code = vars.code
      repairs.push('variables de personnalisation reliées au contact (prénom, e-mail…), aux liens de désinscription et de version en ligne ; les autres données deviennent des champs du module')
    }
  }
  // Variables another tool set but the module never uses ({% assign accent = … %}): dropped.
  if (platforms.length && !hubspot) {
    let unused = 0
    code = code.replace(/\{%-?\s*set\s+(\w+)\s*=[^%]*?-?%\}\n?/g, (m, name: string) => {
      const uses = code.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0
      if (uses > 1) return m
      unused++
      return ''
    })
    if (unused) repairs.push(`${plural(unused, 'variable inutilisée retirée', 'variables inutilisées retirées')}`)
  }
  return { code, repairs, specs, platforms }
}
