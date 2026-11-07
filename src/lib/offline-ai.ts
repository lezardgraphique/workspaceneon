export type OfflineAiStatus = 'idle' | 'loading' | 'ready' | 'error' | 'downloadable'

export interface OfflineAiState {
  status: OfflineAiStatus
  message: string | null
}

type ModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

type ModelSession = {
  prompt: (text: string, options?: { signal?: AbortSignal }) => Promise<string>
  destroy: () => Promise<void>
}

type PromptApi = {
  availability: () => Promise<ModelAvailability>
  create: (options?: {
    initialPrompts?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    monitor?: (monitor: { addEventListener: (type: string, callback: (event: any) => void) => void }) => void
  }) => Promise<ModelSession>
}

declare global {
  interface Window {
    LanguageModel?: PromptApi
  }
}

let session: ModelSession | null = null
let state: OfflineAiState = { status: 'idle', message: null }
const listeners = new Set<(next: OfflineAiState) => void>()

function setState(patch: Partial<OfflineAiState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener(state)
}

export function getOfflineAiState(): OfflineAiState {
  return state
}

export function subscribeOfflineAi(listener: (next: OfflineAiState) => void) {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

export function supportsOfflineAi(): boolean {
  return typeof window !== 'undefined' && !!window.LanguageModel
}

export async function getOfflineAiStatus(): Promise<OfflineAiState> {
  if (!supportsOfflineAi()) {
    const next = { status: 'idle' as const, message: 'Aucune IA locale disponible dans ce navigateur.' }
    setState(next)
    return next
  }

  try {
    const availability = await window.LanguageModel!.availability()
    if (availability === 'downloadable') {
      const next = { status: 'downloadable' as const, message: 'Modèle local disponible pour téléchargement.' }
      setState(next)
      return next
    }
    if (availability === 'downloading') {
      const next = { status: 'loading' as const, message: 'Téléchargement du modèle local…' }
      setState(next)
      return next
    }
    if (availability === 'available') {
      const next = { status: 'ready' as const, message: 'IA locale prête.' }
      setState(next)
      return next
    }
    const next = { status: 'idle' as const, message: 'IA locale indisponible sur cet appareil.' }
    setState(next)
    return next
  } catch (error) {
    const message = error instanceof Error ? error.message : 'L’IA locale n’a pas pu être vérifiée.'
    const next = { status: 'error' as const, message }
    setState(next)
    return next
  }
}

export async function prepareOfflineAi(): Promise<boolean> {
  if (!supportsOfflineAi()) {
    const next = { status: 'error' as const, message: 'Ce navigateur ne prend pas en charge l’IA native de Chrome.' }
    setState(next)
    return false
  }

  if (session) {
    const next = { status: 'ready' as const, message: 'IA locale prête.' }
    setState(next)
    return true
  }

  setState({ status: 'loading', message: 'Préparation de l’IA locale…' })

  try {
    const availability = await window.LanguageModel!.availability()
    if (availability === 'unavailable') {
      const next = { status: 'idle' as const, message: 'Le modèle local n’est pas disponible sur cet appareil.' }
      setState(next)
      return false
    }

    if (availability === 'downloadable') {
      setState({ status: 'downloadable', message: 'Téléchargement du modèle local…' })
    }

    session = await window.LanguageModel!.create({
      monitor: (monitor) => {
        monitor.addEventListener('downloadprogress', (event: any) => {
          const loaded = Number(event?.loaded ?? 0)
          const total = Number(event?.total ?? 0)
          if (total > 0) {
            const progress = Math.min(1, Math.max(0, loaded / total))
            setState({ status: 'loading', message: `Téléchargement du modèle local (${Math.round(progress * 100)} %)` })
          }
        })
      },
    })

    const next = { status: 'ready' as const, message: 'IA locale prête pour fonctionner hors ligne.' }
    setState(next)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Le modèle local n’a pas pu démarrer.'
    setState({ status: 'error', message })
    return false
  }
}

export async function generateOfflineText(prompt: string, signal?: AbortSignal): Promise<string | null> {
  if (!prompt.trim()) return null
  if (!supportsOfflineAi()) return null

  try {
    if (!session) {
      const ready = await prepareOfflineAi()
      if (!ready) return null
    }

    const text = await session!.prompt(prompt, { signal })
    return text.trim() || null
  } catch (error) {
    if (signal?.aborted) return null
    const message = error instanceof Error ? error.message : 'La génération locale a échoué.'
    setState({ status: 'error', message })
    return null
  }
}

export async function disposeOfflineAi(): Promise<void> {
  if (!session) {
    setState({ status: 'idle', message: 'IA locale mise hors tension.' })
    return
  }

  try {
    await session.destroy()
  } finally {
    session = null
    setState({ status: 'idle', message: 'IA locale mise hors tension.' })
  }
}

export function offlineAiEnabled(): boolean {
  return supportsOfflineAi()
}
