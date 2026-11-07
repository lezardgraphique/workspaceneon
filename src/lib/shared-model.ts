// Account copy of the offline Maily model (Gemma 3 on the processor, GGUF file).
//
// A browser can't hand its files to another device, so the device that
// downloaded the model sends it once to the account (Netlify Blobs, in parts
// small enough for one request each) and the account's other devices fetch it
// from the app instead of Hugging Face, then use it as soon as the network drops.
//
// Shared by the browser (transfer) and the server route /modele-local/<id>.
// The route sits outside /api/* so the ~270 requests of a transfer don't count
// against the platform's general API limit (it has its own, see rate-limit.ts).

/** Bytes per part: one request each, under the functions' 6 MB payload limit once base64-encoded. */
export const SHARED_CHUNK = 3 * 1024 * 1024
export const SHARED_MIN_BYTES = 50 * 1024 * 1024
export const SHARED_MAX_BYTES = 1536 * 1024 * 1024

/** Models that may be stored on the account (ids of CPU_MODELS in offline-cpu.ts). */
export const SHARED_MODEL_IDS = ['gemma-3-1b-it-Q4_K_M', 'gemma-3-270m-it-Q8_0'] as const
export const isSharedModelId = (id: string) => (SHARED_MODEL_IDS as readonly string[]).includes(id)

export interface SharedManifest {
  id: string
  size: number
  chunk: number
  parts: number
  // Sending finished (every part is there)
  complete: boolean
  // Parts already received, while sending (resume after an interruption)
  have?: number[]
}

export const partsOf = (size: number) => Math.ceil(size / SHARED_CHUNK)

const base = (id: string) => `/modele-local/${encodeURIComponent(id)}`

async function sha256(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** What the account holds for this model (null: nothing, or signed out). */
export async function sharedManifest(id: string, size?: number): Promise<SharedManifest | null> {
  const res = await fetch(`${base(id)}${size ? `?size=${size}` : ''}`, { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) return null
  return (await res.json()) as SharedManifest
}

async function retry<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let last: unknown = null
  for (let i = 0; i < 4; i++) {
    if (signal?.aborted) throw new DOMException('Arrêté', 'AbortError')
    try {
      return await run()
    } catch (e) {
      last = e
      if ((e instanceof DOMException && e.name === 'AbortError') || (e as { fatal?: boolean }).fatal) throw e
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw last
}

/** Sends the model file to the account, skipping the parts already there. */
export async function uploadSharedModel(id: string, file: Blob, onProgress: (p: number) => void, signal?: AbortSignal): Promise<void> {
  const size = file.size
  const parts = partsOf(size)
  const current = await sharedManifest(id, size)
  if (current?.complete && current.size === size) return onProgress(1)
  const have = new Set(current?.size === size ? (current.have ?? []) : [])
  let done = have.size
  onProgress(done / parts)
  for (let n = 0; n < parts; n++) {
    if (have.has(n)) continue
    const body = await file.slice(n * SHARED_CHUNK, Math.min(size, (n + 1) * SHARED_CHUNK)).arrayBuffer()
    const hash = await sha256(body)
    await retry(async () => {
      const res = await fetch(`${base(id)}/${n}?size=${size}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Sha256': hash },
        body,
        signal,
      })
      if (res.status === 429) throw new Error('busy')
      if (!res.ok) throw Object.assign(new Error('Envoi refusé'), { fatal: res.status < 500 })
    }, signal)
    onProgress(++done / parts)
  }
  const res = await fetch(`${base(id)}?size=${size}`, { method: 'POST', credentials: 'same-origin', signal })
  if (!res.ok) throw new Error('Copie incomplète')
}

/** Streams the account copy, part after part, each one checked. */
export function sharedModelStream(m: SharedManifest, onProgress: (p: number) => void, signal?: AbortSignal): ReadableStream<Uint8Array> {
  let n = 0
  // Two parts ahead: the network keeps busy while the previous one is written.
  const ahead = new Map<number, Promise<Uint8Array>>()
  const fetchPart = (k: number) =>
    retry(async () => {
      const res = await fetch(`${base(m.id)}/${k}`, { credentials: 'same-origin', cache: 'no-store', signal })
      if (!res.ok) throw new Error('Partie manquante')
      const data = await res.arrayBuffer()
      const expected = k === m.parts - 1 ? m.size - k * m.chunk : m.chunk
      if (data.byteLength !== expected) throw new Error('Partie tronquée')
      const hash = res.headers.get('X-Sha256')
      if (hash && hash !== (await sha256(data))) throw new Error('Partie abîmée')
      return new Uint8Array(data)
    }, signal)
  const want = (k: number) => {
    if (k < m.parts && !ahead.has(k)) {
      const p = fetchPart(k)
      p.catch(() => {})
      ahead.set(k, p)
    }
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (n >= m.parts) return controller.close()
      want(n)
      want(n + 1)
      want(n + 2)
      const data = await ahead.get(n)!
      ahead.delete(n)
      n++
      onProgress(n / m.parts)
      controller.enqueue(data)
    },
  })
}

/** Removes the account copy ("De tous mes appareils"). */
export async function deleteSharedModel(): Promise<void> {
  await fetch('/modele-local/tout', { method: 'DELETE', credentials: 'same-origin' }).catch(() => null)
}
