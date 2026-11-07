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
  context: number
}

export const CPU_MODELS: CpuModel[] = [
  {
    id: 'gemma-3-1b-it-Q4_K_M',
    label: 'Gemma 3 1B',
    url: 'https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf',
    size: 'environ 800 Mo',
    context: 8192,
  },
  {
    id: 'gemma-3-270m-it-Q8_0',
    label: 'Gemma 3 270M',
    url: 'https://huggingface.co/ggml-org/gemma-3-270m-it-GGUF/resolve/main/gemma-3-270m-it-Q8_0.gguf',
    size: 'environ 300 Mo',
    context: 8192,
  },
]

export const RUNTIME_CACHE = 'wllama/runtime'

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
        const source = cached ?? (await wllama.modelManager.downloadModel(model.url, { progressCallback: ({ loaded: l, total }) => onProgress?.(total ? l / total : null, model) }))
        // GPU off: this engine is the one for devices where WebGPU is missing or failed.
        await wllama.loadModel(source, { n_ctx: model.context, n_gpu_layers: 0 })
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
