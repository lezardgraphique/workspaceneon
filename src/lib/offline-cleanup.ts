// Maily no longer downloads a model to work offline (src/lib/maily-local.ts
// answers without one). What the old versions stored is freed once per
// device: the model files in the browser (Cache API / IndexedDB, up to ~2 GB)
// and the copy kept on the account for the other devices.

const DONE_KEY = 'nsp-offline-model-removed'
const MODEL_CACHE = /^(webllm|wllama)\//
const MODEL_DB = /webllm|wllama|mlc|tvmjs/i

export async function forgetOfflineModel(): Promise<void> {
  try {
    if (localStorage.getItem(DONE_KEY)) return
  } catch {
    return
  }
  try {
    if ('caches' in window) for (const k of await caches.keys()) if (MODEL_CACHE.test(k)) await caches.delete(k)
    const idb = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }
    for (const db of (await idb.databases?.().catch(() => [])) ?? []) if (db.name && MODEL_DB.test(db.name)) idb.deleteDatabase(db.name)
    for (const k of Object.keys(localStorage)) if (/^nsp-(offline-ai|ai-|maily-model)/.test(k)) localStorage.removeItem(k)
    if (navigator.onLine) await fetch('/modele-local/tout', { method: 'DELETE', credentials: 'same-origin' }).catch(() => null)
    localStorage.setItem(DONE_KEY, '1')
  } catch {
    /* next visit */
  }
}
