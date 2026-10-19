import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { MAILY_PERSONA, MODEL, ai, stripFences } from '@/lib/gemini.server'

// Rewrites the text of a single block. Whole-module generation goes through
// the Maily chat (/api/maily).
const Body = z.object({
  kind: z.literal('rewrite'),
  text: z.string().min(1).max(8000),
  instruction: z.string().min(1).max(1000),
  html: z.boolean(),
})

export const Route = createFileRoute('/api/generate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'Requête invalide' }, { status: 400 })
        const data = parsed.data

        try {
          const res = await ai.models.generateContent({
            model: MODEL,
            contents: `Consigne : ${data.instruction}

Texte d'origine :
${data.text}

Renvoie uniquement le nouveau texte${data.html ? ' (HTML inline autorisé : strong, em, br, a ; conserve les variables HuBL {{ ... }})' : ' en texte brut, sans guillemets'}.`,
            config: { systemInstruction: MAILY_PERSONA },
          })
          return Response.json({ text: stripFences(res.text ?? '') })
        } catch (err) {
          console.error('Generate error', err)
          return Response.json({ error: 'Maily n\'a pas pu générer de réponse.' }, { status: 502 })
        }
      },
    },
  },
})
