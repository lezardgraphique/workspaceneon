import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { eq } from 'drizzle-orm'

import { sessionUser, unauthorized } from '@/server/auth.server'
import { db } from '../../db/index.js'
import { customBlocks, modules } from '../../db/schema.js'
import { MODEL, ai } from '@/lib/gemini.server'
import {
  APP_GUIDE,
  FIELDS_SPEC,
  GUIDE_INTRO,
  MAILY_PERSONA,
  MODULE_REPLY_SPEC,
  RESEARCH_SPEC,
  SCOPE_SPEC,
  codeNote,
  fieldsNote,
  libraryNote,
  requestNote,
  todayFr,
} from '@/lib/maily-prompts'

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
        content: z.string().max(150_000),
        images: z.array(Image).max(4).optional(),
      }),
    )
    .min(1)
    .max(40),
  mode: z.enum(['chat', 'build']).default('chat'),
  code: z.string().max(200_000).optional(),
  moduleName: z.string().max(200).optional(),
  // The attached code was already converted into the editor's module.
  imported: z.boolean().optional(),
  // Why the direct conversion of the attached code fell short.
  issue: z.string().max(500).optional(),
  // Fields of the open module (name, label, type), one per line.
  fields: z.string().max(8_000).optional(),
  // Fields parsed from an attached fields.json (JSON array of name/label/type/default).
  fieldSpecs: z.string().max(20_000).optional(),
})

// Google Search and URL reading keep Maily's answers current; the model decides
// when to use them.
const TOOLS = [{ googleSearch: {} }, { urlContext: {} }]

interface Source {
  uri: string
  title: string
}

// Streams Maily's answer as plain text chunks. When she builds a module the
// answer contains a ```neon block that the editor applies.
export const Route = createFileRoute('/api/maily')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await sessionUser()
        if (!user) return unauthorized()
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'Requête invalide' }, { status: 400 })
        const { messages, mode, code, moduleName, imported, issue, fields, fieldSpecs } = parsed.data

        const context = codeNote(code, moduleName)
        const fieldsContext = fieldsNote(fields, fieldSpecs)
        const notes = requestNote({ mode, imported, issue })
        // What already exists, so Maily reuses it instead of creating a twin.
        const library = await Promise.all([
          db.select({ name: modules.name }).from(modules).where(eq(modules.userId, user.id)).limit(60),
          db.select({ name: customBlocks.name, description: customBlocks.description }).from(customBlocks).where(eq(customBlocks.userId, user.id)).limit(60),
        ])
          .then(([m, b]) => libraryNote(m.map((x) => x.name), b))
          .catch(() => '')
        const today = todayFr()

        const generate = (withTools: boolean) =>
          ai.models.generateContentStream({
            model: MODEL,
            contents: messages.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [
                ...(m.images ?? []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
                { text: m.content || 'Recrée ce module.' },
              ],
            })),
            config: {
              temperature: 0.4,
              ...(withTools ? { tools: TOOLS } : {}),
              systemInstruction: `${MAILY_PERSONA}\nNous sommes le ${today}.\n${GUIDE_INTRO}\n\n${APP_GUIDE}\n\n${RESEARCH_SPEC}\n\n${SCOPE_SPEC}\n\n${MODULE_REPLY_SPEC}\n\n${FIELDS_SPEC}${notes}${library}${context}${fieldsContext}`,
            },
          })

        try {
          // Fall back to a plain answer if the search tools are refused.
          const stream = await generate(true).catch((err: unknown) => {
            console.error('Maily tools unavailable', err)
            return generate(false)
          })
          const encoder = new TextEncoder()
          return new Response(
            new ReadableStream({
              async start(controller) {
                const sources = new Map<string, Source>()
                try {
                  for await (const chunk of stream) {
                    if (chunk.text) controller.enqueue(encoder.encode(chunk.text))
                    for (const g of chunk.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
                      if (g.web?.uri) sources.set(g.web.uri, { uri: g.web.uri, title: g.web.title || g.web.domain || 'Source' })
                    }
                  }
                  if (sources.size) {
                    const list = [...sources.values()].slice(0, 6).map((s) => `- [${s.title.replace(/[[\]]/g, '')}](${s.uri})`)
                    controller.enqueue(encoder.encode(`\n\n**Sources**\n${list.join('\n')}`))
                  }
                } catch (err) {
                  console.error('Maily stream error', err)
                  controller.enqueue(encoder.encode('\n\n_Oups, la connexion avec Maily a été interrompue._'))
                }
                controller.close()
              },
            }),
            { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } },
          )
        } catch (err) {
          console.error('Maily error', err)
          return Response.json({ error: 'Maily est indisponible pour le moment.' }, { status: 502 })
        }
      },
    },
  },
})
