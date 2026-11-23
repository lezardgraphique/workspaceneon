// Doctor for a module's own code (module.html + module.css + module.js), run
// when a module is imported and by « Contrôler mes imports »:
// - a module exported by an older version of this tool and imported again
//   (its layout tables, its text boxes around the code, tags cut into text)
//   is put back to the module's own markup;
// - CSS variables used but defined nowhere get a value (adjustable in
//   « Réglages du modèle »);
// - animations without their @keyframes get them when the name says what they do;
// - elements the script looks for (querySelector('.x')) and that are missing
//   are put back when the script shows where they go.
// Every change is listed in French; what can't be repaired is listed apart.

export interface DoctorResult {
  source: string
  css: string
  fixes: string[]
  warnings: string[]
}

const NEON_TEXT = '<div style="margin:0 0 12px;font-family:'
const NEON_STACK_CSS = /@media only screen and \(max-width: 480px\) \{\s*\.neon-stack > tbody > tr > \.neon-col, \.neon-stack > tr > \.neon-col \{[^}]*\}\s*\}\s*/g

// Index just after the element opened at `start` (same tag name, nesting counted), or -1.
function closeOf(text: string, start: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
  re.lastIndex = start
  let depth = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1]) depth--
    else if (!m[0].endsWith('/>')) depth++
    if (depth === 0) return m.index + m[0].length
  }
  return -1
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/** Exported by this tool (wrapper tables, column cells), not the module's own markup. */
export const isNeonExport = (html: string) => /généré par Neon Sandbox Pro\s*#\}/.test(html) || (/class="neon-section/.test(html) && /class="neon-col"/.test(html))

// The module's own code out of an export of this tool: the content of each
// column cell, without the text boxes the tool had put around it, and tags
// that had been cut into text put back together.
function unwrapNeon(html: string): string | null {
  const cells: string[] = []
  const re = /<td\b[^>]*class="neon-col"[^>]*>/g
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const end = closeOf(html, m.index, 'td')
    if (end < 0) return null
    cells.push(html.slice(m.index + m[0].length, end - '</td>'.length))
    re.lastIndex = end
  }
  if (!cells.length) return null
  let body = cells.join('\n')
  // Text boxes of the tool: their content comes back as it was.
  for (let at = body.indexOf(NEON_TEXT); at >= 0; at = body.indexOf(NEON_TEXT, at)) {
    const open = body.indexOf('>', at) + 1
    const end = closeOf(body, at, 'div')
    if (end < 0 || open <= 0) break
    const inner = body.slice(open, end - '</div>'.length)
    // Text that was a piece of a tag (&lt;h2 class="…, "&gt; …): markup again.
    const piece = /^\s*(&lt;(\{\{|\/?[a-z])|"?\s*&gt;)/i.test(inner) || /&lt;\/?(\{\{|[a-z][\w-]*)[^&]*&gt;/i.test(inner)
    const back = piece ? unescape(inner) : inner
    body = body.slice(0, at) + back + body.slice(end)
    at += back.length
  }
  // A tag named by HuBL left open (<{{ heading }} …> text): closed at the end of its line.
  body = body.replace(/<\{\{\s*([\w.]+)\s*\}\}[^<>]*?>[^\n<]*/g, (m, name: string, offset: number, all: string) =>
    all.slice(offset + m.length).match(new RegExp(`^[\\s\\S]{0,400}?</\\{\\{\\s*${name.replace(/\./g, '\\.')}\\s*\\}\\}>`)) ? m : `${m.replace(/\s+$/, '')}</{{ ${name} }}>`,
  )
  // Indentation of the cell removed.
  const lines = body.split('\n')
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length))
  return lines
    .map((l) => l.slice(Number.isFinite(pad) ? pad : 0))
    .join('\n')
    .trim()
}

// style="…" written by the old import = the class's CSS (then the element's own
// declarations, often repeating a property). For each first class: the class
// part goes back to a .class rule, the element keeps only its own part.
function classCssBack(source: string): { source: string; rules: string[] } {
  const mask = source.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, (m) => 'x'.repeat(m.length))
  const rules = new Map<string, string>()
  const edits: { from: number; to: number; text: string }[] = []
  for (const m of mask.matchAll(/<([a-z][a-z0-9]*)\b[^<>]*>/gi)) {
    const tag = m[0]
    const cls = /\sclass\s*=\s*"([A-Za-z_][\w-]*)/.exec(tag)
    const st = /\sstyle\s*=\s*"([^"]*)"/.exec(tag)
    if (!cls || !st || rules.has(cls[1])) continue
    const start = (m.index ?? 0) + st.index + st[0].indexOf('"') + 1
    const style = source.slice(start, start + st[1].length)
    const decls = style.split(';')
    const keep: string[] = []
    const seen = new Set<string>()
    let i = 0
    for (; i < decls.length; i++) {
      const d = decls[i].trim()
      if (!d) continue
      if (/\{[{%]/.test(d)) break
      const prop = d.split(':')[0].trim().toLowerCase()
      if (!/^[a-z-]+$/.test(prop) || seen.has(prop)) break
      seen.add(prop)
      keep.push(d)
    }
    if (keep.length < 2) continue
    const rest = decls.slice(i).join(';').replace(/^;+/, '').trim()
    rules.set(cls[1], `.${cls[1]} { ${keep.join('; ')}; }`)
    // The attribute keeps only the element's own part (or goes when empty).
    const attrStart = (m.index ?? 0) + st.index
    edits.push(rest ? { from: start, to: start + st[1].length, text: rest } : { from: attrStart, to: attrStart + st[0].length, text: '' })
  }
  let out = source
  for (const e of edits.sort((x, y) => y.from - x.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to)
  return { source: out, rules: [...rules.values()] }
}

// A believable value for a CSS variable the module never defines.
function defaultFor(name: string): string | null {
  if (/color|couleur|bg|background/i.test(name)) return null
  if (/duration|duree|time|delay/i.test(name)) return '30s'
  if (/gap|space|espace|gutter|padding|margin/i.test(name)) return '32px'
  if (/height|hauteur|size|taille/i.test(name)) return '48px'
  if (/width|largeur/i.test(name)) return 'auto'
  if (/radius|arrondi/i.test(name)) return '8px'
  return null
}

const plain = (t: string) => t.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g, ' ')

export function doctorTemplate(input: { source: string; css?: string; js?: string }): DoctorResult {
  const fixes: string[] = []
  const warnings: string[] = []
  let source = input.source
  let css = input.css ?? ''

  if (isNeonExport(source)) {
    const own = unwrapNeon(source.replace(/^\s*\{#[^#]*généré par Neon Sandbox Pro\s*#\}\s*/, ''))
    if (own) {
      source = own
      fixes.push('fichiers exportés par une ancienne version de l’outil : mise en page ajoutée retirée et balises coupées recollées')
      warnings.push('ces fichiers ne sont pas ceux d’origine : les classes et la CSS que l’ancien import avait perdues ne peuvent pas toutes revenir ; les fichiers téléchargés depuis la plateforme d’origine restent la meilleure source')
    }
    const before = css
    css = css.replace(NEON_STACK_CSS, '').trim()
    if (css !== before.trim()) fixes.push('CSS de mise en page de l’outil retirée du module.css')
    // The old import had copied the class CSS into style="…": back into module.css.
    const back = classCssBack(source)
    if (back.rules.length) {
      source = back.source
      css = `${back.rules.join('\n')}${css ? `\n${css}` : ''}`
      fixes.push(`styles des classes remis dans module.css (${back.rules.length} règle${back.rules.length > 1 ? 's' : ''})`)
    }
  }

  const all = `${css}\n${plain(source)}`
  // CSS variables used without a definition nor a fallback.
  const defs: string[] = []
  const seen = new Set<string>()
  for (const m of all.matchAll(/var\(\s*(--[\w-]+)\s*(,[^()]*(\([^()]*\))?[^()]*)?\)/g)) {
    if (seen.has(m[1]) || m[2] || new RegExp(`${m[1].replace(/[-]/g, '\\-')}\\s*:`).test(all)) continue
    seen.add(m[1])
    const v = defaultFor(m[1])
    if (v) defs.push(`${m[1]}: ${v};`)
    else warnings.push(`variable ${m[1]} utilisée mais jamais définie (à régler dans « Réglages du modèle »)`)
  }
  if (defs.length) {
    css = `:root { ${defs.join(' ')} }${css ? `\n${css}` : ''}`
    fixes.push(`variables CSS définies (${defs.map((d) => d.split(':')[0]).join(', ')}), réglables dans « Réglages du modèle »`)
  }

  // Animations whose @keyframes are missing.
  const names = new Set<string>()
  for (const m of all.matchAll(/animation(?:-name)?\s*:\s*([^;"}]+)/gi)) {
    const n = m[1].split(/[\s,]+/).find((w) => /^[a-z_][\w-]*$/i.test(w) && !/^(none|infinite|linear|ease|ease-in|ease-out|ease-in-out|alternate|reverse|forwards|backwards|both|normal|running|paused|step-start|step-end|var|initial|inherit)$/i.test(w))
    if (n) names.add(n)
  }
  for (const n of names) {
    if (new RegExp(`@keyframes\\s+${n}\\b`).test(css)) continue
    if (/scroll|marquee|defil|ticker|slide|carousel|loop/i.test(n)) {
      css = `${css}\n@keyframes ${n} { from { transform: translateX(0); } to { transform: translateX(-50%); } }`.trim()
      fixes.push(`animation « ${n} » sans ses @keyframes : défilement ajouté`)
    } else warnings.push(`animation « ${n} » sans ses @keyframes : elle ne fera rien`)
  }

  // Elements the script looks for.
  if (input.js?.trim()) {
    const classesIn = (t: string) => new Set([...plain(t).matchAll(/\sclass\s*=\s*["']([^"']*)["']/gi)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))
    const have = classesIn(source)
    const wanted = [...new Set([...input.js.matchAll(/querySelector(?:All)?\(\s*['"]\.([\w-]+)/g)].map((m) => m[1]))]
    for (const a of wanted.filter((c) => !have.has(c))) {
      // .ls__marquee missing, .ls__track there (same block): wrapped around it.
      const block = a.split('__')[0]
      const inner = wanted.find((b) => b !== a && have.has(b) && b.split('__')[0] === block && new RegExp(`\\.querySelector(?:All)?\\(\\s*['"]\\.${b}`).test(input.js!))
      const at = inner ? source.search(new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*class\\s*=\\s*["'][^"']*\\b${inner}\\b`, 'i')) : -1
      if (inner && at >= 0) {
        const tag = /^<([a-z][a-z0-9]*)/i.exec(source.slice(at))![1]
        const end = closeOf(source, at, tag)
        if (end > at) {
          const indent = /[ \t]*$/.exec(source.slice(0, at))![0]
          // Settings the script reads on it with a default (dataset.speed || 40): written out, so they can be adjusted.
          const data = [...input.js.matchAll(/\.dataset\.([a-z][\w]*)\s*\)?\s*\|\|\s*(-?\d+(?:\.\d+)?|'[^']*'|"[^"]*")/g)]
            .map((m) => ` data-${m[1].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${m[2].replace(/^['"]|['"]$/g, '')}"`)
            .filter((x, i, l) => l.indexOf(x) === i && !source.includes(x.trim().split('=')[0] + '='))
            .join('')
          source = `${source.slice(0, at)}<div class="${a}"${data}>\n${indent}${source.slice(at, end)}\n${indent}</div>${source.slice(end)}`
          have.add(a)
          // Around a track wider than its box (max-content, animation): it clips it.
          if (new RegExp(`\\.${inner}\\s*\\{[^}]*(max-content|animation)`).test(css) && !new RegExp(`\\.${a}\\s*\\{`).test(css)) css = `${css}\n.${a} { overflow: hidden; }`.trim()
          fixes.push(`le script cherche .${a} : élément remis autour de .${inner}`)
          continue
        }
      }
      warnings.push(`le script cherche .${a}, absent du module : il ne s’exécutera pas sur cet élément`)
    }
  }

  return { source, css, fixes, warnings }
}
