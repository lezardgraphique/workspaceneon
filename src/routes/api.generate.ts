import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { sessionUser, unauthorized } from '@/server/auth.server'
import { sanitizeHtml, stripTags } from '@/lib/sanitize'
import { MAILY_PERSONA, generateResilient, stripFences } from '@/lib/gemini.server'
import { BRAND_FIELDS, brandNote, hasBrand, parseBrand } from '@/lib/brand'
import { parseLenient } from '@/lib/json-repair'

// Rewrites the text of a single block, or drafts the « Ma marque » profile from
// a sample. Whole-module generation goes through the Maily chat (/api/maily).
const Body = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rewrite'),
    text: z.string().min(1).max(8000),
    instruction: z.string().min(1).max(1000),
    html: z.boolean(),
    // « Ma marque » (brand.ts), applied to every rewrite.
    brand: z.string().max(4_000).optional(),
  }),
  z.object({
    kind: z.literal('brand'),
    // E-mails, texts or a module's visible text written in the brand's voice.
    sample: z.string().min(40).max(30_000),
    // The profile already set: the draft completes it instead of starting over.
    current: z.string().max(4_000).optional(),
  }),
])

const failure = () =>
  Response.json({ error: 'Maily n\'a pas pu générer de réponse (service d’IA surchargé). Réessaie dans un instant.' }, { status: 503, headers: { 'Retry-After': '3' } })

export const Route = createFileRoute('/api/generate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await sessionUser())) return unauthorized()
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'Requête invalide' }, { status: 400 })
        const data = parsed.data

        if (data.kind === 'brand') {
          const current = parseBrand(data.current ?? '')
          const keys = BRAND_FIELDS.map((f) => `"${f.key}" (${f.label}, ${f.max} caractères au plus)`).join(', ')
          try {
            const res = await generateResilient({
              contents: `Voici des textes écrits par une marque (e-mails, newsletters, pages). Déduis-en son identité de marque pour écrire de futurs e-mails dans le même style.

Réponds uniquement avec un objet JSON aux clés ${keys}. En français, concret et court : des consignes directement utilisables (ton, tutoiement ou vouvoiement, longueur des phrases, mots récurrents, orthographes particulières, mentions qui reviennent, couleurs hexadécimales vues dans le code, polices). Laisse une clé vide ("") si les textes ne disent rien dessus : n'invente pas.${hasBrand(current) ? `\n\nProfil déjà réglé par l'utilisateur, à garder et compléter (ne remplace pas ce qu'il a écrit sans raison) :\n${JSON.stringify(current)}` : ''}

Textes :
${data.sample}`,
              config: { systemInstruction: MAILY_PERSONA, responseMimeType: 'application/json' },
            })
            const json = parseLenient(stripFences(res.text ?? ''))
            const brand = parseBrand(json?.value ?? null)
            if (!hasBrand(brand)) return Response.json({ error: 'Maily n’a rien pu déduire de ce texte : colle un e-mail plus long ou plusieurs textes.' }, { status: 422 })
            return Response.json({ brand })
          } catch (err) {
            console.error('Brand error', err)
            return failure()
          }
        }

        try {
          // Another model takes over when the main one is overloaded.
          const res = await generateResilient({
            contents: `Consigne : ${data.instruction}

Texte d'origine :
${data.text}

Renvoie uniquement le nouveau texte${data.html ? ' (HTML inline autorisé : strong, em, br, a ; conserve les variables HuBL {{ ... }})' : ' en texte brut, sans guillemets'}.`,
            config: { systemInstruction: MAILY_PERSONA + brandNote(parseBrand(data.brand ?? '')) },
          })
          const text = stripFences(res.text ?? '')
          // The reply ends up in a block: keep only what that block may hold.
          return Response.json({ text: data.html ? sanitizeHtml(text) : stripTags(text) })
        } catch (err) {
          console.error('Generate error', err)
          return failure()
        }
      },
    },
  },
})
