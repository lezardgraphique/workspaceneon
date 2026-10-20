import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, FileCode2, Lightbulb, Loader2, MessageCircle, Paperclip, Send, Square, Wand2, X } from 'lucide-react'
import { Streamdown } from 'streamdown'

import { Maily } from '@/components/Maily'
import type { MailyMood } from '@/components/Maily'
import { treeToCode } from '@/lib/hubl'
import { extractCode, looksLikeCode, recognizeCode, wantsConversion } from '@/lib/recognize'
import type { ModuleTree } from '@/lib/types'

// A screenshot/mockup or an HTML file sent to Maily, usually to recreate it.
interface Attachment {
  name: string
  kind: 'image' | 'code'
  url?: string
  mimeType?: string
  data?: string
  text?: string
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
  files?: Attachment[]
  building?: boolean
  applied?: boolean
  // Set when the attached code was already converted locally: the model gets
  // this summary instead of the code, which is now the editor's module.
  imported?: string
}

type Mode = 'chat' | 'build'

const CODE_EXT = /\.(html?|hubl|txt|json)$/i
// Images sent to Gemini are downscaled: enough to read a mockup, light to upload.
const MAX_SIDE = 1400
// Only the most recent images are resent with the history.
const IMAGE_HISTORY = 2

async function toAttachment(file: File): Promise<Attachment | null> {
  if (CODE_EXT.test(file.name) || file.type === 'text/html' || file.type === 'application/json') {
    return { name: file.name, kind: 'code', text: (await file.text()).slice(0, 140_000) }
  }
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return null
  const img = new Image()
  const src = URL.createObjectURL(file)
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('Image illisible'))
    img.src = src
  })
  URL.revokeObjectURL(src)
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight / 3))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const url = canvas.toDataURL('image/jpeg', 0.85)
  return { name: file.name, kind: 'image', url, mimeType: 'image/jpeg', data: url.split(',')[1] }
}

// Splits Maily's streamed answer into the visible text and the ```neon module.
function splitReply(acc: string): { text: string; code?: string; building: boolean } {
  const start = acc.search(/```neon[^\n]*\n?/)
  if (start < 0) return { text: acc, building: false }
  const open = acc.slice(start).match(/```neon[^\n]*\n?/)![0]
  const rest = acc.slice(start + open.length)
  const end = rest.search(/\n```/)
  if (end < 0) return { text: acc.slice(0, start).trim(), building: true }
  return { text: `${acc.slice(0, start)}${rest.slice(end + 4)}`.trim(), code: rest.slice(0, end), building: false }
}

// What the model sees for a past message: attached code inline, applied
// modules summarised (the current code is sent separately).
function toPayload(m: Msg, withImages: boolean) {
  const code = (m.files ?? []).filter((f) => f.kind === 'code')
  const content =
    m.role === 'assistant'
      ? `${m.content}${m.applied ? '\n\n[Module appliqué dans l\'éditeur]' : ''}`
      : m.imported
        ? `${m.content}\n\n[Code joint déjà converti et appliqué dans l'éditeur. ${m.imported.replace(/\*\*/g, '')}]`
        : [m.content, ...code.map((f) => `Fichier joint « ${f.name} » :\n\`\`\`html\n${f.text}\n\`\`\``)].filter(Boolean).join('\n\n')
  const images = withImages
    ? (m.files ?? []).filter((f) => f.kind === 'image').map((f) => ({ mimeType: f.mimeType!, data: f.data! }))
    : []
  return { role: m.role, content, ...(images.length ? { images } : {}) }
}

const TIPS = [
  'Un objet de moins de 45 caractères s\'affiche en entier sur la plupart des mobiles.',
  'Un seul appel à l\'action principal par email : il est cliqué jusqu\'à 2× plus.',
  'Ajoute toujours un texte alternatif à tes images : beaucoup de clients mail les bloquent par défaut.',
  'Personnalise l\'accroche avec {{ contact.firstname }} et prévois un {% else %} pour les contacts sans prénom.',
  'Garde ton email sous 600 px de large pour un rendu fiable dans Outlook.',
  'Sur mobile, empile les colonnes : la lecture se fait au pouce, de haut en bas.',
]

const SUGGESTIONS: Record<Mode, string[]> = {
  chat: [
    'Propose 5 objets d\'email pour ce module',
    'Vérifie l\'accessibilité de ce module',
    'Comment tester le rendu dans Outlook ?',
    'Quelles sont les tendances design email du moment ?',
    'Comment récupérer mon module pour l\'utiliser ailleurs ?',
  ],
  build: [
    'Crée une newsletter de rentrée avec 3 actus en cards',
    'Passe le module en thème sombre néon',
    'Ajoute une section témoignage client en 2 colonnes',
  ],
}

export function MailyPanel({
  tree,
  code,
  moduleName,
  applyCode,
}: {
  tree: ModuleTree
  code: string
  moduleName: string
  applyCode: (code: string) => string | null
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [mode, setMode] = useState<Mode>('chat')
  const [loading, setLoading] = useState(false)
  const [mood, setMood] = useState<MailyMood>('happy')
  const [tip, setTip] = useState(0)
  const [dragging, setDragging] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  useEffect(() => {
    if (mood !== 'success') return
    const t = setTimeout(() => setMood('happy'), 2500)
    return () => clearTimeout(t)
  }, [mood])

  const push = (m: Msg) => setMessages((prev) => [...prev, m])
  const setLast = (m: Msg) => setMessages((prev) => [...prev.slice(0, -1), m])

  const attach = async (list: FileList | File[] | null | undefined) => {
    const picked = Array.from(list ?? []).slice(0, 4)
    if (!picked.length) return
    try {
      const added = (await Promise.all(picked.map(toAttachment))).filter((f): f is Attachment => !!f)
      if (added.length < picked.length) push({ role: 'assistant', content: '⚠️ Je lis les images (PNG, JPG, WebP, GIF) et les fichiers HTML, HuBL ou JSON.' })
      setFiles((prev) => [...prev, ...added].slice(0, 4))
    } catch (e) {
      push({ role: 'assistant', content: `⚠️ ${(e as Error).message}` })
    }
  }

  const send = async (text: string) => {
    const content = text.trim()
    if ((!content && !files.length) || loading) return
    setInput('')
    setFiles([])

    // Code typed in the message becomes an attachment, like pasted code.
    const typed = extractCode(content)
    const sent = typed ? [...files.slice(0, 3), { name: 'code-colle.html', kind: 'code' as const, text: typed.code }] : files
    const instruction = typed ? typed.instruction : content
    const source = sent
      .filter((f) => f.kind === 'code' && !/\.json$/i.test(f.name))
      .map((f) => f.text)
      .join('\n')

    // Recognised code is rendered right away; Maily then reviews it (or
    // recreates it herself when the direct conversion is too lossy).
    let requestCode = code
    let imported: string | undefined
    let issue: string | undefined
    if (source && wantsConversion(instruction, mode)) {
      const rec = recognizeCode(source, tree)
      if (rec.ok && rec.complete && !applyCode(source)) {
        imported = rec.summary
        requestCode = treeToCode(rec.tree, moduleName)
      } else {
        issue = rec.ok ? `${rec.kind} reconnu, conversion directe incomplète : ${rec.issue ?? 'application impossible'}` : `${rec.kind} : ${rec.error}`
      }
    }

    const userMsg: Msg = {
      role: 'user',
      content: instruction || (source ? 'Transforme ce code en rendu.' : 'Recrée ce module.'),
      files: sent.length ? sent : undefined,
      imported,
    }
    const history: Msg[] = [...messages, userMsg]
    setMessages(imported ? [...history, { role: 'assistant', content: imported, applied: true }] : history)
    setLoading(true)
    setMood('thinking')
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // Resend only the latest images to keep the request light.
    const withImages = new Set(
      history
        .map((m, i) => (m.files?.some((f) => f.kind === 'image') ? i : -1))
        .filter((i) => i >= 0)
        .slice(-IMAGE_HISTORY),
    )

    try {
      const res = await fetch('/api/maily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.slice(-40).map((m, i, arr) => toPayload(m, withImages.has(i + history.length - arr.length))),
          mode,
          code: requestCode,
          moduleName,
          imported: !!imported,
          issue,
        }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Maily est indisponible.')
      }
      push({ role: 'assistant', content: '' })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        const part = splitReply(acc)
        // Hide a ```neon fence that is still arriving.
        const visible = part.building || part.code ? part.text : part.text.replace(/`{1,3}(n(e(on?)?)?)?$/, '')
        setLast({ role: 'assistant', content: visible, building: part.building || !!part.code })
      }

      const reply = splitReply(acc)
      if (reply.code) {
        const error = applyCode(reply.code)
        setLast(
          error
            ? { role: 'assistant', content: `${reply.text}\n\n⚠️ Le module généré n'a pas pu être appliqué : ${error}` }
            : { role: 'assistant', content: reply.text || 'C\'est fait ! J\'ai mis à jour ton module ✨', applied: true },
        )
        setMood(error ? 'happy' : 'success')
      } else {
        setLast({
          role: 'assistant',
          content: reply.text || (reply.building ? '⚠️ La génération du module a été coupée avant la fin. Réessaie.' : ''),
        })
        setMood('happy')
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setMessages((prev) => prev.map((m) => (m.building ? { ...m, building: false, content: m.content || 'Génération arrêtée.' } : m)))
      } else {
        push({ role: 'assistant', content: `⚠️ ${(e as Error).message}` })
      }
      setMood('happy')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  return (
    <div
      className={`relative flex min-h-0 flex-1 flex-col ${dragging ? 'ring-2 ring-inset ring-cyan' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDragging(false)
        attach(e.dataTransfer.files)
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-void/80 p-6 text-center text-sm text-cyan">
          Dépose une capture, une maquette ou un fichier HTML/HuBL : Maily le transforme en rendu.
        </div>
      )}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Maily size={48} mood={mood} />
        <div className="min-w-0">
          <p className="font-display font-semibold tracking-wide">NEON AI CHAT</p>
          <p className="text-xs text-mute">{loading ? 'Maily réfléchit…' : 'Maily · Gemini Flash · recherche web'}</p>
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <button
          onClick={() => setTip((t) => (t + 1) % TIPS.length)}
          className="w-full rounded-lg border border-cyan/30 bg-cyan/5 p-3 text-left"
          title="Astuce suivante"
        >
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan">
            <Lightbulb className="size-3.5" /> L'astuce de Maily
          </p>
          <p className="text-sm text-[#d9d9ec]">{TIPS[tip]}</p>
        </button>

        {messages.length === 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs text-mute">
              Pose-moi n'importe quelle question (je cherche sur le web les infos récentes), colle du code HTML ou HuBL : je le transforme
              en rendu, ou joins une capture avec le trombone : je la recrée en blocs éditables.
            </p>
            <p className="pt-1 text-xs text-mute">Essaie :</p>
            {SUGGESTIONS[mode].map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full rounded-lg border border-line px-3 py-2 text-left text-sm text-[#c9c9de] hover:border-pink hover:text-white"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex gap-2'}>
            {m.role === 'assistant' && <Maily size={26} bob={false} mood={m.applied ? 'success' : 'happy'} className="mt-1 shrink-0" />}
            <div
              className={`max-w-[88%] rounded-xl px-3 py-2 text-sm ${
                m.role === 'user' ? 'bg-pink/90 text-white' : 'maily-md border border-line bg-panel text-[#e3e3f0]'
              }`}
            >
              {m.role === 'assistant' ? (
                <>
                  {m.content ? <Streamdown>{m.content}</Streamdown> : !m.building && <Loader2 className="size-4 animate-spin text-cyan" />}
                  {m.building && (
                    <p className={`flex items-center gap-2 text-mute ${m.content ? 'mt-2' : ''}`}>
                      <Loader2 className="size-4 animate-spin text-pink" /> Maily construit ton module…
                    </p>
                  )}
                  {m.applied && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-cyan">
                      <CheckCircle2 className="size-3.5" /> Module appliqué · ↶ pour annuler
                    </p>
                  )}
                </>
              ) : (
                <>
                  {m.files && <Attachments files={m.files} />}
                  {m.content}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-3">
        <div className="mb-2 flex rounded-md border border-line bg-void p-0.5 text-xs">
          {(
            [
              { k: 'chat', label: 'Conseil', icon: MessageCircle },
              { k: 'build', label: 'Modifier le module', icon: Wand2 },
            ] as const
          ).map((o) => (
            <button
              key={o.k}
              onClick={() => setMode(o.k)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 ${
                mode === o.k ? 'bg-violet text-white' : 'text-mute hover:text-white'
              }`}
            >
              <o.icon className="size-3.5" /> {o.label}
            </button>
          ))}
        </div>
        {files.length > 0 && (
          <div className="mb-2">
            <Attachments files={files} onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))} />
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
          className="flex items-end gap-2"
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.html,.htm,.hubl,.txt,.json"
            className="hidden"
            onChange={(e) => {
              attach(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Joindre une capture, une maquette ou un fichier HTML"
            aria-label="Joindre un fichier"
            className="rounded-lg border border-line p-2.5 text-mute hover:border-cyan hover:text-white"
          >
            <Paperclip className="size-4" />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files)
              if (pasted.length) {
                e.preventDefault()
                attach(pasted)
                return
              }
              // Long HTML is kept as an attachment so the textarea stays usable.
              const html = e.clipboardData.getData('text/plain')
              if (html.length > 300 && looksLikeCode(html)) {
                e.preventDefault()
                setFiles((prev) => [...prev, { name: 'code-colle.html', kind: 'code' as const, text: html.slice(0, 140_000) }].slice(0, 4))
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            rows={2}
            placeholder={
              files.length
                ? 'Précise ce que tu veux (facultatif)…'
                : mode === 'build'
                  ? 'Décris le module ou la modification…'
                  : 'Pose ta question, colle du code ou demande-moi un module…'
            }
            className="min-h-10 flex-1 resize-none rounded-lg border border-line bg-void px-3 py-2 text-base outline-none focus:border-violet lg:text-sm"
          />
          {loading ? (
            <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Arrêter" className="rounded-lg bg-line p-2.5 hover:bg-pink">
              <Square className="size-4" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() && !files.length} aria-label="Envoyer" className="rounded-lg bg-pink p-2.5 text-white disabled:opacity-40">
              <Send className="size-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  )
}

function Attachments({ files, onRemove }: { files: Attachment[]; onRemove?: (i: number) => void }) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <span key={i} className="relative inline-flex items-center gap-1.5 rounded-md border border-line bg-void/60 p-1 pr-2 text-xs text-[#d9d9ec]">
          {f.kind === 'image' ? (
            <img src={f.url} alt="" className="size-8 rounded object-cover object-top" />
          ) : (
            <FileCode2 className="size-4 text-cyan" />
          )}
          <span className="max-w-32 truncate">{f.name}</span>
          {onRemove && (
            <button type="button" onClick={() => onRemove(i)} aria-label={`Retirer ${f.name}`} className="text-mute hover:text-white">
              <X className="size-3.5" />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
