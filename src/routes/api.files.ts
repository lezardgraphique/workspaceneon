import { createFileRoute } from '@tanstack/react-router'
import { getStore } from '@netlify/blobs'

import { FILE_TYPES, MAX_FILE_BYTES, PAGE_SIZE, QUOTA_BYTES, extOf, keyTime } from '@/lib/files'
import type { FileList, StoredFile } from '@/lib/files'
import { matchesType, readHead } from '@/server/upload-check'
import { sessionUser, unauthorized, legacyOwner } from '@/server/auth.server'
import { ownerTag, readUsage, tagOf, writeUsage } from '@/server/file-owner'

const files = () => getStore('files')

export const Route = createFileRoute('/api/files')({
  server: {
    handlers: {
      // ?offset=0&limit=24 — newest first; metadata is only read for the page.
      GET: async ({ request }) => {
        const user = await sessionUser()
        if (!user) return unauthorized()
        const url = new URL(request.url)
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
        const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || PAGE_SIZE))
        // Only this account's files: its own tag, plus the untagged files of the single-user era for their owner.
        const tag = await ownerTag(user.id)
        const isLegacyOwner = (await legacyOwner(user)) === user.id
        const { blobs } = await files().list(isLegacyOwner ? undefined : { prefix: `${tag}_` })
        const keys = blobs
          .map((b) => b.key)
          .filter((k) => (tagOf(k) ? tagOf(k) === tag : isLegacyOwner))
          .sort((a, b) => (a.split('_').pop()! < b.split('_').pop()! ? 1 : -1))
        const page = await Promise.all(
          keys.slice(offset, offset + limit).map(async (key): Promise<StoredFile | null> => {
            const m = await files().getMetadata(key).catch(() => null)
            if (!m) return null
            const md = m.metadata as { name?: string; type?: string; size?: number }
            return {
              key,
              name: md.name ?? key,
              type: md.type ?? 'application/octet-stream',
              size: md.size ?? 0,
              uploadedAt: keyTime(key).toISOString(),
              url: `${url.origin}/api/files/${key}`,
            }
          }),
        )
        const body: FileList = {
          files: page.filter((f): f is StoredFile => !!f),
          total: keys.length,
          usage: { bytes: await readUsage(user), quota: QUOTA_BYTES },
        }
        return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
      },

      POST: async ({ request }) => {
        const user = await sessionUser()
        if (!user) return unauthorized()
        // Refuse oversized bodies before reading them into memory.
        if (Number(request.headers.get('content-length') ?? 0) > MAX_FILE_BYTES + 64 * 1024) {
          return Response.json({ error: 'Fichier trop lourd (10 Mo maximum)' }, { status: 413 })
        }
        const form = await request.formData().catch(() => null)
        const file = form?.get('file')
        if (!(file instanceof File)) return Response.json({ error: 'Aucun fichier reçu' }, { status: 400 })
        const ext = extOf(file.name)
        const type = FILE_TYPES[ext]
        if (!type) return Response.json({ error: `Format .${ext || '?'} non pris en charge` }, { status: 415 })
        if (file.size > MAX_FILE_BYTES) return Response.json({ error: 'Fichier trop lourd (10 Mo maximum)' }, { status: 413 })
        if (!matchesType(await readHead(file), type)) return Response.json({ error: `Le contenu ne correspond pas au format .${ext}` }, { status: 415 })
        const used = await readUsage(user)
        if (used + file.size > QUOTA_BYTES) return Response.json({ error: 'Espace de stockage plein (200 Mo) : supprime des fichiers' }, { status: 507 })

        const key = `${await ownerTag(user.id)}_${Date.now().toString(36).padStart(9, '0')}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}.${ext}`
        const name = file.name.replace(/[^\w.\- ()éèêàùçôîï]/gi, '_').slice(0, 120)
        await files().set(key, await file.arrayBuffer(), { metadata: { name, type, size: file.size } })
        await writeUsage(user, used + file.size)
        return Response.json({ key, name, type, size: file.size, url: `${new URL(request.url).origin}/api/files/${key}` })
      },
    },
  },
})
