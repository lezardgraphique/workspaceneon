import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { APP_GUIDE, MAILY_PERSONA, MODEL, MODULE_REPLY_SPEC, ai } from '@/lib/gemini.server'

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
})

// Streams Maily's answer as plain text chunks. When she builds a module the
// answer contains a ```neon block that the editor applies.
export const Route = createFileRoute('/api/maily')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'Requête invalide' }, { status: 400 })
        const { messages, mode, code, moduleName } = parsed.data

        const context = code
          ? `\n\nModule actuellement dans l'éditeur « ${moduleName ?? 'Sans titre'} » :\n${code.slice(0, 120_000)}`
          : ''
        const modeNote =
          mode === 'build'
            ? `\n\nL'utilisateur est en mode « Modifier le module » : chacun de ses messages est une demande de création ou de modification. Réponds toujours avec le bloc neon complet.`
            : `\n\nL'utilisateur est en mode « Conseil ». S'il te demande de créer, recréer, refaire, reproduire ou modifier le module (ou s'il t'envoie une capture ou du code à recréer), fais-le avec le bloc neon. Sinon réponds sans bloc neon.`

        try {
          const stream = await ai.models.generateContentStream({
            model: MODEL,
            contents: messages.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [
                ...(m.images ?? []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
                { text: m.content || 'Recrée ce module.' },
              ],
            })),
            config: {
              systemInstruction: `${MAILY_PERSONA}\nTu connais parfaitement l'application. Pour toute question sur son fonctionnement ou sur ce que l'utilisateur peut faire, appuie-toi d'abord sur le GUIDE DE L'APPLICATION : explique le chemin dans l'interface avec les noms exacts des boutons et panneaux, et privilégie les fonctions intégrées (Téléverser, Clients, Aperçu, Exporter…) plutôt que des outils externes. Ne parle pas de HubSpot ni d'une plateforme précise sauf si l'utilisateur le fait.\n\n${APP_GUIDE}\n\n${MODULE_REPLY_SPEC}${modeNote}${context}`,
            },
          })
          const encoder = new TextEncoder()
          return new Response(
            new ReadableStream({
              async start(controller) {
                try {
                  for await (const chunk of stream) {
                    if (chunk.text) controller.enqueue(encoder.encode(chunk.text))
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
