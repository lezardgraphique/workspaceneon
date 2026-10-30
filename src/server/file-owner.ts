import { getStore } from '@netlify/blobs'

import { legacyOwner } from '@/server/auth.server'
import type { SessionUser } from '@/server/auth.server'

// File keys start with a tag derived from the owner's id:
//   <owner tag>_<time base 36>-<random>.<ext>
// so a listing can be limited to one account by prefix, and a delete can be
// checked from the key alone. Keys without a tag are from the single-user era
// and belong to the legacy owner (see legacyOwner).

export const FILE_KEY = /^(?:[0-9a-f]{16}_)?[0-9a-z]{9}-\w{12}\.[a-z0-9]+$/

export async function ownerTag(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`neon-files:${userId}`))
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export const tagOf = (key: string): string | null => (key.includes('_') ? key.split('_')[0] : null)

export async function ownsFile(key: string, user: SessionUser): Promise<boolean> {
  const tag = tagOf(key)
  if (tag) return tag === (await ownerTag(user.id))
  return (await legacyOwner(user)) === user.id
}

// Running total of an account's files, so quota checks never read every file.
export async function usageKey(user: SessionUser): Promise<string> {
  return (await legacyOwner(user)) === user.id ? 'usage' : `usage-${await ownerTag(user.id)}`
}

export async function readUsage(user: SessionUser): Promise<number> {
  const v = (await getStore('files-meta')
    .get(await usageKey(user), { type: 'json' })
    .catch(() => null)) as { bytes: number } | null
  return v?.bytes ?? 0
}

export async function writeUsage(user: SessionUser, bytes: number): Promise<void> {
  await getStore('files-meta').setJSON(await usageKey(user), { bytes: Math.max(0, bytes) })
}
