// « Supprimer mon compte » (/compte), required by the app stores and the RGPD:
// everything the account owns is erased, then its sign-in. Images inserted in
// e-mails (store `images`) stay online: they appear in e-mails already sent.
import { createServerFn } from '@tanstack/react-start'
import { admin } from '@netlify/identity'
import { getStore } from '@netlify/blobs'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import { apiTokens, customBlocks, legacyClaim, moduleVersions, modules, userSettings } from '../../db/schema.js'
import { legacyOwner, requireUser } from '@/server/auth.server'
import { isSecurityAdmin } from '@/server/firewall.server'
import { ownerTag, tagOf, usageKey } from '@/server/file-owner'

async function deleteBlobs(name: string, keep: (key: string) => boolean, prefix?: string): Promise<number> {
  const store = getStore(name)
  let n = 0
  for await (const page of store.list({ prefix, paginate: true })) {
    for (const b of page.blobs) {
      if (!keep(b.key)) continue
      await store.delete(b.key)
      n++
    }
  }
  return n
}

export const deleteAccount = createServerFn({ method: 'POST' })
  .validator(z.object({ confirm: z.literal('SUPPRIMER') }))
  .handler(async (): Promise<{ signInDeleted: boolean }> => {
    const user = await requireUser()
    // The site's own administrator can't remove the account that guards it.
    if (isSecurityAdmin(user.email)) throw new Error('Ce compte est celui de l’administrateur du site : il ne peut pas être supprimé d’ici.')
    const legacy = (await legacyOwner(user)) === user.id
    const tag = await ownerTag(user.id)

    // Files (store `files`), their running total, and the shared offline model.
    await deleteBlobs('files', (k) => tagOf(k) === tag || (legacy && !tagOf(k)), legacy ? undefined : `${tag}_`)
    await getStore('files-meta').delete(await usageKey(user)).catch(() => {})
    await deleteBlobs('offline-models', () => true, `u/${user.id}/`).catch(() => 0)

    // Every row of the account (versions included: nothing to bring back).
    await db.delete(modules).where(eq(modules.userId, user.id))
    await db.delete(moduleVersions).where(eq(moduleVersions.userId, user.id))
    await db.delete(customBlocks).where(eq(customBlocks.userId, user.id))
    await db.delete(userSettings).where(eq(userSettings.userId, user.id))
    await db.delete(apiTokens).where(eq(apiTokens.userId, user.id))
    await db.delete(legacyClaim).where(eq(legacyClaim.userId, user.id))

    // Last, the sign-in itself (Netlify Identity, operator token of the function).
    let signInDeleted = true
    try {
      await admin.deleteUser(user.id)
    } catch (e) {
      console.error('Identity deleteUser failed', e)
      signInDeleted = false
    }
    return { signInDeleted }
  })
