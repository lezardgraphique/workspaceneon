// Maily's replies, rendered from Markdown with a few lines instead of a full
// Markdown library (which weighed ~600 KB and re-parsed the whole reply on
// every streamed word). Covers what Maily writes: paragraphs, titles, lists,
// bold / italic / code, code blocks, links and simple tables. Builds React
// elements only (no HTML string): nothing in a reply can inject markup.

import { Fragment, memo } from 'react'
import type { ReactNode } from 'react'

const SAFE_LINK = /^(https?:\/\/|mailto:|\/(?!\/))/i

// Bold, italic, inline code, links and bare addresses inside one line.
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = []
  // No lookbehind (Safari 15): the character before * or _ is captured in m[9] and kept.
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\[([^\]]+)\]\(([^)\s]+)\)|(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)|(^|[^\w_])_(?!\s)([^_]+?)_(?!\w)|(https?:\/\/[^\s)<>]+[^\s)<>.,;:!?'"])/g
  let last = 0
  let n = key
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const k = `i${n++}`
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>)
    else if (m[2] !== undefined || m[3] !== undefined) out.push(<strong key={k}>{inline(m[2] ?? m[3], n * 100)}</strong>)
    else if (m[4] !== undefined)
      out.push(
        SAFE_LINK.test(m[5]) ? (
          <a key={k} href={m[5]} target={m[5].startsWith('/') ? undefined : '_blank'} rel="noreferrer" className="text-cyan underline-offset-2 hover:underline">
            {inline(m[4], n * 100)}
          </a>
        ) : (
          m[4]
        ),
      )
    else if (m[7] !== undefined || m[9] !== undefined) {
      const before = m[6] ?? m[8] ?? ''
      if (before) out.push(before)
      out.push(<em key={k}>{inline(m[7] ?? m[9], n * 100)}</em>)
    } else if (m[10] !== undefined)
      out.push(
        <a key={k} href={m[10]} target="_blank" rel="noreferrer" className="text-cyan underline-offset-2 hover:underline">
          {m[10]}
        </a>,
      )
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

function blocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: ReactNode[] = []
  let para: string[] = []
  let k = 0
  const flush = () => {
    if (!para.length) return
    out.push(
      <p key={`p${k++}`}>
        {para.map((l, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {inline(l)}
          </Fragment>
        ))}
      </p>,
    )
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*```/.exec(line)
    if (fence) {
      flush()
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      out.push(
        <pre key={`c${k++}`}>
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      out.push(
        <p key={`h${k++}`} className="font-display font-semibold text-white">
          {inline(h[2])}
        </p>,
      )
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush()
      const ordered = /^\s*\d+[.)]/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
        i++
      }
      i--
      const Tag = ordered ? 'ol' : 'ul'
      out.push(
        <Tag key={`l${k++}`}>
          {items.map((t, j) => (
            <li key={j}>{inline(t)}</li>
          ))}
        </Tag>,
      )
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      flush()
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]))
      i--
      out.push(
        <table key={`t${k++}`}>
          <thead>
            <tr>
              {head.map((c, j) => (
                <th key={j}>{inline(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, j) => (
                  <td key={j}>{inline(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      )
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      para.push(line.replace(/^\s*>\s?/, ''))
      continue
    }
    if (!line.trim()) flush()
    else para.push(line)
  }
  flush()
  return out
}

/** A finished reply never re-renders; only the reply being written does. */
export const MiniMarkdown = memo(function MiniMarkdown({ children }: { children: string }) {
  return <>{blocks(children)}</>
})
