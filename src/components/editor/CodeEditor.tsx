import { useMemo, useRef } from 'react'

import { esc } from '@/lib/hubl'

const TOKEN = /(\{#[\s\S]*?#\}|<!--[\s\S]*?-->)|(\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\})|(<\/?[a-zA-Z][^>]*>?)/g

function highlightTag(tag: string) {
  const m = /^(<\/?)([a-zA-Z][\w-]*)([\s\S]*?)(\/?>)?$/.exec(tag)
  if (!m) return esc(tag)
  const [, open, name, rest, close = ''] = m
  const attrs = esc(rest).replace(/([\w:-]+)(\s*=\s*)(&quot;[\s\S]*?&quot;|'[^']*')?/g, (_a, n, eq, v = '') => {
    const cls = n === 'data-neon' ? 'hl-neon' : 'hl-attr'
    const val = v ? `<span class="${n === 'data-neon' ? 'hl-neon' : 'hl-val'}">${v}</span>` : ''
    return `<span class="${cls}">${n}</span>${eq}${val}`
  })
  return `<span class="hl-tag">${esc(open)}${name}</span>${attrs}<span class="hl-tag">${esc(close)}</span>`
}

export function highlight(code: string) {
  let out = ''
  let last = 0
  for (const m of code.matchAll(TOKEN)) {
    out += esc(code.slice(last, m.index))
    if (m[1]) out += `<span class="hl-comment">${esc(m[1])}</span>`
    else if (m[2]) out += `<span class="hl-hubl">${esc(m[2])}</span>`
    else out += highlightTag(m[3])
    last = m.index + m[0].length
  }
  return out + esc(code.slice(last))
}

export function CodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const preRef = useRef<HTMLPreElement>(null)
  const html = useMemo(() => highlight(value) + '\n ', [value])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const ta = e.currentTarget
    const { selectionStart: s, selectionEnd: end } = ta
    const next = value.slice(0, s) + '  ' + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2))
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-void">
      <pre
        ref={preRef}
        aria-hidden="true"
        className="code-layer pointer-events-none absolute inset-0 overflow-hidden text-[#d9d9ec]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (!preRef.current) return
          preRef.current.scrollTop = e.currentTarget.scrollTop
          preRef.current.scrollLeft = e.currentTarget.scrollLeft
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        aria-label="Code du module"
        className="code-layer absolute inset-0 h-full w-full resize-none overflow-auto overscroll-contain bg-transparent text-transparent caret-pink outline-none selection:bg-pink/30"
      />
    </div>
  )
}
