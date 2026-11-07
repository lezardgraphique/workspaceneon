export type OfflineAiStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface OfflineAiState {
  status: OfflineAiStatus
  progress: number | null
  message: string | null
}

interface ChatEngine {
  chat: {
    completions: {
      create: (params: {
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
        temperature?: number
        max_tokens?: number
      }) => Promise<{ choices?: Array<{ message?: { content?: string } }> }>
    }
  }
}

interface WebLLMModule {
  CreateMLCEngine: (
    model: string,
    options: {
      appConfig: { useIndexedDBCache: boolean }
      initProgressCallback?: (progress: { text?: string; progress?: number }) => void
    },
  ) => Promise<ChatEngine>
}

// A compact model suitable for first experiments. Its weights are downloaded on
// first preparation and retained by WebLLM in IndexedDB for later offline use.
export const OFFLINE_AI_MODEL = 'Llama-3.2-1B-Instruct-q4f32_1-MLC'

let engine: ChatEngine | null = null
let loading: Promise<ChatEngine> | null = null
let state: OfflineAiState = { status: 'idle', progress: null, message: null }
const listeners = new Set<(value: OfflineAiState) => void>()

function update(next: Partial<OfflineAiState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener(state)
}

export function subscribeOfflineAi(listener: (value: OfflineAiState) => void) {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

export function getOfflineAiState(): OfflineAiState {
  return state
}

export function supportsOfflineAi(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && 'indexedDB' in globalThis
}

/** Download and initialize the local model. Call this while online to prepare for travel. */
export async function prepareOfflineAi(): Promise<boolean> {
  if (engine) return true
  if (loading) {
    try {
      await loading
      return true
    } catch {
      return false
    }
  }
  if (!supportsOfflineAi()) {
    update({ status: 'error', progress: null, message: 'WebGPU ou IndexedDB n’est pas disponible dans ce navigateur.' })
    return false
  }

  update({ status: 'loading', progress: 0, message: 'Préparation du modèle local…' })
  loading = (async () => {
    // Keep this import lazy so the large inference runtime is not part of the
    // initial application bundle. The package is installed as an app dependency.
    const webllm = (await import('@mlc-ai/web-llm')) as unknown as WebLLMModule
    return webllm.CreateMLCEngine(OFFLINE_AI_MODEL, {
      appConfig: { useIndexedDBCache: true },
      initProgressCallback: ({ text, progress }) => {
        update({
          status: progress === 1 ? 'ready' : 'loading',
          progress: typeof progress === 'number' ? Math.max(0, Math.min(1, progress)) : null,
          message: text || (progress === 1 ? 'Modèle local prêt.' : 'Téléchargement du modèle local…'),
        })
      },
    })
  })()

  try {
    engine = await loading
    update({ status: 'ready', progress: 1, message: 'Modèle local prêt.' })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Impossible de charger le modèle local.'
    update({ status: 'error', progress: null, message })
    return false
  } finally {
    loading = null
  }
}

/** Generate a local answer; returns null when unsupported or not prepared. */
export async function generateOfflineText(
  prompt: string,
  options: { system?: string; maxTokens?: number } = {},
): Promise<string | null> {
  if (!prompt.trim() || !(await prepareOfflineAi()) || !engine) return null

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = []
    if (options.system) messages.push({ role: 'system', content: options.system })
    messages.push({ role: 'user', content: prompt })
    const result = await engine.chat.completions.create({
      messages,
      temperature: 0.4,
      max_tokens: options.maxTokens ?? 500,
    })
    const text = result.choices?.[0]?.message?.content?.trim()
    return text || null
  } catch (error) {
    update({ status: 'error', message: error instanceof Error ? error.message : 'La génération locale a échoué.' })
    return null
  }
}
