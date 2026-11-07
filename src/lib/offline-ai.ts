export type OfflineAiStatus = 'idle' | 'loading' | 'ready' | 'error'

interface EngineLike {
  chat?: {
    completions?: {
      create: (params: { messages: Array<{ role: string; content: string }>; temperature?: number; max_tokens?: number }) => Promise<any>
    }
  }
}

let engine: EngineLike | null = null
let status: OfflineAiStatus = 'idle'
let lastError: string | null = null

function isWebGpuSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  const hasWebGPU = 'gpu' in navigator
  return hasWebGPU || !!(globalThis as typeof globalThis & { crossOriginIsolated?: boolean }).crossOriginIsolated
}

async function loadWebLLM(): Promise<EngineLike | null> {
  if (engine) return engine
  if (!isWebGpuSupported()) {
    lastError = 'WebGPU non disponible sur cet appareil / navigateur.'
    status = 'error'
    return null
  }

  status = 'loading'
  try {
    const mod = await (new Function('return import("@mlc-ai/web-llm")')() as Promise<any>)
    const { CreateMLCEngine } = mod
    if (!CreateMLCEngine) throw new Error('CreateMLCEngine unavailable')

    engine = await CreateMLCEngine('Llama-3.2-1B-Instruct-q4f32_1-MLC', {
      initProgressCallback: (progress: { text?: string; progress?: number }) => {
        if (progress?.progress === 1) status = 'ready'
        else if (status !== 'error') status = 'loading'
      },
    })
    status = 'ready'
    lastError = null
    return engine
  } catch (error) {
    status = 'error'
    lastError = error instanceof Error ? error.message : 'Impossible de charger le modèle local.'
    return null
  }
}

export async function getOfflineAiStatus(): Promise<{ status: OfflineAiStatus; message: string | null }> {
  if (status === 'loading' || status === 'ready') return { status, message: lastError }
  if (status === 'error') return { status: 'error', message: lastError }
  return { status: 'idle', message: null }
}

export async function generateOfflineText(prompt: string): Promise<string | null> {
  if (!prompt.trim()) return null
  const engineRef = await loadWebLLM()
  if (!engineRef) return null

  try {
    const completion = await engineRef.chat?.completions?.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 500,
    })

    const text = completion?.choices?.[0]?.message?.content ?? completion?.text ?? null
    if (!text || typeof text !== 'string') return null
    return text.trim() || null
  } catch (error) {
    status = 'error'
    lastError = error instanceof Error ? error.message : 'Réponse locale interrompue.'
    return null
  }
}

export function offlineAiEnabled(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window && ('gpu' in navigator || 'webkitGetUserMedia' in navigator)
}
