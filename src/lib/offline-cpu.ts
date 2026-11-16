// Third offline Maily engine: llama.cpp compiled to WebAssembly (wllama), run
// on the processor in a worker. No Prompt API and no WebGPU needed, so it also
// works in Safari (iPhone/iPad/Mac), Firefox and Chromium without a usable GPU.
//
// Imported dynamically by offline-ai.ts only: the WebAssembly runtimes (~9 MB,
// ~16 MB for the Safari build) are fetched on "Préparer" and kept in the
// `wllama/runtime` cache (never deleted by sw.js), the model in the browser's
// private file system (OPFS), so both stay available without a connection.

import { Wllama } from '@wllama/wllama'
import type { ChatCompletionChunk } from '@wllama/wllama'
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url'
import compatWasmUrl from '@wllama/wllama-compat/wasm/wllama.wasm?url'
import compatWorker from '@wllama/wllama-compat/wasm/wllama.js?raw'

export interface CpuModel {
  id: string
  label: string
  url: string
  // Shown before the download
  size: string
  // Approximate size in bytes, for the progress bar of the resumable download.
  bytes: number
  context: number
}

export const CPU_MODELS: CpuModel[] = [
  {
    id: 'gemma-3-1b-it-Q4_K_M',
    label: 'Gemma 3 1B',
    url: 'https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf',
    size: 'environ 800 Mo',
    bytes: 806_000_000,
    context: 8192,
  },
  {
    id: 'gemma-3-270m-it-Q8_0',
    label: 'Gemma 3 270M',
    url: 'https://huggingface.co/ggml-org/gemma-3-270m-it-GGUF/resolve/main/gemma-3-270m-it-Q8_0.gguf',
    size: 'environ 300 Mo',
    bytes: 292_000_000,
    context: 8192,
  },
]

export const RUNTIME_CACHE = 'wllama/runtime'

// Context window used when loading (shorter on phones and tablets: memory).
let contextLimit = 8192
export const setContextLimit = (n: number) => {
  contextLimit = n
}

// Same rule as wllama: browsers without JSPI or 64-bit memory (Safari) need the
// compat build; Firefox runs the default one on the processor.
function needsCompat(): boolean {
  if (/Firefox\//.test(navigator.userAgent)) return false
  const jspi = !!(WebAssembly as unknown as { Suspending?: unknown }).Suspending
  let mem64 = false
  try {
    new WebAssembly.Memory({ address: 'i64', initial: BigInt(1) } as unknown as WebAssembly.MemoryDescriptor)
    mem64 = true
  } catch {
    /* 32-bit memory only */
  }
  return !jspi || !mem64
}

const runtimeUrl = () => new URL(needsCompat() ? compatWasmUrl : wasmUrl, location.href).href

// The runtime kept as a blob URL from our own cache: works offline whether or
// not the service worker controls the model's worker.
async function runtimeBlobUrl(download: boolean): Promise<string | null> {
  const url = runtimeUrl()
  const cache = await caches.open(RUNTIME_CACHE)
  let res = await cache.match(url)
  if (!res && download) {
    const net = await fetch(url)
    if (!net.ok) throw new Error('Moteur local introuvable.')
    await cache.put(url, net.clone())
    // Older runtimes (previous versions of the app) are freed.
    for (const req of await cache.keys()) if (req.url !== url) await cache.delete(req)
    res = net
  }
  if (!res) return null
  const blob = await res.blob()
  return URL.createObjectURL(new Blob([blob], { type: 'application/wasm' }))
}

let manager: Wllama | null = null
const files = () => (manager ??= new Wllama({ default: wasmUrl }, { allowOffline: true, suppressNativeLog: true, logger: quietLogger }))

const quietLogger = { debug: () => {}, log: () => {}, warn: () => {}, error: console.error }

/** The model files and the runtime are on the device. */
export async function cpuReady(id: string): Promise<boolean> {
  const model = CPU_MODELS.find((m) => m.id === id)
  if (!model) return false
  try {
    const cache = await caches.open(RUNTIME_CACHE)
    if (!(await cache.match(runtimeUrl()))) {
      // Online after an app update: fetch the new runtime quietly.
      if (navigator.onLine === false) return false
      const blob = await runtimeBlobUrl(true)
      if (blob) URL.revokeObjectURL(blob)
    }
    const models = await files().modelManager.getModels()
    return models.some((m) => m.url === model.url)
  } catch {
    return false
  }
}

/** The prepared model file, to send a copy to the account (null when absent). */
export async function cpuModelFile(id: string): Promise<Blob | null> {
  const model = CPU_MODELS.find((m) => m.id === id)
  if (!model) return null
  const found = (await files().modelManager.getModels()).find((m) => m.url === model.url)
  const [blob] = found ? await found.open() : []
  return blob ?? null
}

/**
 * Writes a model received from the account (shared-model.ts) where wllama keeps
 * the ones it downloads itself, so the rest (cpuReady, loadCpu) is unchanged.
 */
export async function importCpuModel(id: string, size: number, stream: ReadableStream<Uint8Array>): Promise<void> {
  const model = CPU_MODELS.find((m) => m.id === id)
  if (!model) throw new Error('Modèle inconnu')
  const cache = files().modelManager.cacheManager
  const name = await cache.getNameFromURL(model.url)
  // Metadata last: an interrupted copy stays invalid and is fetched again.
  await cache.write(name, stream, { etag: '', originalSize: size, originalURL: model.url })
  if ((await cache.getSize(name)) !== size) {
    await cache.delete(name).catch(() => {})
    throw new Error('Copie du modèle incomplète')
  }
}

// ---- Resumable download -------------------------------------------------------
// A phone often loses the download of a 300 MB file: the screen locks, the
// network changes, the browser freezes or reloads the tab. The file is fetched
// in 8 MiB parts (HTTP Range) kept in the Cache API, each one retried and the
// whole resumed where it stopped, even after a reload; the parts are then
// written where wllama keeps its models (same as a model from the account).

const PARTS_CACHE = 'wllama/parts'
const PART = 8 * 1024 * 1024
// (A query, not a #fragment: the Cache API ignores fragments, every part would overwrite the last.)
const partKey = (url: string, i: number) => `${url}?neon-part=${i}`

const waitUntilUsable = () =>
  new Promise<void>((resolve) => {
    const ok = () => navigator.onLine !== false && document.visibilityState !== 'hidden'
    if (ok()) return resolve()
    const check = () => {
      if (!ok()) return
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
      resolve()
    }
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
  })

/** One part, retried (network lost, screen locked…). null = past the end of the file. */
async function fetchPart(url: string, start: number): Promise<Blob | 'no-range' | null> {
  let last: unknown = null
  for (let attempt = 0; attempt < 40; attempt++) {
    await waitUntilUsable()
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + PART - 1}` }, cache: 'no-store' })
      if (res.status === 416) return null
      if (res.status === 200) return start === 0 ? 'no-range' : Promise.reject(new Error('no-range'))
      if (res.status !== 206) throw new Error(`HTTP ${res.status}`)
      return await res.blob()
    } catch (e) {
      last = e
      if (String((e as Error)?.message) === 'no-range') throw e
      // The very first part refused (parts not allowed here): one plain download instead.
      if (start === 0 && attempt >= 2) return 'no-range'
      await new Promise((r) => setTimeout(r, Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4))))
    }
  }
  throw last ?? new Error('Téléchargement interrompu.')
}

/**
 * Downloads `model` resumably into wllama's store. false when the server
 * doesn't answer ranges (the caller then downloads it in one go).
 */
export async function resumableDownload(model: CpuModel, onProgress: (p: number | null) => void): Promise<boolean> {
  const parts = await caches.open(PARTS_CACHE)
  const lock = await screenLock()
  try {
    // Parts already there (an earlier attempt).
    let i = 0
    let offset = 0
    let ended = false
    for (;;) {
      const r = await parts.match(partKey(model.url, i))
      if (!r) break
      const size = Number(r.headers.get('X-Size')) || (await r.clone().blob()).size
      offset += size
      i++
      if (size < PART) {
        ended = true
        break
      }
    }
    while (!ended) {
      onProgress(Math.min(0.99, offset / model.bytes))
      const blob = await fetchPart(model.url, offset)
      if (blob === 'no-range') return false
      if (!blob || blob.size === 0) break
      await parts.put(partKey(model.url, i), new Response(blob, { headers: { 'X-Size': String(blob.size) } }))
      offset += blob.size
      i++
      if (blob.size < PART) ended = true
    }
    const count = i
    if (!count) throw new Error('Téléchargement vide.')
    onProgress(0.995)
    // Parts → the model file, then the parts are freed.
    let k = 0
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (k >= count) return controller.close()
        const r = await parts.match(partKey(model.url, k))
        if (!r) return controller.error(new Error('Partie manquante.'))
        controller.enqueue(new Uint8Array(await r.arrayBuffer()))
        k++
      },
    })
    const cache = files().modelManager.cacheManager
    const name = await cache.getNameFromURL(model.url)
    await cache.write(name, stream, { etag: '', originalSize: offset, originalURL: model.url })
    if ((await cache.getSize(name)) !== offset) {
      await cache.delete(name).catch(() => {})
      throw new Error('Modèle local incomplet.')
    }
    for (let j = 0; j < count; j++) await parts.delete(partKey(model.url, j))
    onProgress(1)
    return true
  } finally {
    await lock?.release().catch(() => {})
  }
}

// Keeps the screen on while the model downloads (released after, refused quietly).
type Lock = { release: () => Promise<void> }
async function screenLock(): Promise<Lock | null> {
  const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Lock> } }).wakeLock
  if (!wl) return null
  let lock: Lock | null = await wl.request('screen').catch(() => null)
  // The lock goes when the page is hidden: taken again when it comes back.
  const again = async () => {
    if (document.visibilityState === 'visible') lock = await wl.request('screen').catch(() => lock)
  }
  document.addEventListener('visibilitychange', again)
  return {
    release: async () => {
      document.removeEventListener('visibilitychange', again)
      await lock?.release().catch(() => {})
    },
  }
}

/** Parts of an unfinished download (shown as « reprise » and freed by removeCpu). */
export async function partialDownload(id: string): Promise<number> {
  const model = CPU_MODELS.find((m) => m.id === id)
  if (!model || typeof caches === 'undefined') return 0
  const parts = await caches.open(PARTS_CACHE)
  let n = 0
  while (await parts.match(partKey(model.url, n))) n++
  return Math.min(0.99, (n * PART) / model.bytes)
}

let loaded: { model: CpuModel; wllama: Wllama; blob: string } | null = null
let loading: Promise<{ model: CpuModel; wllama: Wllama; blob: string }> | null = null

/** Loads (downloading once when `download`) the first model of `models` that works. */
export async function loadCpu(models: CpuModel[], download: boolean, onProgress?: (p: number | null, model: CpuModel) => void): Promise<CpuModel> {
  if (loaded && models.some((m) => m.id === loaded!.model.id)) return loaded.model
  await releaseCpu()
  loading ??= (async () => {
    let last: unknown = null
    for (const model of models) {
      let blob: string | null = null
      try {
        onProgress?.(null, model)
        blob = await runtimeBlobUrl(download)
        if (!blob) throw new Error('Moteur local absent : prépare Maily hors ligne en ligne.')
        const wllama = new Wllama({ default: blob }, { allowOffline: true, suppressNativeLog: true, logger: quietLogger })
        wllama.setCompat({ wasm: blob, worker: { code: compatWorker } })
        const cached = (await wllama.modelManager.getModels()).find((m) => m.url === model.url)
        if (!cached && !download) throw new Error('Modèle local absent.')
        let source = cached
        if (!source) {
          // Resumable download first (phones: screen locked, network lost, tab reloaded).
          const done = await resumableDownload(model, (p) => onProgress?.(p, model)).catch((e) => {
            if (/quota|storage|space/i.test(String((e as Error)?.message ?? e))) throw e
            return false
          })
          source = done
            ? (await wllama.modelManager.getModels()).find((m) => m.url === model.url)
            : await wllama.modelManager.downloadModel(model.url, { progressCallback: ({ loaded: l, total }) => onProgress?.(total ? l / total : null, model) })
          if (!source) throw new Error('Modèle local incomplet.')
        }
        // GPU off: this engine is the one for devices where WebGPU is missing or failed.
        await wllama.loadModel(source, { n_ctx: Math.min(model.context, contextLimit), n_gpu_layers: 0 })
        loaded = { model, wllama, blob }
        return loaded
      } catch (err) {
        last = err
        if (blob) URL.revokeObjectURL(blob)
      }
    }
    throw last ?? new Error('Aucun modèle local compatible.')
  })().finally(() => {
    loading = null
  })
  return (await loading).model
}

/** Frees the memory (the files stay on the device). */
export async function releaseCpu(): Promise<void> {
  const l = loaded
  loaded = null
  if (!l) return
  await l.wllama.exit().catch(() => {})
  URL.revokeObjectURL(l.blob)
}

/** Deletes the model files and the runtime. */
export async function removeCpu(): Promise<void> {
  await releaseCpu()
  const models = await files().modelManager.getModels({ includeInvalid: true }).catch(() => [])
  await Promise.all(models.filter((m) => CPU_MODELS.some((c) => c.url === m.url)).map((m) => m.remove().catch(() => {})))
  await caches.delete(RUNTIME_CACHE).catch(() => false)
  await caches.delete(PARTS_CACHE).catch(() => false)
}

export async function* cpuStream(
  id: string,
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  maxTokens: number,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const model = CPU_MODELS.find((m) => m.id === id) ?? CPU_MODELS[0]
  await loadCpu([model], false)
  const l = loaded!
  const chunks = (await l.wllama.createChatCompletion({
    messages: [{ role: 'system', content: system }, ...messages],
    stream: true,
    temperature: 0.4,
    max_tokens: maxTokens,
    abortSignal: signal,
  })) as AsyncIterable<ChatCompletionChunk>
  for await (const c of chunks) {
    const t = c.choices[0]?.delta?.content
    if (t) yield t
  }
  if (signal.aborted) throw new DOMException('Génération arrêtée', 'AbortError')
}
