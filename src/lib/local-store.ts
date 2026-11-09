import type { CustomBlock } from '@/lib/custom-blocks'
import type { ModuleRecord } from '@/lib/types'

// Local copy of the account's data (IndexedDB), so the app keeps working
// without a connection. Browser only: every function resolves harmlessly on the
// server. `base` is the server's updatedAt this copy started from (null = never
// synced), `dirty` = changes not pushed yet, `deleted` = removal waiting to be pushed.

export interface LocalModule extends ModuleRecord {
  base: string | null
  dirty: boolean
  deleted?: boolean
}
export interface LocalBlock extends CustomBlock {
  pending?: boolean
}

const DB = 'nsp-local'
let opening: Promise<IDBDatabase> | null = null

export const hasStore = () => typeof indexedDB !== 'undefined'

// Safari (iPhone, iPad, Mac) sometimes never answers an IndexedDB request (open
// after the app comes back from the background, storage process restarted…).
// Nothing may wait for it forever: past LIMIT the call fails, and the callers
// already fall back to the server (or to nothing, offline).
const LIMIT = 3000
// After a request went unanswered, fail at once for a while instead of waiting again.
let stuckUntil = 0
const limit = <T,>(p: Promise<T>, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`IndexedDB ${what}: no answer`)), LIMIT))])

function open(): Promise<IDBDatabase> {
  if (!opening && Date.now() < stuckUntil) return Promise.reject(new Error('IndexedDB unavailable for now'))
  opening ??= limit(
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore('modules', { keyPath: 'id' })
        db.createObjectStore('blocks', { keyPath: 'id' })
        db.createObjectStore('meta')
      }
      req.onsuccess = () => {
        const db = req.result
        // Closed by the browser (Safari: "connection lost"): open again next time.
        db.onclose = () => void (opening = null)
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        resolve(db)
      }
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IndexedDB blocked'))
    }),
    'open',
  ).catch((e) => {
    opening = null // try again later
    stuckUntil = Date.now() + 30_000
    throw e
  })
  return opening
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const db = await open()
  return limit(
    new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction
      try {
        tx = db.transaction(store, mode)
      } catch (e) {
        // Dead connection (InvalidStateError): forget it so the next call reopens.
        opening = null
        return reject(e)
      }
      const req = fn(tx.objectStore(store))
      tx.oncomplete = () => resolve((req ? req.result : undefined) as T)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    }),
    store,
  )
}

export const allModules = () => run<LocalModule[]>('modules', 'readonly', (s) => s.getAll())
export const getLocalModule = (id: string) => run<LocalModule | undefined>('modules', 'readonly', (s) => s.get(id))
export const putModule = (m: LocalModule) => run<void>('modules', 'readwrite', (s) => void s.put(m))
export const dropModule = (id: string) => run<void>('modules', 'readwrite', (s) => void s.delete(id))
export const allBlocks = () => run<LocalBlock[]>('blocks', 'readonly', (s) => s.getAll())
export const putBlock = (b: LocalBlock) => run<void>('blocks', 'readwrite', (s) => void s.put(b))
export const dropBlock = (id: string) => run<void>('blocks', 'readwrite', (s) => void s.delete(id))
export const getMeta = <T>(k: string) => run<T | undefined>('meta', 'readonly', (s) => s.get(k))
export const setMeta = (k: string, v: unknown) => run<void>('meta', 'readwrite', (s) => void s.put(v, k))

// Signing out (or another account signing in) must not leave anyone's data behind.
export async function wipeLocal(): Promise<void> {
  if (!hasStore()) return
  try {
    const db = await open()
    await limit(
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['modules', 'blocks', 'meta'], 'readwrite')
        for (const n of ['modules', 'blocks', 'meta']) tx.objectStore(n).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
      'wipe',
    )
  } catch {
    /* nothing to wipe */
  }
}
