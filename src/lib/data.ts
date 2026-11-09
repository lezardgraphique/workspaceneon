import { useSyncExternalStore } from 'react'

import type { CustomBlock } from '@/lib/custom-blocks'
import * as L from '@/lib/local-store'
import type { ModuleRecord, ModuleTree, Section } from '@/lib/types'
import { deleteCustomBlock, listCustomBlocks, saveCustomBlock } from '@/server/custom-blocks.functions'
import type { SaveStatus } from '@/server/custom-blocks.functions'
import { createModule, deleteModule, getModule, listModules, saveModule, syncModule } from '@/server/modules.functions'

// Data layer used by the screens. Online it talks to the server and mirrors
// everything into IndexedDB; offline (or on a slow link) it reads and writes
// the local copy, and `syncAll` pushes the changes once the connection is back.
// On the server (SSR) it simply calls the server functions.

const TIMEOUT = 6000
const browser = () => typeof window !== 'undefined' && L.hasStore()
export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false
const now = () => new Date().toISOString()

export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true
  const m = String((e as { message?: string })?.message ?? e)
  return /failed to fetch|network|load failed|timeout|offline/i.test(m)
}
const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT))])
// No local copy to fall back on: wait for the server however slow it is (a
// phone on a mobile network, a server waking up), with a far higher ceiling.
const SLOW = 30000
const withPatience = <T,>(p: Promise<T>, hasFallback: boolean): Promise<T> =>
  hasFallback ? withTimeout(p) : Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), SLOW))])

// ---- sync status (for the header badge) ------------------------------------

export interface DataStatus {
  online: boolean
  pending: number
  syncing: boolean
  lastSync: number | null
  notice: string | null
}
let status: DataStatus = { online: true, pending: 0, syncing: false, lastSync: null, notice: null }
const SERVER_STATUS = status
const listeners = new Set<() => void>()
function setStatus(patch: Partial<DataStatus>) {
  status = { ...status, ...patch }
  listeners.forEach((l) => l())
}
export const useDataStatus = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => status,
    () => SERVER_STATUS,
  )

export const dismissNotice = () => setStatus({ notice: null })
export const showNotice = (notice: string) => setStatus({ notice })
export const markOnline = () => setStatus({ online: !isOffline() })

export async function refreshPending(): Promise<number> {
  if (!browser()) return 0
  try {
    const [m, b] = await Promise.all([L.allModules(), L.allBlocks()])
    const n = m.filter((x) => x.dirty || x.deleted).length + b.filter((x) => x.pending).length
    setStatus({ pending: n, online: !isOffline() })
    return n
  } catch {
    return 0
  }
}

// ---- account binding --------------------------------------------------------

let bound: Promise<void> = Promise.resolve()
// The local copy belongs to one account: another one signing in starts clean.
export function bindUser(id: string | null | undefined) {
  if (!browser() || !id) return
  bound = (async () => {
    try {
      const prev = await L.getMeta<string>('user')
      if (prev && prev !== id) await L.wipeLocal()
      if (prev !== id) await L.setMeta('user', id)
    } catch {
      /* no local store: the app simply stays online-only */
    }
  })()
}
const ready = () => bound

// ---- modules ------------------------------------------------------------------

const visible = (list: L.LocalModule[]) => list.filter((m) => !m.deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
const strip = ({ id, name, tree, createdAt, updatedAt }: L.LocalModule): ModuleRecord => ({ id, name, tree, createdAt, updatedAt })


// Mirrors a server list into the local copy and returns what the screen should
// show: server rows, with local unsynced edits/deletions layered on top.
async function mirrorList(remote: ModuleRecord[], fresh = true): Promise<ModuleRecord[]> {
  const local = await L.allModules().catch(() => [] as L.LocalModule[])
  const byId = new Map(local.map((m) => [m.id, m]))
  for (const r of remote) {
    const cur = byId.get(r.id)
    if (cur?.dirty || cur?.deleted) continue
    // A page may come from the offline cache: never replace newer data with it.
    if (!fresh && cur && cur.updatedAt > r.updatedAt) continue
    await L.putModule({ ...r, base: r.updatedAt, dirty: false }).catch(() => {})
  }
  const ids = new Set(remote.map((r) => r.id))
  // Synced before, clean, and gone from the server: deleted elsewhere (only a
  // list just fetched can say so, not one rendered earlier).
  if (fresh) for (const m of local) if (!ids.has(m.id) && m.base && !m.dirty && !m.deleted) await L.dropModule(m.id).catch(() => {})
  void refreshPending()
  return visible(await L.allModules().catch(() => remote.map((r) => ({ ...r, base: r.updatedAt, dirty: false })))).map(strip)
}

// For pages rendered by the server: remember them locally and return the list
// to show instead when local changes are newer (null = keep the server's).
export async function adoptServerList(remote: ModuleRecord[]): Promise<ModuleRecord[] | null> {
  if (!browser()) return null
  await ready()
  const merged = await mirrorList(remote, false)
  const same = merged.length === remote.length && merged.every((m, i) => m.id === remote[i].id && m.updatedAt === remote[i].updatedAt)
  return same ? null : merged
}

export async function adoptServerModule(rec: ModuleRecord): Promise<ModuleRecord | null> {
  if (!browser()) return null
  await ready()
  const cur = await L.getLocalModule(rec.id).catch(() => undefined)
  if (cur?.dirty && !cur.deleted && cur.updatedAt > rec.updatedAt) return strip(cur)
  if (!cur?.dirty && !(cur && cur.updatedAt > rec.updatedAt)) await L.putModule({ ...rec, base: rec.updatedAt, dirty: false }).catch(() => {})
  return null
}

export async function loadModules(): Promise<ModuleRecord[]> {
  if (!browser()) return listModules()
  await ready()
  if (!isOffline()) {
    try {
      const known = (await L.allModules().catch(() => [])).length > 0
      return await mirrorList(await withPatience(listModules(), known))
    } catch (e) {
      if (!isNetworkError(e)) throw e
    }
  }
  return visible(await L.allModules().catch(() => [])).map(strip)
}

export async function loadModule(id: string): Promise<ModuleRecord | null> {
  if (!browser()) return getModule({ data: { id } })
  await ready()
  const local = await L.getLocalModule(id).catch(() => undefined)
  if (!isOffline()) {
    try {
      const remote = await withPatience(getModule({ data: { id } }), !!local && !local.deleted)
      if (local?.deleted) return null
      if (local?.dirty) return strip(local)
      if (!remote) {
        if (local && local.base === null) return strip(local)
        if (local) await L.dropModule(id).catch(() => {})
        return null
      }
      await L.putModule({ ...remote, base: remote.updatedAt, dirty: false }).catch(() => {})
      return remote
    } catch (e) {
      if (!isNetworkError(e)) throw e
    }
  }
  return local && !local.deleted ? strip(local) : null
}

/**
 * The server's copy when it was changed on another device since this one last
 * saw it, and this device has nothing unsent for the module (null otherwise).
 */
export async function freshModule(id: string, shownAt: string): Promise<ModuleRecord | null> {
  if (!browser() || isOffline()) return null
  await ready()
  try {
    const local = await L.getLocalModule(id).catch(() => undefined)
    if (local?.dirty || local?.deleted) return null
    const remote = await withTimeout(getModule({ data: { id } }))
    if (!remote || remote.updatedAt <= shownAt || (local?.base && remote.updatedAt <= local.base)) return null
    await L.putModule({ ...remote, base: remote.updatedAt, dirty: false }).catch(() => {})
    return remote
  } catch {
    return null
  }
}

// Instant local write first, then a push when the connection allows it.
// The home-screen widget (service worker) reloads the module list: at once after
// a creation or a deletion, at most every 30 s while a module is being saved.
let lastPing = 0
export function pingWidgets(force = false) {
  if (!browser() || (!force && Date.now() - lastPing < 30_000)) return
  lastPing = Date.now()
  try {
    navigator.serviceWorker?.controller?.postMessage('widgets')
  } catch {
    /* no worker (development, private window): nothing to refresh */
  }
}

export async function persistModule(id: string, name: string, tree: ModuleTree): Promise<{ state: 'saved' | 'local' | 'conflict'; copyId?: string }> {
  if (!browser()) {
    await saveModule({ data: { id, name, tree } })
    return { state: 'saved' }
  }
  await ready()
  try {
    const cur = await L.getLocalModule(id)
    const stamp = now()
    await L.putModule({ id, name, tree, createdAt: cur?.createdAt ?? stamp, updatedAt: stamp, base: cur?.base ?? null, dirty: true })
  } catch {
    // No usable local store: behave like before.
    await saveModule({ data: { id, name, tree } })
    return { state: 'saved' }
  }
  void refreshPending()
  if (isOffline()) return { state: 'local' }
  const res = await syncAll()
  pingWidgets()
  const copy = res.conflicts.find((c) => c.id === id)
  if (copy) return { state: 'conflict', copyId: copy.copyId }
  const after = await L.getLocalModule(id).catch(() => undefined)
  return { state: after?.dirty ? 'local' : 'saved' }
}

export async function createLocalFirst(name: string, tree: ModuleTree): Promise<ModuleRecord> {
  if (!browser()) return createModule({ data: { name, tree } })
  await ready()
  if (!isOffline()) {
    try {
      const rec = await withTimeout(createModule({ data: { name, tree } }))
      await L.putModule({ ...rec, base: rec.updatedAt, dirty: false }).catch(() => {})
      pingWidgets(true)
      return rec
    } catch (e) {
      if (!isNetworkError(e)) throw e
    }
  }
  const stamp = now()
  const rec: L.LocalModule = { id: crypto.randomUUID(), name, tree, createdAt: stamp, updatedAt: stamp, base: null, dirty: true }
  await L.putModule(rec)
  void refreshPending()
  return strip(rec)
}

export async function removeModule(id: string): Promise<void> {
  if (!browser()) {
    await deleteModule({ data: { id } })
    return
  }
  await ready()
  const cur = await L.getLocalModule(id).catch(() => undefined)
  if (!isOffline()) {
    try {
      await withTimeout(deleteModule({ data: { id } }))
      await L.dropModule(id).catch(() => {})
      pingWidgets(true)
      return
    } catch (e) {
      if (!isNetworkError(e)) throw e
    }
  }
  if (!cur || cur.base === null) await L.dropModule(id).catch(() => {})
  else await L.putModule({ ...cur, deleted: true, dirty: true })
  void refreshPending()
}

// ---- custom blocks --------------------------------------------------------------

export async function loadBlocks(): Promise<CustomBlock[]> {
  if (!browser()) return listCustomBlocks()
  await ready()
  if (!isOffline()) {
    try {
      const remote = await withTimeout(listCustomBlocks())
      const local = await L.allBlocks().catch(() => [] as L.LocalBlock[])
      const ids = new Set(remote.map((b) => b.id))
      for (const b of local) if (!b.pending && !ids.has(b.id)) await L.dropBlock(b.id).catch(() => {})
      for (const b of remote) await L.putBlock(b).catch(() => {})
      return [...remote, ...local.filter((b) => b.pending)]
    } catch (e) {
      if (!isNetworkError(e)) throw e
    }
  }
  return (await L.allBlocks().catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))
}

export async function queueBlock(name: string, description: string, section: Section): Promise<void> {
  await ready()
  await L.putBlock({ id: crypto.randomUUID(), name, description, section, createdAt: now(), pending: true })
  void refreshPending()
}

// Saves an element in the library: online right away (no duplicate: same content
// is reused, same name is updated), otherwise on this device and sent later.
export async function saveBlock(name: string, description: string, section: Section): Promise<{ status: SaveStatus | 'local'; block?: CustomBlock }> {
  if (browser() && !isOffline()) {
    try {
      const r = await withTimeout(saveCustomBlock({ data: { name, description, section: section as never } }))
      await ready()
      await L.putBlock(r.block).catch(() => {})
      return r
    } catch (e) {
      if (!isNetworkError(e)) throw e
    }
  }
  await queueBlock(name, description, section)
  return { status: 'local' }
}

// Removes a block from the library (a block not sent yet only exists here).
export async function removeBlock(id: string): Promise<void> {
  await ready()
  const local = (await L.allBlocks().catch(() => [] as L.LocalBlock[])).find((b) => b.id === id)
  if (!local?.pending) {
    if (isOffline()) throw new Error('Connexion requise pour supprimer un bloc déjà enregistré.')
    await deleteCustomBlock({ data: { id } })
  }
  await L.dropBlock(id).catch(() => {})
  void refreshPending()
}

// ---- synchronisation --------------------------------------------------------------

export interface SyncResult {
  pushed: number
  conflicts: { id: string; copyId: string; name: string }[]
}
let running: Promise<SyncResult> | null = null
let again = false

export function syncAll(): Promise<SyncResult> {
  if (!browser()) return Promise.resolve({ pushed: 0, conflicts: [] })
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    const total: SyncResult = { pushed: 0, conflicts: [] }
    setStatus({ syncing: true })
    try {
      do {
        again = false
        if (isOffline()) break
        const r = await pass()
        total.pushed += r.pushed
        total.conflicts.push(...r.conflicts)
        if (r.stop) break
      } while (again)
    } finally {
      running = null
      setStatus({
        syncing: false,
        ...(total.pushed ? { lastSync: Date.now() } : {}),
        ...(total.conflicts.length
          ? { notice: `Modifié sur un autre appareil : ta version hors ligne est gardée dans « ${total.conflicts[0].name} ».` }
          : {}),
      })
      await refreshPending()
    }
    return total
  })()
  return running
}

async function pass(): Promise<SyncResult & { stop?: boolean }> {
  await ready()
  const out: SyncResult & { stop?: boolean } = { pushed: 0, conflicts: [] }
  const mods = await L.allModules().catch(() => [] as L.LocalModule[])
  for (const m of mods) {
    if (!m.dirty && !m.deleted) continue
    try {
      if (m.deleted) {
        if (m.base) await deleteModule({ data: { id: m.id } })
        await L.dropModule(m.id)
        out.pushed++
        continue
      }
      const r = await syncModule({ data: { id: m.id, name: m.name, tree: m.tree, base: m.base } })
      const cur = await L.getLocalModule(m.id)
      if (r.status === 'conflict' && r.copy) {
        await L.putModule({ ...r.record, base: r.record.updatedAt, dirty: false })
        await L.putModule({ ...r.copy, base: r.copy.updatedAt, dirty: false })
        out.conflicts.push({ id: m.id, copyId: r.copy.id, name: r.copy.name })
      } else if (cur && cur.updatedAt !== m.updatedAt) {
        // Edited again while the push was running: keep the newer content.
        await L.putModule({ ...cur, base: r.record.updatedAt })
      } else {
        await L.putModule({ ...r.record, base: r.record.updatedAt, dirty: false })
      }
      out.pushed++
    } catch (e) {
      if (isNetworkError(e)) return { ...out, stop: true }
    }
  }
  const blocks = await L.allBlocks().catch(() => [] as L.LocalBlock[])
  for (const b of blocks) {
    if (!b.pending) continue
    try {
      const r = await saveCustomBlock({ data: { name: b.name, description: b.description, section: b.section as never } })
      await L.dropBlock(b.id)
      await L.putBlock(r.block)
      out.pushed++
    } catch (e) {
      if (isNetworkError(e)) return { ...out, stop: true }
    }
  }
  return out
}
