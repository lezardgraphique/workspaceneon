import { createFileRoute } from '@tanstack/react-router'
import { getStore } from '@netlify/blobs'

import { sessionUser, unauthorized } from '@/server/auth.server'
import { SHARED_CHUNK, SHARED_MAX_BYTES, SHARED_MIN_BYTES, isSharedModelId, partsOf } from '@/lib/shared-model'
import type { SharedManifest } from '@/lib/shared-model'

// Account copy of the offline Maily model (see src/lib/shared-model.ts):
//   GET    /modele-local/<id>[?size=]   what the account holds (parts received while sending)
//   PUT    /modele-local/<id>/<n>?size= one part (SHARED_CHUNK bytes, X-Sha256)
//   POST   /modele-local/<id>?size=     sending finished: checks every part is there
//   GET    /modele-local/<id>/<n>       one part, once the copy is complete
//   DELETE /modele-local/tout           removes the account's copy
// Every key starts with the account id: nobody reads or fills another account's copy.

const store = () => getStore({ name: 'offline-models', consistency: 'strong' })
const NO_STORE = { 'Cache-Control': 'no-store' }

const root = (uid: string) => `u/${uid}/`
const modelKey = (uid: string, id: string) => `${root(uid)}${id}/`
const manifestKey = (uid: string, id: string) => `${modelKey(uid, id)}manifest`
const pendingKey = (uid: string, id: string) => `${modelKey(uid, id)}pending`
const partsPrefix = (uid: string, id: string, size: number) => `${modelKey(uid, id)}${size}/`

const bad = (error: string, status = 400) => Response.json({ error }, { status, headers: NO_STORE })

function parse(splat: string | undefined): { id: string; part: number | null } | null {
  const m = /^([\w.-]{1,80})(?:\/(\d{1,5}))?$/.exec(splat ?? '')
  if (!m || !isSharedModelId(m[1])) return null
  return { id: m[1], part: m[2] === undefined ? null : Number(m[2]) }
}

function sizeOf(request: Request): number | null {
  const size = Number(new URL(request.url).searchParams.get('size'))
  return Number.isInteger(size) && size >= SHARED_MIN_BYTES && size <= SHARED_MAX_BYTES ? size : null
}

async function readManifest(uid: string, id: string): Promise<SharedManifest | null> {
  return ((await store().get(manifestKey(uid, id), { type: 'json' }).catch(() => null)) as SharedManifest | null) ?? null
}

async function receivedParts(uid: string, id: string, size: number): Promise<number[]> {
  const prefix = partsPrefix(uid, id, size)
  const { blobs } = await store().list({ prefix })
  return blobs.map((b) => Number(b.key.slice(prefix.length))).filter((n) => Number.isInteger(n))
}

async function removePrefix(prefix: string) {
  const { blobs } = await store().list({ prefix })
  for (let i = 0; i < blobs.length; i += 20) await Promise.all(blobs.slice(i, i + 20).map((b) => store().delete(b.key)))
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const Route = createFileRoute('/modele-local/$')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const user = await sessionUser()
        if (!user) return unauthorized()
        const p = parse(params._splat)
        if (!p) return bad('Modèle inconnu', 404)
        const manifest = await readManifest(user.id, p.id)

        if (p.part === null) {
          const size = sizeOf(request)
          if (manifest?.complete && (!size || size === manifest.size)) return Response.json(manifest, { headers: NO_STORE })
          if (!size) return bad('Pas de copie sur le compte', 404)
          const have = await receivedParts(user.id, p.id, size)
          const body: SharedManifest = { id: p.id, size, chunk: SHARED_CHUNK, parts: partsOf(size), complete: false, have }
          return Response.json(body, { headers: NO_STORE })
        }

        if (!manifest?.complete || p.part >= manifest.parts) return bad('Partie introuvable', 404)
        const got = await store().getWithMetadata(`${partsPrefix(user.id, p.id, manifest.size)}${p.part}`, { type: 'arrayBuffer' })
        if (!got) return bad('Partie introuvable', 404)
        return new Response(got.data, {
          headers: {
            ...NO_STORE,
            'Content-Type': 'application/octet-stream',
            'X-Sha256': String((got.metadata as { sha?: string }).sha ?? ''),
            'Content-Security-Policy': "default-src 'none'; sandbox",
          },
        })
      },

      PUT: async ({ params, request }) => {
        const user = await sessionUser()
        if (!user) return unauthorized()
        const p = parse(params._splat)
        const size = sizeOf(request)
        if (!p || p.part === null || !size) return bad('Requête invalide')
        const parts = partsOf(size)
        if (p.part >= parts) return bad('Partie hors du fichier')
        const expected = p.part === parts - 1 ? size - p.part * SHARED_CHUNK : SHARED_CHUNK
        if (Number(request.headers.get('content-length') ?? 0) > SHARED_CHUNK) return bad('Partie trop lourde', 413)

        const manifest = await readManifest(user.id, p.id)
        if (manifest?.complete && manifest.size === size) return Response.json({ ok: true }, { headers: NO_STORE })

        const data = await request.arrayBuffer()
        if (data.byteLength !== expected) return bad('Taille de partie inattendue')
        // A GGUF model starts with its magic number.
        if (p.part === 0 && new TextDecoder().decode(new Uint8Array(data, 0, 4)) !== 'GGUF') return bad('Ce n’est pas un modèle GGUF', 415)
        const sha = await sha256(data)
        if (request.headers.get('x-sha256') !== sha) return bad('Partie abîmée pendant l’envoi')

        // One send in progress per model: parts of an older, different file are freed.
        const pending = (await store().get(pendingKey(user.id, p.id), { type: 'json' }).catch(() => null)) as { size?: number } | null
        if (pending?.size !== size) {
          if (pending?.size) await removePrefix(partsPrefix(user.id, p.id, pending.size))
          await store().setJSON(pendingKey(user.id, p.id), { size })
        }
        await store().set(`${partsPrefix(user.id, p.id, size)}${p.part}`, data, { metadata: { sha } })
        return Response.json({ ok: true }, { headers: NO_STORE })
      },

      POST: async ({ params, request }) => {
        const user = await sessionUser()
        if (!user) return unauthorized()
        const p = parse(params._splat)
        const size = sizeOf(request)
        if (!p || p.part !== null || !size) return bad('Requête invalide')
        const parts = partsOf(size)
        const have = new Set(await receivedParts(user.id, p.id, size))
        for (let n = 0; n < parts; n++) if (!have.has(n)) return bad('Copie incomplète', 409)

        const old = await readManifest(user.id, p.id)
        const manifest: SharedManifest = { id: p.id, size, chunk: SHARED_CHUNK, parts, complete: true }
        await store().setJSON(manifestKey(user.id, p.id), manifest)
        await store().delete(pendingKey(user.id, p.id))
        if (old?.complete && old.size !== size) await removePrefix(partsPrefix(user.id, p.id, old.size))
        // One model per account: the other one (if any) is freed.
        const { blobs } = await store().list({ prefix: root(user.id) })
        const others = blobs.filter((b) => !b.key.startsWith(modelKey(user.id, p.id)))
        for (let i = 0; i < others.length; i += 20) await Promise.all(others.slice(i, i + 20).map((b) => store().delete(b.key)))
        return Response.json(manifest, { headers: NO_STORE })
      },

      DELETE: async ({ params }) => {
        const user = await sessionUser()
        if (!user) return unauthorized()
        if (params._splat !== 'tout') return bad('Requête invalide')
        await removePrefix(root(user.id))
        return Response.json({ ok: true }, { headers: NO_STORE })
      },
    },
  },
})
