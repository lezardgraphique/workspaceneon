import { useEffect, useRef, useState } from 'react'
import { Battery, Bot, Loader2, Send, X } from 'lucide-react'

import {
  disposeOfflineAi,
  generateOfflineText,
  getOfflineAiState,
  prepareOfflineAi,
  subscribeOfflineAi,
  supportsOfflineAi,
  type OfflineAiState,
} from '@/lib/offline-ai'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

/** Opt-in local assistant. It never downloads or runs a model until the user asks. */
export function LocalAiPanel() {
  const [state, setState] = useState<OfflineAiState>(() => getOfflineAiState())
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const controller = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const supported = supportsOfflineAi()

  useEffect(() => subscribeOfflineAi(setState), [])

  useEffect(() => {
    if (!open) return
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, open])

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState === 'visible' || !busy) return
      controller.current?.abort()
      setBusy(false)
      void disposeOfflineAi()
    }
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => document.removeEventListener('visibilitychange', stopWhenHidden)
  }, [busy])

  const close = () => {
    controller.current?.abort()
    controller.current = null
    setBusy(false)
    setOpen(false)
    void disposeOfflineAi()
  }

  const prepare = async () => {
    if (busy) return
    setBusy(true)
    const ready = await prepareOfflineAi()
    setBusy(false)
    if (ready) setOpen(true)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy || state.status !== 'ready') return
    setInput('')
    const history = [...messages, { role: 'user' as const, content: text }].slice(-8)
    setMessages(history)
    setBusy(true)
    const ctrl = new AbortController()
    controller.current = ctrl
    try {
      const context = history.map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Maily'} : ${m.content}`).join('\n\n')
      const reply = await generateOfflineText(
        `Tu es Maily, une assistante en français qui tutoie la personne. Tu aides avec le copywriting email, l'accessibilité et la création de modules HTML email. Tu fonctionnes hors ligne : ne prétends pas chercher sur le Web et indique tes limites si une information récente est demandée. Réponds de façon concise.\n\n${context}\n\nMaily :`,
        ctrl.signal,
      )
      if (!ctrl.signal.aborted) {
        setMessages((prev) => [...prev, { role: 'assistant', content: reply ?? 'Je n’ai pas pu générer de réponse locale. Vérifie que le modèle est prêt, puis réessaie.' }])
      }
    } catch (error) {
      if (!ctrl.signal.aborted) {
        setMessages((prev) => [...prev, { role: 'assistant', content: error instanceof Error ? error.message : 'La génération locale a échoué.' }])
      }
    } finally {
      if (controller.current === ctrl) controller.current = null
      setBusy(false)
    }
  }

  if (!supported) return null

  const buttonClass = 'fixed right-3 z-40 flex items-center gap-2 rounded-full border border-violet/60 bg-night/95 px-3 py-2 text-xs text-white shadow-lg hover:border-cyan'

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => (state.status === 'ready' ? setOpen(true) : void prepare())}
          disabled={busy}
          title="Préparer ou ouvrir l’assistante IA locale"
          className={`${buttonClass} bottom-[calc(6rem+env(safe-area-inset-bottom))] lg:bottom-14 disabled:opacity-60`}
        >
          {busy || state.status === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4 text-cyan" />}
          {state.status === 'ready' ? 'IA locale' : 'Préparer l’IA locale'}
        </button>
      )}

      {open && (
        <section
          aria-label="Assistante IA locale"
          className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex max-h-[min(70vh,38rem)] flex-col overflow-hidden rounded-xl border border-cyan/40 bg-night shadow-2xl sm:left-auto sm:right-4 sm:w-[min(26rem,calc(100vw-2rem))] lg:bottom-14"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Bot className="size-4 text-cyan" /> Maily · IA locale</div>
            <button type="button" onClick={close} aria-label="Fermer et arrêter l’IA locale" className="rounded p-1 text-mute hover:text-white"><X className="size-4" /></button>
          </header>
          <p className="border-b border-line/70 px-4 py-2 text-xs text-mute" role="status">
            {state.message ?? 'Réponses générées sur cet appareil. Pas de recherche Web.'}
          </p>
          <div ref={listRef} className="min-h-24 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.length === 0 && <p className="text-sm text-mute">L’IA locale est prête. Demande une reformulation, des idées de contenu ou un conseil simple. Elle peut être moins précise que Gemini.</p>}
            {messages.map((message, index) => (
              <div key={index} className={`rounded-lg px-3 py-2 text-sm ${message.role === 'user' ? 'ml-8 bg-pink-fill text-white' : 'mr-6 border border-line bg-panel text-[#e3e3f0]'}`}>
                {message.content}
              </div>
            ))}
            {busy && <p className="flex items-center gap-2 text-xs text-mute"><Loader2 className="size-3.5 animate-spin" /> Réponse locale en cours…</p>}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void send() }} className="flex items-end gap-2 border-t border-line p-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }}
              rows={2}
              maxLength={4000}
              disabled={busy || state.status !== 'ready'}
              placeholder="Écris à Maily (hors ligne)…"
              className="min-h-10 flex-1 resize-none rounded-lg border border-line bg-void px-3 py-2 text-sm text-white outline-none focus:border-violet disabled:opacity-60"
            />
            {busy ? (
              <button type="button" onClick={() => controller.current?.abort()} aria-label="Arrêter la génération" className="rounded-lg border border-line p-2.5 text-mute hover:text-white"><X className="size-4" /></button>
            ) : (
              <button type="submit" disabled={!input.trim() || state.status !== 'ready'} aria-label="Envoyer à l’IA locale" className="rounded-lg bg-pink-fill p-2.5 text-white disabled:opacity-40"><Send className="size-4" /></button>
            )}
          </form>
          <p className="flex items-center gap-1 border-t border-line/60 px-3 py-2 text-[10px] text-mute"><Battery className="size-3" /> Activée uniquement à ta demande ; fermeture ou arrière-plan = arrêt du modèle.</p>
        </section>
      )}
    </>
  )
}
