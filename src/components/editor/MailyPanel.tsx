import { bringImages, imagesNote, swapUrls, textsOf } from '@/lib/import-images'
import { useEffect, useRef, useState } from 'react'
import { guardedFetch } from '@/lib/session-guard'
import { CheckCircle2, ChevronDown, ExternalLink, FileCode2, Heart, Lightbulb, Loader2, MessageCircle, Paperclip, Plus, RotateCcw, Send, Square, Wand2, X } from 'lucide-react'
import { Streamdown } from 'streamdown'

import { Maily } from '@/components/Maily'
import type { MailyMood } from '@/components/Maily'
import { collectFields } from '@/lib/fields'
import { treeToCode } from '@/lib/hubl'
import { KOFI_URL } from '@/lib/links'
import { parseFieldsJson } from '@/lib/module-fields'
import { importSpecs, parseForeignJson } from '@/lib/json-import'
import type { FieldSpec } from '@/lib/module-fields'
import { validateModuleCode } from '@/lib/module-agent'
import { fixCode, validateSyntax } from '@/lib/validator'
import { codeFileName, extractCode, recognizeCode, wantsConversion } from '@/lib/recognize'
import type { ModuleTree, Section } from '@/lib/types'
import { slugify } from '@/lib/custom-blocks'
import type { CustomBlock } from '@/lib/custom-blocks'
import { createLocalFirst, isNetworkError, isOffline, loadBlocks, loadModules, saveBlock, useDataStatus } from '@/lib/data'
import { guideAnswer, libraryNote, localSystemPrompt } from '@/lib/maily-prompts'
import { formatReport, runSelfTests } from '@/lib/self-test'
import { codeFromFields } from '@/lib/import-repair'
import { CONTINUE_MARK, stripMark, wantsContinue } from '@/lib/continuation'
import { localAiEnabled, localContextTokens, streamOfflineMaily } from '@/lib/offline-ai'
import type { LocalMessage } from '@/lib/offline-ai'
import { refreshCustomBlocks } from './useCustomBlocks'
import { MailyOffline, useOfflineAi } from './MailyOffline'

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
  // Sent to the model but not shown (automatic checks)
  /** Holds an internal test report. */
  tests?: boolean
  hidden?: boolean
  // Modules Maily created in the library from this answer
  created?: { id: string; name: string; existing?: boolean }[]
  // Custom blocks (library) Maily saved or reused from this answer
  blocks?: CustomBlock[]
  /** Placeholder while Maily is reached (may show a waiting note). */
  waiting?: boolean
  /** The request failed: « Réessayer » sends the user's last message again. */
  retry?: boolean
}

type Mode = 'chat' | 'build'

// Code files Maily reads (HTML, HuBL, other platforms' templates, CSS, fields.json…).
const CODE_EXT = /\.(html?|hubl|txt|json|css|mjml|liquid|hbs|handlebars|mustache|twig|njk|jinja2?|j2|tpl|xml|amp|ampscript|md)$/i
// Images sent to Gemini are downscaled: enough to read a mockup, light to upload.
const MAX_SIDE = 1400
// Only the most recent images are resent with the history.
const IMAGE_HISTORY = 2

async function toAttachment(file: File): Promise<Attachment | null> {
  if (CODE_EXT.test(file.name) || file.type === 'text/html' || file.type === 'application/json' || file.type === 'text/css' || file.type === 'text/plain') {
    // A BOM in front of a fields.json or an HTML file would hide what it is.
    return { name: file.name, kind: 'code', text: (await file.text()).replace(/^\uFEFF/, '').slice(0, 190_000) }
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

interface NeonBlock {
  // `new`: a new module for the library; `block`: a reusable custom block;
  // `test`: run the tool's internal tests (src/lib/self-test.ts)
  kind: 'current' | 'new' | 'block' | 'test'
  name?: string
  code: string
}

// Splits Maily's streamed answer into the visible text and its ```neon blocks.
// A plain ```neon block edits the open module; ```neon new <name> creates one.
function splitReply(acc: string, build = false): { text: string; blocks: NeonBlock[]; building: boolean } {
  // In « Modifier le module » a whole module written in a ```html fence instead
  // of ```neon is still the module (the model sometimes picks the wrong label).
  if (build && !/```neon/.test(acc)) acc = acc.replace(/```(?:html?|hubl)[^\n]*\n(?=[\s\S]*?data-neon=["']module["'])/i, '```neon\n')
  const blocks: NeonBlock[] = []
  let text = ''
  let rest = acc
  for (;;) {
    const start = rest.search(/```neon[^\n]*(\n|$)/)
    if (start < 0) {
      text += rest
      return { text: text.trim(), blocks, building: false }
    }
    const head = rest.slice(start).match(/```neon([^\n]*)\n?/)!
    const after = rest.slice(start + head[0].length)
    // The closing fence (an empty block, ```neon test, closes right away).
    const close = /(^|\n)```/.exec(after)
    text += rest.slice(0, start)
    if (!close) return { text: text.trim(), blocks, building: true }
    const end = close.index
    const m = /^\s*(new|block|test)\b\s*(.*)$/i.exec(head[1])
    const kind = m ? (m[1].toLowerCase() as 'new' | 'block' | 'test') : 'current'
    blocks.push({
      kind,
      name: m && kind !== 'test' ? m[2].trim().replace(/^["«']|["»']$/g, '') || (kind === 'new' ? 'Nouveau module' : 'Nouveau bloc') : undefined,
      code: after.slice(0, end),
    })
    rest = after.slice(end + close[0].length)
  }
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

// A long answer is shown folded (its start, then « Lire la suite ») so the
// conversation doesn't turn into a long scroll; never while it is being written.
const FOLD_PX = 280
function FoldedReply({ live, children }: { live: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setTall(el.scrollHeight > FOLD_PX + 80))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const folded = tall && !open && !live
  return (
    <>
      <div ref={ref} className={folded ? 'relative overflow-hidden' : undefined} style={folded ? { maxHeight: FOLD_PX } : undefined}>
        {children}
        {folded && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-panel to-transparent" />}
      </div>
      {tall && !live && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-cyan hover:underline"
        >
          <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden /> {open ? 'Réduire' : 'Lire la suite'}
        </button>
      )}
    </>
  )
}

async function* readText(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      const tail = decoder.decode()
      if (tail) yield tail
      return
    }
    yield decoder.decode(value, { stream: true })
  }
}

// ---- reaching Maily online -------------------------------------------------------

class MailyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Arrêté', 'AbortError'))), { once: true })
  })

const statusText = (status: number) =>
  status === 413
    ? 'Ta demande est trop lourde (images ou fichiers joints) : retire une pièce jointe et réessaie.'
    : status === 429
      ? 'Maily reçoit beaucoup de demandes : attends quelques secondes et réessaie.'
      : 'Maily ne répond pas pour le moment. Réessaie dans un instant.'

// Sends the request, trying again (up to 3 times) when the service is busy,
// overloaded or the connection drops, with the wait shown in the chat.
async function postMaily(body: object, signal: AbortSignal, onWait: (note: string) => void): Promise<ReadableStream<Uint8Array>> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await guardedFetch('/api/maily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
    } catch (e) {
      if (signal.aborted || isOffline() || attempt >= 2) throw e
      onWait('La connexion a sauté, je réessaie…')
      await pause(1500 * (attempt + 1), signal)
      continue
    }
    if (res.ok && res.body) return res.body
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    const again = res.status === 429 || res.status === 408 || res.status >= 500
    if (!again || attempt >= 2) throw new MailyError(data.error ?? statusText(res.status), res.status)
    const wait = Math.min(20, Math.max(2, Number(res.headers.get('Retry-After')) || (res.status === 429 ? 8 : 3)))
    onWait(res.status === 429 ? `Beaucoup de demandes en ce moment : nouvel essai dans ${wait} s…` : `Le service d’IA est surchargé : nouvel essai dans ${wait} s…`)
    await pause(wait * 1000, signal)
  }
}

// Keeps the request under the platform's size limit and the route's own limits:
// older images go first, then long old messages are shortened.
function fitPayload(payload: ReturnType<typeof toPayload>[]): ReturnType<typeof toPayload>[] {
  const BUDGET = 4_200_000
  let out = payload.map((m) => (m.content.length > 199_000 ? { ...m, content: `${m.content.slice(0, 198_000)}\n[… coupé : message trop long]` } : m))
  const size = () => JSON.stringify(out).length
  if (size() > BUDGET) out = out.map((m, i) => (i === out.length - 1 || !m.images ? m : { role: m.role, content: m.content }))
  for (const max of [20_000, 4_000, 800]) {
    if (size() <= BUDGET) break
    out = out.map((m, i) => (i < out.length - 1 && m.content.length > max ? { ...m, content: `${m.content.slice(0, max)}\n[… coupé]` } : m))
  }
  return out
}

// Maily's answer as text chunks. An answer cut on the way (platform time limit,
// dropped connection, model stopped inside a module) is resumed: the partial
// answer is sent back and the rest follows, up to 4 times.
async function* askMaily(body: object, signal: AbortSignal, onWait: (note: string) => void): AsyncGenerator<string> {
  let written = ''
  for (let round = 0; round < 5; round++) {
    let stream: ReadableStream<Uint8Array>
    try {
      stream = await postMaily(round ? { ...body, partial: written } : body, signal, onWait)
    } catch (e) {
      // The start of the answer is shown; what follows is reported as cut.
      if (round && !signal.aborted) return
      throw e
    }
    let held = ''
    let broken = false
    try {
      for await (const chunk of readText(stream)) {
        // The resume mark is held back until the end (never shown).
        if (held || chunk.includes(CONTINUE_MARK[0])) {
          held += chunk
          continue
        }
        written += chunk
        yield chunk
      }
    } catch (e) {
      if (signal.aborted) throw e
      broken = true
    }
    const resume = wantsContinue(held)
    if (held) {
      const rest = stripMark(held)
      written += rest
      if (rest) yield rest
    }
    if (!written) {
      if (broken) throw new MailyError(statusText(0), 0)
      return
    }
    if (!resume && !broken && !splitReply(written).building) return
    onWait('')
  }
}

// Fits the conversation into the on-device model's window (~3 characters per
// token): the last message first, then the most recent ones; turns alternate.
function localTurns(payload: ReturnType<typeof toPayload>[], budget: number): LocalMessage[] {
  const out: LocalMessage[] = []
  let left = budget
  for (let i = payload.length - 1; i >= 0 && left > 200; i--) {
    const m = payload[i]
    const max = i === payload.length - 1 ? left : Math.min(left, 2500)
    const content = m.content.length > max ? `${m.content.slice(0, max - 40)}\n[… coupé pour le mode hors ligne]` : m.content
    const prev = out[0]
    if (prev && prev.role === m.role) prev.content = `${content}\n\n${prev.content}`
    else out.unshift({ role: m.role, content, ...(i === payload.length - 1 && m.images ? { images: m.images } : {}) })
    left -= content.length
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

const TIPS = [
  'Un objet de moins de 45 caractères s\'affiche en entier sur la plupart des mobiles.',
  'Un seul appel à l\'action principal par email : il est cliqué jusqu\'à 2× plus.',
  'Ajoute toujours un texte alternatif à tes images : beaucoup de clients mail les bloquent par défaut.',
  'Personnalise l\'accroche avec {{ contact.firstname }} et prévois un {% else %} pour les contacts sans prénom.',
  'Garde ton email sous 600 px de large pour un rendu fiable dans Outlook.',
  'Sur mobile, empile les colonnes : la lecture se fait au pouce, de haut en bas.',
]

// A request for the internal tests (also answered without any model).
const TEST_ASK = /\b(teste|tester|test|tests|diagnostic|v[ée]rifie (que )?(tout|l['’]outil|l['’]appli))/i

const SUGGESTIONS: Record<Mode, string[]> = {
  chat: [
    'Lance les tests internes de l\'outil',
    'Complète ma bibliothèque avec les modules qui manquent',
    'Propose 5 objets d\'email pour ce module',
    'Vérifie l\'accessibilité de ce module',
    'Comment tester le rendu dans Outlook ?',
    'Quelles sont les tendances design email du moment ?',
    'Comment récupérer mon module pour l\'utiliser ailleurs ?',
    'Crée-moi un nouveau module de témoignage client avec ses champs',
  ],
  build: [
    'Crée un nouveau module « Bannière promo » avec titre, texte, image et bouton',
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
  addSection,
  request,
}: {
  tree: ModuleTree
  code: string
  moduleName: string
  /** A message sent for the user (the validator's "Maily" button); `n` changes each time. */
  request?: { text: string; n: number } | null
  applyCode: (code: string, specs?: FieldSpec[], values?: Record<string, unknown> | null) => string | null
  // Appends a custom block to the open module; returns a message when it is refused (duplicate)
  addSection: (section: Section) => string | null
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
  const { online, pending } = useDataStatus()
  // The tool's internal tests on the open module, the templates, the library and this device.
  const testTool = async () => {
    const [mods, blks] = await Promise.all([loadModules().catch(() => []), loadBlocks().catch(() => [])])
    return runSelfTests({ tree, name: moduleName, modules: mods.map((m) => m.name), blocks: blks.map((b) => b.name), pending })
  }
  const localAi = useOfflineAi()
  const onDevice = !online && localAi.status === 'ready'

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

  // One round trip with Maily: streams her answer, then validates and applies
  // each module block. A block that fails the check is sent back to her to fix
  // (twice at most) instead of reaching the editor.
  const converse = async (
    history: Msg[],
    // `local`: answered by the on-device model (no connection)
    // `tested`: the internal tests already ran for this request (never twice in a row)
    ctx: { requestCode: string; imported: boolean; issue?: string; specs: FieldSpec[]; local?: boolean; tested?: boolean },
    attempt: number,
    signal: AbortSignal,
  ): Promise<void> => {
    // Resend only the latest images to keep the request light.
    const withImages = new Set(
      history
        .map((m, i) => (m.files?.some((f) => f.kind === 'image') ? i : -1))
        .filter((i) => i >= 0)
        .slice(-IMAGE_HISTORY),
    )
    const fields = collectFields(tree)
      .map((f) => `- ${f.name} (${f.label}) : ${f.block.type}`)
      .join('\n')

    let source: AsyncIterable<string>
    if (ctx.local) {
      // Same instructions and protocol as online, sized for the small model.
      const tokens = localContextTokens()
      const reserve = Math.round(mode === 'build' || ctx.issue || ctx.imported ? Math.min(3000, tokens * 0.4) : Math.min(1000, tokens * 0.2))
      const chars = (tokens - reserve) * 3
      const payload = history.map((m, i) => toPayload(m, i === history.length - 1))
      const turns = localTurns(payload, Math.round(chars * 0.35))
      const used = turns.reduce((n, t) => n + t.content.length, 0)
      const library = await Promise.all([loadModules(), loadBlocks()])
        .then(([m, b]) => libraryNote(m.slice(0, 60).map((x) => x.name), b.slice(0, 60)))
        .catch(() => '')
      const system = localSystemPrompt(
        {
          mode,
          code: ctx.requestCode,
          moduleName,
          imported: ctx.imported,
          issue: ctx.issue,
          fields: fields || undefined,
          fieldSpecs: ctx.specs.length ? JSON.stringify(ctx.specs) : undefined,
          library,
          query: turns[turns.length - 1]?.content ?? '',
        },
        chars - used,
      )
      source = streamOfflineMaily(system, turns, reserve, signal)
      push({ role: 'assistant', content: '' })
    } else {
      // Shown at once, with what is happening while Maily is reached.
      push({ role: 'assistant', content: '', waiting: true })
      const onWait = (note: string) => {
        if (!note) return
        setMessages((prev) => {
          const last = prev.at(-1)
          if (!last?.waiting) return prev
          return [...prev.slice(0, -1), { ...last, content: `_${note}_` }]
        })
      }
      const sent = history.slice(-40)
      source = askMaily(
        {
          messages: fitPayload(sent.map((m, i) => toPayload(m, withImages.has(i + history.length - sent.length)))),
          mode,
          code: ctx.requestCode?.slice(0, 399_000),
          moduleName,
          imported: ctx.imported,
          issue: ctx.issue?.slice(0, 500),
          fields: fields.slice(0, 8_000),
          fieldSpecs: ctx.specs.length ? JSON.stringify(ctx.specs).slice(0, 20_000) : undefined,
        },
        signal,
        onWait,
      )
    }
    let acc = ''
    for await (const chunk of source) {
      acc += chunk
      const part = splitReply(acc, mode === 'build')
      // Hide a ```neon fence that is still arriving.
      const visible = part.building || part.blocks.length ? part.text : part.text.replace(/`{1,3}(n(e(on?)?)?)?$/, '')
      setLast({ role: 'assistant', content: visible, building: part.building || part.blocks.length > 0 })
    }

    const reply = splitReply(acc, mode === 'build')
    // Internal tests asked by Maily (```neon test): run here, shown in the chat,
    // then handed back to her so she explains them and acts on them.
    if (reply.blocks.some((b) => b.kind === 'test')) {
      const results = await testTool()
      const report = formatReport(results)
      setLast({ role: 'assistant', content: `${reply.text || 'Je lance les tests internes…'}\n\n${report}`, tests: true })
      if (ctx.tested) {
        setMood('happy')
        return
      }
      const past: Msg = { role: 'assistant', content: `${reply.text}\n\n[Tests internes lancés]`, hidden: true }
      const back: Msg = {
        role: 'user',
        hidden: true,
        content: `Résultats des tests internes (déjà affichés à l'utilisateur, ne les recopie pas) :\n${report}\n\nRésume en 2 à 4 lignes ce qui va et ce qui demande une action, en langage simple. Puis agis selon la DEMANDE de l'utilisateur : s'il t'a demandé de corriger, corrige le module ouvert (bloc neon) ; s'il t'a demandé de compléter la bibliothèque ou de créer ce qui manque, crée les modules ou blocs manquants (3 au plus, \`neon new\` ou \`neon block\`, cohérents avec le style du module ouvert, jamais de doublon). Sinon, propose ces actions sans les faire. Ne relance pas de test.`,
      }
      return converse([...history, past, back], { ...ctx, tested: true }, attempt, signal)
    }
    if (!reply.blocks.length) {
      setLast({
        role: 'assistant',
        content:
          (reply.text ? `${reply.text}${reply.building ? '\n\n' : ''}` : '') +
          (reply.building ? '⚠️ La génération du module a été coupée avant la fin, même après reprise.' : reply.text ? '' : '⚠️ Je n’ai reçu aucune réponse.'),
        retry: reply.building || !reply.text || undefined,
      })
      setMood('happy')
      return
    }

    const created: { id: string; name: string; existing?: boolean }[] = []
    const savedBlocks: CustomBlock[] = []
    const notes: string[] = []
    const problems: string[] = []
    let applied = false
    // Modules already in the library, to never create the same one twice.
    let library: { id: string; name: string }[] | null = null
    for (const block of reply.blocks) {
      if (block.kind === 'test') continue
      const label = block.kind === 'block' ? `le bloc « ${block.name} »` : block.name ? `« ${block.name} »` : 'le module ouvert'
      // Mechanical slips (a missing {% endif %}, an unfinished {{ x }…) are
      // repaired exactly by the validator instead of costing a correction round.
      const repaired = validateSyntax(block.code).issues.some((i) => i.fix?.safe) ? fixCode(block.code).code : block.code
      const check = validateModuleCode(repaired, tree, ctx.specs)
      if (!check.ok || !check.tree) {
        problems.push(`${label} : ${check.issues.join(' ') || check.summary}`)
        continue
      }
      if (block.kind === 'block') {
        if (check.tree.sections.length !== 1) {
          problems.push(`${label} : un bloc personnalisé contient exactement une section (reçu ${check.tree.sections.length})`)
          continue
        }
        try {
          const name = block.name!.slice(0, 80)
          const section = check.tree.sections[0]
          const res = await saveBlock(name, '', section)
          refreshCustomBlocks()
          if (!res.block) {
            // Offline: kept on this device, sent to the library later.
            savedBlocks.push({ id: crypto.randomUUID(), name, description: '', section, createdAt: new Date().toISOString() })
            notes.push(`Bloc « ${name} » enregistré sur cet appareil : il rejoint Mes blocs au retour de la connexion`)
            continue
          }
          savedBlocks.push(res.block)
          notes.push(
            res.status === 'created'
              ? `Bloc « ${res.block.name} » ajouté à ta bibliothèque (Structure > Ajouter > Mes blocs)`
              : res.status === 'updated'
                ? `Bloc « ${res.block.name} » mis à jour (même nom, pas de doublon)`
                : `Un bloc identique existe déjà (« ${res.block.name} ») : je l'ai réutilisé, sans doublon`,
          )
        } catch {
          problems.push(`${label} : l'enregistrement dans la bibliothèque a échoué`)
        }
        continue
      }
      if (block.kind === 'new') {
        try {
          library ??= (await loadModules()).map((m) => ({ id: m.id, name: m.name }))
          const twin = library.find((m) => slugify(m.name) === slugify(block.name!))
          if (twin) {
            created.push({ id: twin.id, name: twin.name, existing: true })
            notes.push(`Le module « ${twin.name} » existe déjà : je ne l'ai pas dupliqué (choisis un autre nom pour en créer une variante)`)
            continue
          }
          // A new module in the library: its outside images are copied into the tool first.
          const got = await bringImages(textsOf(check.tree).join('\n'))
          const imagesSaid = imagesNote(got)
          if (imagesSaid) notes.push(imagesSaid)
          const rec = await createLocalFirst(block.name!.slice(0, 120), swapUrls(check.tree, got.map))
          library.push({ id: rec.id, name: rec.name })
          created.push({ id: rec.id, name: rec.name })
        } catch {
          problems.push(`${label} : la création dans la bibliothèque a échoué`)
          continue
        }
      } else {
        const error = applyCode(repaired, ctx.specs)
        if (error) {
          problems.push(`${label} : ${error}`)
          continue
        }
        applied = true
      }
      const bound = check.binding?.bound.flatMap((f) => f.exposed) ?? []
      if (bound.length) notes.push(`Champs construits pour ${label} : ${bound.join(', ')}`)
      check.warnings.filter((w) => /non liées|normalisés/.test(w)).forEach((w) => notes.push(w))
    }

    const body = reply.text || (created.length || savedBlocks.length || applied ? 'C\'est fait ! ✨' : '')
    const extra = notes.length ? `\n\n${notes.map((n) => `- ${n}`).join('\n')}` : ''

    if (problems.length && attempt < 2) {
      // Automatic correction loop: the engine's findings go back to Maily.
      setLast({ role: 'assistant', content: `${body}${extra}\n\n🔧 Vérification du moteur : ${problems.join(' ; ')}. Je demande une correction…`, applied, created, blocks: savedBlocks })
      const fix: Msg = {
        role: 'user',
        hidden: true,
        content: `Vérification automatique du moteur : ${problems.join(' ; ')}. Renvoie le module complet corrigé dans un bloc neon (garde \`new\` et le nom pour un module de la bibliothèque, ne renvoie que les modules refusés).`,
      }
      const past: Msg = { role: 'assistant', content: `${reply.text}\n\n[Module refusé par la vérification du moteur]`, hidden: true }
      return converse([...history, past, fix], ctx, attempt + 1, signal)
    }

    const fail = problems.length ? `\n\n⚠️ Non appliqué : ${problems.join(' ; ')}` : ''
    setLast({
      role: 'assistant',
      content: `${body}${extra}${fail}`,
      applied: applied || undefined,
      created: created.length ? created : undefined,
      blocks: savedBlocks.length ? savedBlocks : undefined,
    })
    setMood(applied || created.length || savedBlocks.length ? 'success' : 'happy')
  }

  // Last request, so « Réessayer » can send it again as it was.
  const dropPlaceholder = () =>
    setMessages((prev) => {
      const last = prev.at(-1)
      return last?.role === 'assistant' && (last.waiting || !last.content.trim()) ? prev.slice(0, -1) : prev
    })

  const send = async (text: string, attached: Attachment[] = files, base: Msg[] = messages) => {
    const content = text.trim()
    if ((!content && !attached.length) || loading) return
    setInput('')
    setFiles([])

    // Code typed in the message becomes attachments, like pasted code (several
    // fenced blocks: HTML, CSS and fields.json are told apart).
    const typed = extractCode(content)
    const sent = typed ? [...attached.slice(0, 3), ...typed.files.map((f) => ({ name: f.name, kind: 'code' as const, text: f.text }))].slice(0, 6) : attached
    const instruction = typed ? typed.instruction : content
    const jsonFiles = sent.filter((f) => f.kind === 'code' && /\.json$/i.test(f.name))
    // An attached fields.json gives the exact names, labels and defaults; any
    // other JSON (another tool's fields, values, schema, API module…) helps too.
    const fieldsJson = jsonFiles.flatMap((f) => (/^\s*(\/[/*][^\n]*\n\s*)*\[/.test(f.text ?? '') ? (parseFieldsJson(f.text ?? '') ?? []) : []))
    const foreign = jsonFiles.map((f) => (/^\s*(\/[/*][^\n]*\n\s*)*\[/.test(f.text ?? '') ? null : parseForeignJson(f.text ?? ''))).find((x) => !!x) ?? null
    const codeFiles = sent.filter((f) => f.kind === 'code' && !/\.json$/i.test(f.name))
    // A style sheet sent beside the HTML is applied to it (its rules are inlined at import).
    const css = codeFiles.filter((f) => /\.css$/i.test(f.name)).map((f) => f.text ?? '').join('\n')
    const markup = codeFiles
      .filter((f) => !/\.css$/i.test(f.name))
      .map((f) => f.text)
      .join('\n')
    const pasted = markup && css.trim() ? `<style>\n${css}\n</style>\n${markup}` : markup
    // No code but a fields.json / module JSON: a module is built from the fields.
    const fieldDefs = fieldsJson.length ? fieldsJson : foreign?.specs.length ? foreign.specs : null
    const source = pasted || foreign?.html || (fieldDefs ? codeFromFields(fieldDefs) : '')
    const specs = source ? (importSpecs(source, fieldsJson, foreign) ?? []) : fieldsJson

    // Recognised code is rendered right away; Maily then reviews it (or
    // improves it herself when the direct conversion is incomplete).
    let requestCode = code
    let imported: string | undefined
    let issue: string | undefined
    let partialImport: string | undefined
    if (source && wantsConversion(instruction, mode)) {
      const rec = recognizeCode(source, tree, specs)
      if (rec.ok && rec.complete && !applyCode(rec.source, specs, foreign?.values)) {
        imported = rec.summary
        requestCode = treeToCode(rec.tree, moduleName)
      } else if (rec.ok && !applyCode(rec.source, specs, foreign?.values)) {
        // Incomplete but usable: shown at once (undoable), so the user has a
        // render even if Maily can't be reached; she then completes it.
        partialImport = `${rec.summary}\n\nCe n'est pas encore parfait (${rec.issue ?? 'conversion incomplète'}) : je l'améliore…`
        requestCode = treeToCode(rec.tree, moduleName)
        issue = `${rec.kind} reconnu, conversion directe incomplète : ${rec.issue ?? 'application impossible'}. Cette première conversion est déjà appliquée (module actuel ci-dessous) : améliore-la à partir du code d'origine joint, garde ce qui est déjà bien converti`
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
    const history: Msg[] = [...base, userMsg]
    const note = imported ?? partialImport
    setMessages(note ? [...history, { role: 'assistant', content: note, applied: true }] : history)
    setLoading(true)
    setMood('thinking')
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const ctx = { requestCode, imported: !!imported, issue, specs }
    const canLocal = () => localAiEnabled() && localAi.status === 'ready'
    try {
      try {
        await converse(history, { ...ctx, local: isOffline() && localAiEnabled() }, 0, ctrl.signal)
      } catch (e) {
        // Maily can't be reached (no connection, or the service stays down
        // after the retries): the on-device model takes over when there is one.
        const network = isOffline() || isNetworkError(e)
        if (ctrl.signal.aborted || (e as Error).name === 'AbortError' || !(network ? localAiEnabled() : canLocal() && e instanceof MailyError && e.status !== 413 && e.status !== 400)) throw e
        dropPlaceholder()
        await converse(history, { ...ctx, local: true }, 0, ctrl.signal)
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError' || ctrl.signal.aborted) {
        setMessages((prev) =>
          prev.filter((m, i) => !(i === prev.length - 1 && m.waiting)).map((m) => (m.building ? { ...m, building: false, content: m.content || 'Génération arrêtée.' } : m)),
        )
      } else if (isOffline() || isNetworkError(e)) {
        dropPlaceholder()
        push({
          role: 'assistant',
          retry: true,
          content: localAiEnabled()
            ? '⚠️ Mon modèle hors ligne n’a pas pu répondre. Réessaie, ou attends le retour de la connexion : l’éditeur, lui, continue de fonctionner.'
            : // No model on the device: Maily still answers, from her built-in guide
              // (and still runs the internal tests when they are asked for).
              TEST_ASK.test(userMsg.content)
              ? formatReport(await testTool())
              : guideAnswer(userMsg.content),
        })
      } else {
        dropPlaceholder()
        push({
          role: 'assistant',
          retry: true,
          content: `⚠️ ${(e as Error).message}${note ? '\n\nLe code joint est quand même appliqué dans l’éditeur (↶ pour annuler).' : ''}`,
        })
      }
      setMood('happy')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  // Sends the last user message again, as it was (after a failure).
  const retryLast = () => {
    let idx = messages.length - 1
    while (idx >= 0 && !(messages[idx].role === 'user' && !messages[idx].hidden)) idx--
    if (idx < 0 || loading) return
    const m = messages[idx]
    // The original files come back; code typed in the message is in them already.
    void send(m.content, m.files ?? [], messages.slice(0, idx))
  }

  // The validator's request: sent once, as if the user had typed it.
  const handled = useRef(0)
  useEffect(() => {
    if (!request || request.n === handled.current || loading) return
    handled.current = request.n
    void send(request.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n, loading])

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
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 land:py-1.5">
        <Maily size={48} mood={mood} className="land:hidden" />
        <div className="min-w-0">
          <p className="font-display font-semibold tracking-wide">NEON AI CHAT</p>
          <p className="text-xs text-mute">{loading ? 'Maily réfléchit…' : onDevice ? 'Maily · hors ligne · sur l’appareil' : !online ? 'Maily · hors ligne · guide intégré' : 'Maily · en ligne · recherche web'}</p>
        </div>
      </div>
      <MailyOffline offline={!online} />

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-4 max-sm:space-y-2.5 max-sm:p-3 land:p-2">
        <button
          onClick={() => setTip((t) => (t + 1) % TIPS.length)}
          className="w-full rounded-lg border border-cyan/30 bg-cyan/5 p-3 text-left"
          title="Astuce suivante"
        >
          <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan">
            <Lightbulb className="size-3.5" aria-hidden /> L'astuce de Maily
          </span>
          <span className="block text-sm text-[#d9d9ec]">{TIPS[tip]}</span>
        </button>

        {messages.length === 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs text-mute">
              Pose-moi n'importe quelle question (je cherche sur le web les infos récentes), colle du code HTML ou HuBL (avec son fields.json si tu l'as) : je le transforme
              en rendu avec les champs exacts. Je peux aussi créer de nouveaux modules dans ta bibliothèque, ou recréer une capture en blocs éditables.
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

        {messages.map((m, i) =>
          m.hidden ? null : (
          <div key={i} className={m.role === 'user' ? 'flex min-w-0 justify-end' : 'flex min-w-0 gap-2'}>
            {m.role === 'assistant' && <Maily size={26} bob={false} mood={m.applied ? 'success' : 'happy'} className="mt-1 shrink-0 max-sm:hidden" />}
            <div
              className={`max-w-[88%] min-w-0 rounded-xl px-3 py-2 text-sm [overflow-wrap:anywhere] max-sm:max-w-[94%] ${
                m.role === 'user' ? 'bg-pink-fill text-white' : 'maily-md border border-line bg-panel text-[#e3e3f0]'
              }`}
            >
              {m.role === 'assistant' ? (
                <>
                  {m.content ? (
                    <FoldedReply live={!!m.building || (loading && i === messages.length - 1)}>
                      <Streamdown>{m.content}</Streamdown>
                    </FoldedReply>
                  ) : (
                    !m.building && <Loader2 className="size-4 animate-spin text-cyan" />
                  )}
                  {m.building && (
                    <p className={`flex items-center gap-2 text-mute ${m.content ? 'mt-2' : ''}`}>
                      <Loader2 className="size-4 animate-spin text-pink" /> Maily construit ton module…
                    </p>
                  )}
                  {m.retry && i === messages.length - 1 && !loading && (
                    <button
                      type="button"
                      onClick={retryLast}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-cyan/40 bg-cyan/5 px-2 py-1.5 text-xs text-cyan hover:bg-cyan/10"
                    >
                      <RotateCcw className="size-3.5" aria-hidden /> Réessayer
                    </button>
                  )}
                  {m.applied && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-cyan">
                      <CheckCircle2 className="size-3.5" /> Module appliqué · ↶ pour annuler
                    </p>
                  )}
                  {m.created?.map((c) => (
                    <a
                      key={c.id}
                      href={`/editor/${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 flex items-center gap-1.5 rounded-md border border-cyan/40 bg-cyan/5 px-2 py-1.5 text-xs text-cyan hover:bg-cyan/10"
                    >
                      <Plus className="size-3.5 shrink-0" /> {c.existing ? 'Module existant' : 'Module créé'} : <span className="truncate font-semibold">{c.name}</span>
                      <ExternalLink className="ml-auto size-3.5 shrink-0" /> Ouvrir
                    </a>
                  ))}
                  {m.blocks?.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        const refused = addSection(c.section)
                        push({ role: 'assistant', content: refused ?? `Bloc « ${c.name} » ajouté au module ✨`, applied: !refused })
                      }}
                      className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-pink/40 bg-pink/5 px-2 py-1.5 text-left text-xs text-pink hover:bg-pink/10"
                    >
                      <Plus className="size-3.5 shrink-0" /> Ajouter « <span className="truncate font-semibold">{c.name}</span> » au module
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {m.files && <Attachments files={m.files} />}
                  {m.content}
                </>
              )}
            </div>
          </div>
          ),
        )}
      </div>

      <div className="border-t border-line p-3 land:p-1.5">
        <div className="mb-2 flex rounded-md border border-line bg-void p-0.5 text-xs land:mb-1">
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
              // Long code (HTML, HuBL, CSS, fields.json…) is kept as an attachment
              // named after its kind, so the textarea stays usable.
              const html = e.clipboardData.getData('text/plain')
              const name = html.length > 300 ? codeFileName(html) : null
              if (name) {
                e.preventDefault()
                setFiles((prev) => [...prev, { name, kind: 'code' as const, text: html.slice(0, 190_000) }].slice(0, 4))
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
            <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Arrêter" className="rounded-lg bg-line p-2.5 hover:bg-pink-fill">
              <Square className="size-4" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() && !files.length} aria-label="Envoyer" className="rounded-lg bg-pink-fill p-2.5 text-white disabled:opacity-40">
              <Send className="size-4" />
            </button>
          )}
        </form>
        <a
          href={KOFI_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-mute hover:text-pink land:hidden"
        >
          <Heart className="size-3" /> Un commentaire ou un coup de pouce ? Ko-fi
        </a>
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
