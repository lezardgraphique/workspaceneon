import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { eq } from 'drizzle-orm'

import { sessionUser, unauthorized } from '@/server/auth.server'
import { db } from '../../db/index.js'
import { customBlocks, modules } from '../../db/schema.js'
import { ai, attemptsFor, configRefused, retryable, sleep, statusOf, thinkingFor } from '@/lib/gemini.server'
import type { Attempt } from '@/lib/gemini.server'
import { CONTINUE_MARK, CONTINUE_PROMPT, trimOverlap } from '@/lib/continuation'
import { CLAUDE_MODELS, CLAUDE_NOTE, claudeEnabled, claudeStream, takeClaudeTurn, type ClaudeTurn } from '@/server/claude.server'
import { libraryNote, onlineSystemPrompt } from '@/lib/maily-prompts'

// Screenshots or mockups the user wants Maily to recreate (base64, no data: prefix).
const Image = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z.string().max(3_000_000),
})

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        // Large enough for a pasted or attached HTML file to recreate.
        content: z.string().max(200_000),
        images: z.array(Image).max(4).optional(),
      }),
    )
    .min(1)
    .max(40),
  mode: z.enum(['chat', 'build']).default('chat'),
  code: z.string().max(400_000).optional(),
  moduleName: z.string().max(200).optional(),
  // The attached code was already converted into the editor's module.
  imported: z.boolean().optional(),
  // Why the direct conversion of the attached code fell short.
  issue: z.string().max(500).optional(),
  // Fields of the open module (name, label, type), one per line.
  fields: z.string().max(8_000).optional(),
  // Fields parsed from an attached fields.json (JSON array of name/label/type/default).
  fieldSpecs: z.string().max(20_000).optional(),
  // The answer so far, when the editor asks for the rest of a cut answer.
  partial: z.string().max(400_000).optional(),
})

// Google Search and URL reading keep Maily's answers current; the model decides
// when to use them.
const TOOLS = [{ googleSearch: {} }, { urlContext: {} }]

interface Source {
  uri: string
  title: string
}

type Content = { role: 'user' | 'model'; parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] }
type Chunk = { text?: string; candidates?: { groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string; domain?: string } }[] } }[] }

// The platform stops a response after about a minute: the stream is closed a
// little before with CONTINUE_MARK and the editor asks for the rest.
const BUDGET_MS = 48_000
// Longest wait for the first words of an attempt before trying the next model
// (the first one may think a little longer).
// With a request-sized prompt the first words come in a few seconds: a model
// that stays silent longer is overloaded, the next one is tried sooner.
const firstWordsMs = (i: number) => (i === 0 ? 22_000 : 14_000)

const withTimeout = <T,>(p: Promise<T>, ms: number, abort: () => void): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      abort()
      reject(new Error('timeout: no answer'))
    }, ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })

// Streams Maily's answer as plain text chunks. When she builds a module the
// answer contains a ```neon block that the editor applies. Overloaded or
// missing models are replaced by the next ones, refused options (search tools,
// thinking) are dropped, a stream that breaks is resumed, and an answer that
// would run past the platform's time limit ends with CONTINUE_MARK.
export const Route = createFileRoute('/api/maily')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now()
        const user = await sessionUser()
        if (!user) return unauthorized()
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
          return Response.json({ error: 'Ta demande est trop volumineuse ou incomplète : allège les pièces jointes (images, gros fichiers) et réessaie.' }, { status: 400 })
        }
        const { messages, mode, code, moduleName, imported, issue, fields, fieldSpecs, partial } = parsed.data

        // What already exists, so Maily reuses it instead of creating a twin.
        const library = await Promise.all([
          db.select({ name: modules.name }).from(modules).where(eq(modules.userId, user.id)).limit(60),
          db.select({ name: customBlocks.name, description: customBlocks.description }).from(customBlocks).where(eq(customBlocks.userId, user.id)).limit(60),
        ])
          .then(([m, b]) => libraryNote(m.map((x) => x.name), b))
          .catch(() => '')

        const base: Content[] = messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [
            ...(m.images ?? []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
            { text: m.content || 'Recrée ce module.' },
          ],
        }))
        const resume = (before: string): Content[] => [...base, { role: 'model', parts: [{ text: before }] }, { role: 'user', parts: [{ text: CONTINUE_PROMPT }] }]

        // Claude, Maily's expert for code: first when she recognises, builds or
        // fixes a module (within the account's daily allowance); Gemini after it.
        const lastAsk = messages[messages.length - 1]?.content ?? ''
        const aboutCode = mode === 'build' || !!issue || !!fieldSpecs || (lastAsk.length > 80 && /<[a-z!][\s\S]*>|\{%|\{\{|\*\|[A-Z_]+\|\*|%%\[/i.test(lastAsk))
        // Only what this request needs (guide passages, specs, module, web tools):
        // the whole guide and module with every message made Maily slow.
        const recent = messages
          .filter((m) => m.role === 'user')
          .slice(-2)
          .map((m) => m.content.slice(0, 2_000))
          .join('\n')
        const prompt = onlineSystemPrompt({ mode, code, moduleName, imported, issue, fields, fieldSpecs, library, ask: lastAsk.slice(0, 4_000), recent, aboutCode })
        const systemInstruction = prompt.system
        // Building a module deserves a little more thought; a chat answer must come fast.
        const level = mode === 'build' || issue ? 'medium' : prompt.light ? 'minimal' : 'low'
        const useClaude = claudeEnabled() && aboutCode && (await takeClaudeTurn(user.id, !!partial))
        const turns: ClaudeTurn[] = messages.map((m) => ({ role: m.role, text: m.content || 'Recrée ce module.', images: m.images }))
        const claudeTurnsFor = (before?: string): ClaudeTurn[] =>
          before ? [...turns, { role: 'assistant', text: before }, { role: 'user', text: CONTINUE_PROMPT }] : turns
        const claudeSystem = systemInstruction + CLAUDE_NOTE

        // Opens a Claude stream that has started to answer (null if none could).
        const openClaude = async (before?: string): Promise<{ first: Chunk; rest: AsyncIterator<Chunk>; attempt: Attempt } | null> => {
          for (let i = 0; i < CLAUDE_MODELS.length; i++) {
            const model = CLAUDE_MODELS[i]
            const left = BUDGET_MS - (Date.now() - started) - 10_000
            if (left < 8_000) return null
            const ctrl = new AbortController()
            const onAbort = () => ctrl.abort()
            request.signal.addEventListener('abort', onAbort, { once: true })
            try {
              const it = claudeStream(model, claudeSystem, claudeTurnsFor(before), ctrl.signal)[Symbol.asyncIterator]()
              for (;;) {
                const r = await withTimeout(it.next(), Math.min(i === 0 ? 24_000 : 14_000, left), onAbort)
                if (r.done) throw new Error('empty answer')
                if (r.value) {
                  const rest: AsyncIterator<Chunk> = {
                    next: async () => {
                      const n = await it.next()
                      return n.done ? { done: true, value: undefined } : { done: false, value: { text: n.value } }
                    },
                  }
                  return { first: { text: r.value }, rest, attempt: { model, tools: false, thinking: false } }
                }
              }
            } catch (err) {
              if (request.signal.aborted) throw err
              console.error(`Maily ${model} :`, statusOf(err) || '', String((err as Error)?.message ?? err).slice(0, 300))
            } finally {
              request.signal.removeEventListener('abort', onAbort)
            }
          }
          return null
        }

        // Opens a stream that has started to answer, trying the models in turn.
        const open = async (contents: Content[], withTools: boolean, before?: string): Promise<{ first: Chunk; rest: AsyncIterator<Chunk>; attempt: Attempt }> => {
          if (useClaude) {
            const c = await openClaude(before)
            if (c) return c
          }
          let last: unknown
          const attempts = attemptsFor(withTools)
          for (let i = 0; i < attempts.length; i++) {
            let a = attempts[i]
            for (let variant = 0; variant < 3; variant++) {
              const left = BUDGET_MS - (Date.now() - started) - 6_000
              if (left < 4_000) throw last ?? new Error('timeout: no time left')
              const ctrl = new AbortController()
              const onAbort = () => ctrl.abort()
              request.signal.addEventListener('abort', onAbort, { once: true })
              try {
                const stream = await withTimeout(
                  ai.models.generateContentStream({
                    model: a.model,
                    contents,
                    config: {
                      temperature: 0.4,
                      abortSignal: ctrl.signal,
                      ...(a.tools ? { tools: TOOLS } : {}),
                      ...(a.thinking ? thinkingFor(a.model, level) : {}),
                      systemInstruction,
                    },
                  }),
                  Math.min(firstWordsMs(i), left),
                  onAbort,
                )
                const it = (stream as AsyncIterable<Chunk>)[Symbol.asyncIterator]()
                // Wait for the first words: errors often come with the first chunk.
                for (;;) {
                  const r = await withTimeout(it.next(), Math.min(firstWordsMs(i), Math.max(2_000, BUDGET_MS - (Date.now() - started) - 4_000)), onAbort)
                  if (r.done) throw new Error('empty answer')
                  if (r.value.text) return { first: r.value, rest: it, attempt: a }
                }
              } catch (err) {
                last = err
                if (request.signal.aborted) throw err
                console.error(`Maily ${a.model}${a.tools ? ' +outils' : ''}${a.thinking ? ' +réflexion' : ''} :`, statusOf(err) || '', String((err as Error)?.message ?? err).slice(0, 300))
                // An option refused: same model without it.
                if (configRefused(err) && (a.tools || a.thinking)) {
                  a = a.tools ? { ...a, tools: false } : { ...a, thinking: false }
                  continue
                }
                break
              } finally {
                request.signal.removeEventListener('abort', onAbort)
              }
            }
            if (!retryable(last) && !configRefused(last)) throw last
            await sleep(Math.min(1_500, 350 * (i + 1)))
          }
          throw last
        }

        const contents = partial ? resume(partial) : base
        let opened: Awaited<ReturnType<typeof open>>
        try {
          opened = await open(contents, prompt.web, partial)
        } catch (err) {
          console.error('Maily error', err)
          const s = statusOf(err)
          const busy = s === 429 || /exhausted|quota/i.test(String((err as Error)?.message ?? ''))
          return Response.json(
            {
              error: busy
                ? 'Maily reçoit beaucoup de demandes en ce moment. Réessaie dans quelques secondes.'
                : 'Maily ne répond pas pour le moment (service d’IA surchargé ou injoignable). Réessaie dans un instant.',
              retry: true,
            },
            { status: 503, headers: { 'Retry-After': busy ? '8' : '3' } },
          )
        }

        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream({
            async start(controller) {
              const sources = new Map<string, Source>()
              let written = partial ?? ''
              let out = ''
              // The editor may have gone (tab closed, « Arrêter »): writing then is harmless.
              const write = (text: string) => {
                try {
                  controller.enqueue(encoder.encode(text))
                } catch {
                  /* stream already closed */
                }
              }
              const emit = (text: string) => {
                if (!text) return
                written += text
                out += text
                write(text)
              }
              const collect = (chunk: Chunk) => {
                for (const g of chunk.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
                  if (g.web?.uri) sources.set(g.web.uri, { uri: g.web.uri, title: g.web.title || g.web.domain || 'Source' })
                }
              }
              let { first, rest, attempt } = opened
              let resumes = 0
              let cut = false
              // A resumed stream may start by repeating what is written: held back until it can be compared.
              let hold = partial ? '' : null
              const push = (text: string) => {
                if (hold === null) return emit(text)
                hold += text
                if (hold.length < 400) return
                emit(trimOverlap(written, hold))
                hold = null
              }
              try {
                push(first.text ?? '')
                collect(first)
                for (;;) {
                  if (Date.now() - started > BUDGET_MS) {
                    cut = true
                    break
                  }
                  let r: IteratorResult<Chunk>
                  try {
                    r = await withTimeout(rest.next(), Math.max(1_000, BUDGET_MS + 4_000 - (Date.now() - started)), () => undefined)
                  } catch (err) {
                    if (request.signal.aborted) break
                    console.error('Maily stream error', statusOf(err) || '', String((err as Error)?.message ?? err).slice(0, 300))
                    if (hold !== null) {
                      emit(trimOverlap(written, hold))
                      hold = null
                    }
                    // Broken stream: resumed from what is written (another model if needed).
                    if (resumes < 2 && BUDGET_MS - (Date.now() - started) > 15_000) {
                      resumes++
                      try {
                        const again = await open(resume(written), attempt.tools, written)
                        ;({ rest, attempt } = again)
                        hold = ''
                        push(again.first.text ?? '')
                        collect(again.first)
                        continue
                      } catch {
                        /* resumed by the editor below */
                      }
                    }
                    cut = true
                    break
                  }
                  if (r.done) break
                  push(r.value.text ?? '')
                  collect(r.value)
                }
                if (hold !== null) emit(trimOverlap(written, hold))
                if (cut && (out || partial)) write(CONTINUE_MARK)
                else if (sources.size) {
                  const list = [...sources.values()].slice(0, 6).map((s) => `- [${s.title.replace(/[[\]]/g, '')}](${s.uri})`)
                  write(`\n\n**Sources**\n${list.join('\n')}`)
                }
              } catch (err) {
                console.error('Maily stream error', err)
                write(CONTINUE_MARK)
              }
              try {
                controller.close()
              } catch {
                /* already closed */
              }
            },
          }),
          { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } },
        )
      },
    },
  },
})
