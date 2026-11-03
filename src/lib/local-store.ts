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

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('modules', { keyPath: 'id' })
      db.createObjectStore('blocks', { keyPath: 'id' })
      db.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return opening
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    tx.oncomplete = () => resolve((req ? req.result : undefined) as T)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
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
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['modules', 'blocks', 'meta'], 'readwrite')
      for (const n of ['modules', 'blocks', 'meta']) tx.objectStore(n).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* nothing to wipe */
  }
}
