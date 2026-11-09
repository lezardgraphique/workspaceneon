// Maily on the device, for when there is no connection.
//
// Model choice (closest to the online Gemini Flash Maily is tuned for):
//  1. Gemini Nano, built into Chrome / Edge (Prompt API, `window.LanguageModel`):
//     same Gemini family, managed and updated by the browser, multimodal.
//  2. Otherwise Gemma 4 E2B (Google's open model built from Gemini research)
//     through WebLLM on WebGPU, downloaded once (~2 GB) into the browser cache;
//     Gemma 3 1B on devices with little memory.
//  3. Everywhere else (Safari, Firefox, no usable GPU) or when 1/2 fail:
//     Gemma 3 1B (270M on small devices) through llama.cpp in WebAssembly on
//     the processor (offline-cpu.ts), ~800 Mo once.
// Both get Maily's own instructions (maily-prompts.ts) and answer with the same
// ```neon protocol, checked by the same engine as online answers.
//
// Nothing is downloaded or run until the user asks ("Préparer"); the Gemma
// engine is unloaded after a few idle minutes or when the page is hidden.
//
// Account copy: a device that prepared Gemma 3 on the processor sends the model
// file to the account once (shared-model.ts, on an unmetered connection); the
// account's other devices then fetch that copy from the app and use it first,
// so they are ready before the network drops.

import { AI_SHARED_KEY, AI_WANTED_KEY } from '@/lib/settings-keys'
import { getPref, setPref, SETTINGS_EVENT } from '@/lib/settings-sync'
import { deleteSharedModel, isSharedModelId, sharedManifest, sharedModelStream, uploadSharedModel } from '@/lib/shared-model'

export type LocalEngine = 'nano' | 'gemma' | 'cpu'

export type OfflineAiStatus =
  | 'checking'
  | 'unsupported' // not even WebAssembly SIMD (very old browser)
  | 'available' // can be prepared (download needed or already on the device)
  | 'downloading'
  | 'ready' // prepared: used automatically without a connection
  | 'error'

export interface OfflineAiState {
  status: OfflineAiStatus
  engine: LocalEngine | null
  // Human-readable model name
  model: string | null
  // 0..1 while downloading
  progress: number | null
  message: string | null
  // Download size shown before "Préparer"
  size: string | null
  // The model comes (or would come) from the copy stored on the account
  fromAccount?: boolean
  // 0..1 while this device sends its model to the account
  sharing?: number | null
}

export interface LocalMessage {
  role: 'user' | 'assistant'
  content: string
  // base64 JPEG/PNG (no data: prefix), read by Gemini Nano only
  images?: { mimeType: string; data: string }[]
}

// ---- Prompt API typings (Chrome 138+) -------------------------------------------

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available'
type NanoContent = string | { type: 'text' | 'image'; value: string | Blob }[]
interface NanoSession {
  promptStreaming: (input: NanoContent | { role: 'user'; content: NanoContent }[], options?: { signal?: AbortSignal }) => ReadableStream<string>
  destroy: () => void
  inputQuota?: number
  contextWindow?: number
}
interface NanoOptions {
  initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[]
  expectedInputs?: { type: 'text' | 'image'; languages?: string[] }[]
  expectedOutputs?: { type: 'text'; languages?: string[] }[]
  monitor?: (m: EventTarget) => void
  signal?: AbortSignal
}
interface NanoApi {
  availability: (options?: NanoOptions) => Promise<Availability>
  create: (options?: NanoOptions) => Promise<NanoSession>
}

declare global {
  interface Window {
    LanguageModel?: NanoApi
  }
}

// ---- Gemma (WebLLM) models -----------------------------------------------------

interface GemmaModel {
  id: string
  label: string
  context: number
  f16: boolean
}
const GEMMA: GemmaModel[] = [
  { id: 'gemma-4-E2B-it-q4f16_1-MLC', label: 'Gemma 4 E2B', context: 8192, f16: true },
  { id: 'gemma-4-E2B-it-q4f32_1-MLC', label: 'Gemma 4 E2B', context: 8192, f16: false },
  { id: 'gemma3-1b-it-q4f16_1-MLC', label: 'Gemma 3 1B', context: 8192, f16: true },
]

const PREF_KEY = 'nsp-local-ai'
// "Not on this device" although the account has Maily hors ligne switched on.
const SKIP_KEY = 'nsp-local-ai-skip'
const IDLE_MS = 4 * 60_000

interface Pref {
  engine: LocalEngine
  model?: string
}

const browser = () => typeof window !== 'undefined'

function readPref(): Pref | null {
  if (!browser()) return null
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null')
    return p && (p.engine === 'nano' || p.engine === 'gemma' || p.engine === 'cpu') ? p : null
  } catch {
    return null
  }
}
function writePref(p: Pref | null) {
  try {
    if (p) localStorage.setItem(PREF_KEY, JSON.stringify(p))
    else localStorage.removeItem(PREF_KEY)
  } catch {
    /* private mode: preference lasts for this page only */
  }
}

// ---- state ----------------------------------------------------------------------

let state: OfflineAiState = { status: 'checking', engine: null, model: null, progress: null, message: null, size: null }
const listeners = new Set<(s: OfflineAiState) => void>()

function setState(patch: Partial<OfflineAiState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l(state)
}

export const getOfflineAiState = () => state

export function subscribeOfflineAi(listener: (s: OfflineAiState) => void) {
  listeners.add(listener)
  listener(state)
  return () => void listeners.delete(listener)
}

/** Maily answers on the device when the network is missing. */
export const localAiEnabled = () => state.status === 'ready' || (state.status === 'checking' && !!readPref())

const NANO_TEXT: NanoOptions = {
  expectedInputs: [{ type: 'text', languages: ['fr', 'en'] }],
  expectedOutputs: [{ type: 'text', languages: ['fr'] }],
}
const NANO_IMAGES: NanoOptions = {
  expectedInputs: [{ type: 'text', languages: ['fr', 'en'] }, { type: 'image' }],
  expectedOutputs: [{ type: 'text', languages: ['fr'] }],
}

async function nanoAvailability(): Promise<Availability> {
  const api = browser() ? window.LanguageModel : undefined
  if (!api) return 'unavailable'
  try {
    const a = await api.availability(NANO_TEXT)
    if (a !== 'unavailable') return a
  } catch {
    /* languages not accepted by this version: ask without them */
  }
  try {
    return await api.availability()
  } catch {
    return 'unavailable'
  }
}

let gpuInfo: Promise<{ f16: boolean } | null> | null = null
function webgpu(): Promise<{ f16: boolean } | null> {
  gpuInfo ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu
    if (!gpu) return null
    try {
      const adapter = await gpu.requestAdapter()
      return adapter ? { f16: adapter.features.has('shader-f16') } : null
    } catch {
      return null
    }
  })()
  return gpuInfo
}

// Gemma models this device can try, best first.
async function gemmaCandidates(): Promise<GemmaModel[]> {
  const gpu = await webgpu()
  if (!gpu) return []
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  const big = GEMMA.filter((m) => m.id.startsWith('gemma-4') && m.f16 === gpu.f16)
  const small = GEMMA.filter((m) => m.id.startsWith('gemma3') && (!m.f16 || gpu.f16))
  return memory < 8 ? [...small, ...big] : [...big, ...small]
}

// WebAssembly with SIMD and exception handling (what llama.cpp's build needs).
function wasmOk(): boolean {
  try {
    const simd = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
    const exc = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11])
    return typeof WebAssembly === 'object' && WebAssembly.validate(simd) && WebAssembly.validate(exc) && typeof caches !== 'undefined' && !!navigator.storage?.getDirectory
  } catch {
    return false
  }
}

const cpu = () => import('@/lib/offline-cpu')

// Processor models this device can try, best first.
async function cpuCandidates() {
  const { CPU_MODELS } = await cpu()
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  return memory < 4 ? [...CPU_MODELS].reverse() : CPU_MODELS
}

let checked: Promise<OfflineAiState> | null = null
// The account copy couldn't be fetched this time: fall back to the usual sources.
let accountFailed = false

/** Looks (without downloading anything) at what this browser can run. */
export function checkOfflineAi(): Promise<OfflineAiState> {
  if (!browser()) return Promise.resolve(state)
  checked ??= (async () => {
    state = { ...state, fromAccount: false }
    const pref = readPref()
    const shared = accountFailed ? null : accountModelId()
    const nano = await nanoAvailability()
    // A model prepared with the processor engine (also the fallback when the others fail).
    if (pref?.engine === 'cpu' && pref.model && wasmOk()) {
      const m = await cpu()
      const chosen = m.CPU_MODELS.find((x) => x.id === pref.model)
      if (chosen && (await m.cpuReady(chosen.id))) {
        setState({ status: 'ready', engine: 'cpu', model: chosen.label, message: null, size: chosen.size })
        return state
      }
      writePref(null)
    }
    // A copy is waiting on the account: this device takes the same model from the app.
    if (shared && wasmOk() && pref?.engine !== 'nano' && pref?.engine !== 'gemma') {
      const chosen = (await cpu()).CPU_MODELS.find((x) => x.id === shared)
      if (chosen) {
        setState({ status: 'available', engine: 'cpu', model: chosen.label, message: null, size: `${chosen.size}, copie de ton compte`, fromAccount: true })
        return state
      }
    }
    if (nano !== 'unavailable') {
      if (pref?.engine === 'nano' && nano === 'available') setState({ status: 'ready', engine: 'nano', model: 'Gemini Nano', message: null, size: null })
      else if (nano === 'downloading') setState({ status: 'downloading', engine: 'nano', model: 'Gemini Nano', message: null, size: null })
      else setState({ status: 'available', engine: 'nano', model: 'Gemini Nano', message: null, size: 'géré par le navigateur' })
      return state
    }
    const candidates = await gemmaCandidates()
    if (!candidates.length) {
      if (wasmOk()) {
        const [first] = await cpuCandidates()
        setState({ status: 'available', engine: 'cpu', model: first.label, message: null, size: first.size })
        return state
      }
      if (pref) writePref(null)
      setState({ status: 'unsupported', engine: null, model: null, message: null, size: null })
      return state
    }
    if (pref?.engine === 'gemma' && pref.model) {
      const chosen = GEMMA.find((m) => m.id === pref.model)
      const { hasModelInCache } = await import('@mlc-ai/web-llm')
      if (chosen && (await hasModelInCache(chosen.id).catch(() => false))) {
        setState({ status: 'ready', engine: 'gemma', model: chosen.label, message: null, size: null })
        return state
      }
      writePref(null)
    }
    setState({ status: 'available', engine: 'gemma', model: candidates[0].label, message: null, size: candidates[0].id.startsWith('gemma3') ? 'environ 700 Mo' : 'environ 2 Go' })
    return state
  })()
  return checked
}

// ---- Gemma engine (loaded on demand) --------------------------------------------

type WebLlm = typeof import('@mlc-ai/web-llm')
type Engine = Awaited<ReturnType<WebLlm['CreateMLCEngine']>>
let engine: { model: GemmaModel; engine: Engine } | null = null
let loadingEngine: Promise<{ model: GemmaModel; engine: Engine }> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null

function armIdle() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void releaseOfflineAi(), IDLE_MS)
}

async function loadGemma(models: GemmaModel[], report: boolean): Promise<{ model: GemmaModel; engine: Engine }> {
  if (engine) return engine
  loadingEngine ??= (async () => {
    const webllm = await import('@mlc-ai/web-llm')
    let last: unknown = null
    for (const model of models) {
      try {
        const e = await webllm.CreateMLCEngine(
          model.id,
          {
            initProgressCallback: (p) => {
              if (report) setState({ status: 'downloading', progress: p.progress, model: model.label, message: null })
            },
          },
          { context_window_size: model.context },
        )
        engine = { model, engine: e }
        return engine
      } catch (err) {
        // Not enough GPU memory, missing feature…: try the next (smaller) one.
        last = err
      }
    }
    throw last ?? new Error('Aucun modèle local compatible.')
  })().finally(() => {
    loadingEngine = null
  })
  return loadingEngine
}

/** Frees the GPU memory (the downloaded model stays on the device). */
export async function releaseOfflineAi(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  if (cpuLoaded) {
    cpuLoaded = false
    await (await cpu()).releaseCpu()
  }
  const e = engine
  engine = null
  if (e) await e.engine.unload().catch(() => {})
}

let cpuLoaded = false
let busy = false
if (browser()) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !busy) void releaseOfflineAi()
  })
}

// ---- prepare / remove ------------------------------------------------------------

const errorText = (e: unknown) =>
  e instanceof Error && /memory|OOM|device lost|adapter/i.test(e.message)
    ? 'Pas assez de mémoire graphique sur cet appareil pour le modèle local.'
    : e instanceof Error && /quota|storage/i.test(e.message)
      ? 'Pas assez de place sur l’appareil pour télécharger le modèle.'
      : 'Le modèle local n’a pas pu être préparé. Réessaie en ligne.'

// Processor engine: works where the two others can't (or failed to load).
async function prepareCpu(only?: string): Promise<boolean> {
  if (!wasmOk()) throw new Error('unsupported')
  const m = await cpu()
  const candidates = only ? m.CPU_MODELS.filter((x) => x.id === only) : await cpuCandidates()
  const model = await m.loadCpu(candidates, true, (progress, mod) =>
    setState({ status: 'downloading', engine: 'cpu', model: mod.label, progress, message: null, size: mod.size }),
  )
  cpuLoaded = true
  writePref({ engine: 'cpu', model: model.id })
  setState({ status: 'ready', engine: 'cpu', model: model.label, progress: null, message: null, size: model.size })
  armIdle()
  return true
}

/**
 * Downloads (once, online) and checks the on-device model. Call it from a click.
 * When the browser's own model or the GPU one can't be set up, the processor
 * engine takes over, so Maily can be prepared in every recent browser.
 */
export async function prepareOfflineAi(): Promise<boolean> {
  const ok = await prepare()
  if (ok) {
    // Prepared from Hugging Face on a computer / Wi-Fi: keep a copy on the account.
    if (unmetered()) void shareOfflineAi()
    // The account's other devices offer (or start) the same preparation.
    setPref(AI_WANTED_KEY, '1')
    try {
      localStorage.removeItem(SKIP_KEY)
    } catch {
      /* private mode */
    }
  }
  return ok
}

/** A model was prepared on this device (read without waking the GPU or the model files). */
export const offlineAiPreparedHere = () => !!readPref()

/** Maily hors ligne is switched on for the account (on any of its devices). */
export const offlineAiWanted = () => getPref(AI_WANTED_KEY) === '1'
/** Switched on for the account and not declined on this device. */
export const offlineAiWantedHere = () => offlineAiWanted() && getPref(SKIP_KEY) !== '1'

/** "Pas sur cet appareil": the account keeps Maily hors ligne, this device doesn't download it. */
export function skipOfflineAiHere() {
  try {
    localStorage.setItem(SKIP_KEY, '1')
  } catch {
    /* private mode */
  }
  setState({})
}

async function prepare(): Promise<boolean> {
  await checkOfflineAi()
  if (state.status === 'ready') return true
  if (state.status === 'unsupported') return false
  // Keep the model even when the browser is short of space.
  void navigator.storage?.persist?.().catch(() => false)
  setState({ status: 'downloading', progress: null, message: null })
  let first: unknown = null
  if (state.fromAccount) {
    try {
      if (await prepareFromAccount()) return true
    } catch (e) {
      first = e
      await releaseOfflineAi()
    }
    // No usable copy on the account: the usual choice of model.
    accountFailed = true
    checked = null
    await checkOfflineAi()
    if (getOfflineAiState().status === 'unsupported') return false
    setState({ status: 'downloading', progress: null, message: null })
  }
  try {
    if (state.engine === 'nano') {
      const api = window.LanguageModel!
      const create = (o: NanoOptions) =>
        api.create({
          ...o,
          monitor: (m) =>
            m.addEventListener('downloadprogress', (e) => {
              const loaded = Number((e as Event & { loaded?: number }).loaded ?? 0)
              setState({ status: 'downloading', progress: loaded <= 1 ? loaded : null })
            }),
        })
      const session = await create(NANO_TEXT).catch(() => create({}))
      session.destroy()
      writePref({ engine: 'nano' })
      setState({ status: 'ready', progress: null, message: null })
      return true
    }
    if (state.engine === 'gemma') {
      const loaded = await loadGemma(await gemmaCandidates(), true)
      writePref({ engine: 'gemma', model: loaded.model.id })
      setState({ status: 'ready', engine: 'gemma', model: loaded.model.label, progress: null, message: null, size: null })
      armIdle()
      return true
    }
  } catch (e) {
    first = e
    await releaseOfflineAi()
  }
  try {
    return await prepareCpu()
  } catch (e) {
    setState({ status: 'error', progress: null, message: errorText(first ?? e) })
    return false
  }
}

/**
 * Stops using Maily offline and frees the downloaded files.
 * - 'here': this device only (the account keeps it, this device stops offering it);
 * - 'everywhere': switched off for the account, the other devices remove theirs
 *   the next time they open the app;
 * - 'remote': switched off from another device (nothing to send back).
 */
export async function removeOfflineAi(scope: 'here' | 'everywhere' | 'remote' = 'here'): Promise<void> {
  const pref = readPref()
  writePref(null)
  if (scope === 'everywhere') {
    setPref(AI_WANTED_KEY, null)
    setPref(AI_SHARED_KEY, null)
    void deleteSharedModel()
  }
  else if (scope === 'here') skipOfflineAiHere()
  await releaseOfflineAi()
  if (pref?.engine === 'gemma' && pref.model) {
    const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm')
    await deleteModelAllInfoInCache(pref.model).catch(() => {})
  }
  if (pref?.engine === 'cpu') await (await cpu()).removeCpu().catch(() => {})
  checked = null
  setState({ status: 'checking', message: null, progress: null })
  await checkOfflineAi()
}

// ---- account copy (shared-model.ts) ----------------------------------------------

/** Model id the account holds a copy of (set by the device that sent it). */
export const accountModelId = (): string | null => {
  const id = getPref(AI_SHARED_KEY)
  return id && isSharedModelId(id) ? id : null
}

// A large transfer may start without a click only on a connection that isn't
// metered: desktop without the Network Information API counts as unmetered,
// phones and tablets without it don't (they may be on mobile data).
export function unmetered(): boolean {
  if (!browser()) return false
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string; effectiveType?: string } }).connection
  if (!c) return !matchMedia('(pointer: coarse)').matches
  if (c.saveData) return false
  if (c.type === 'cellular' || c.type === 'none') return false
  return !/(^|-)2g|3g/.test(c.effectiveType ?? '')
}

/** The user asked to keep data use low (browser / system "économie de données"). */
export const saveData = () => !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData

// Fetches the account copy into this device's model storage, then checks it loads.
async function prepareFromAccount(): Promise<boolean> {
  const id = accountModelId()
  if (!id || !wasmOk()) return false
  const m = await cpu()
  const model = m.CPU_MODELS.find((x) => x.id === id)
  const manifest = model ? await sharedManifest(id) : null
  if (!model || !manifest?.complete) return false
  setState({ status: 'downloading', engine: 'cpu', model: model.label, progress: 0, message: null, size: model.size, fromAccount: true })
  const stream = sharedModelStream(manifest, (progress) => setState({ status: 'downloading', progress }))
  await m.importCpuModel(id, manifest.size, stream)
  return prepareCpu(id)
}

let sharing: Promise<boolean> | null = null

/**
 * Sends the model prepared on this device (Gemma 3 on the processor) to the
 * account, once, resuming where an interrupted send stopped. The other devices
 * then take it from the app. Quiet: a failure is retried next time.
 */
export function shareOfflineAi(): Promise<boolean> {
  sharing ??= (async () => {
    const pref = readPref()
    if (!pref || pref.engine !== 'cpu' || !pref.model || !isSharedModelId(pref.model)) return false
    if (accountModelId() === pref.model) return true
    const file = await (await cpu()).cpuModelFile(pref.model)
    if (!file) return false
    setState({ sharing: 0 })
    await uploadSharedModel(pref.model, file, (p) => setState({ sharing: p }))
    setPref(AI_SHARED_KEY, pref.model)
    return true
  })()
    .catch(() => false)
    .finally(() => {
      sharing = null
      setState({ sharing: null })
    })
  return sharing
}

/** This device holds a model it could send to the account (and the account has none yet). */
export const canShareOfflineAi = () => {
  const pref = readPref()
  return !!pref && pref.engine === 'cpu' && !!pref.model && isSharedModelId(pref.model) && !accountModelId()
}

if (browser()) {
  // A copy just reached the account (sent from another device): offer it here.
  window.addEventListener(SETTINGS_EVENT, (e) => {
    const keys = (e as CustomEvent<string[]>).detail ?? []
    if (keys.includes(AI_SHARED_KEY) && (state.status === 'available' || state.status === 'error')) {
      checked = null
      void checkOfflineAi()
    }
  })
}

// ---- generation ------------------------------------------------------------------

/** Context window (tokens) of the prepared model, used to size the prompt. */
export function localContextTokens(): number {
  if (state.engine === 'gemma') return (GEMMA.find((m) => m.id === readPref()?.model) ?? GEMMA[0]).context
  if (state.engine === 'cpu') return 8192
  return nanoQuota
}
// Gemini Nano's window as last reported by a session (Chrome gives ~6-9k tokens).
let nanoQuota = 6000

function toBlob(img: { mimeType: string; data: string }): Blob {
  const bin = atob(img.data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: img.mimeType })
}

// Prompt API streams deltas (older versions: the whole text so far).
async function* readNano(stream: ReadableStream<string>): AsyncGenerator<string> {
  const reader = stream.getReader()
  let acc = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    if (value.startsWith(acc) && acc.length > 0) {
      yield value.slice(acc.length)
      acc = value
    } else {
      yield value
      acc += value
    }
  }
}

async function* nanoStream(system: string, messages: LocalMessage[], signal: AbortSignal): AsyncGenerator<string> {
  const api = window.LanguageModel
  if (!api) throw new Error('Le modèle intégré à ce navigateur n’est plus disponible.')
  const last = messages[messages.length - 1]
  const initialPrompts = [{ role: 'system' as const, content: system }, ...messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))]
  const images = last.images ?? []
  let session: NanoSession | null = null
  let input: { role: 'user'; content: NanoContent }[] = [{ role: 'user', content: last.content }]
  if (images.length) {
    session = await api.create({ ...NANO_IMAGES, initialPrompts, signal }).catch(() => null)
    if (session) input = [{ role: 'user', content: [{ type: 'text', value: last.content }, ...images.map((i) => ({ type: 'image' as const, value: toBlob(i) }))] }]
  }
  session ??= await api.create({ ...NANO_TEXT, initialPrompts, signal }).catch(() => api.create({ initialPrompts, signal }))
  nanoQuota = session.contextWindow ?? session.inputQuota ?? nanoQuota
  try {
    yield* readNano(session.promptStreaming(input, { signal }))
  } finally {
    session.destroy()
  }
}

async function* gemmaStream(system: string, messages: LocalMessage[], maxTokens: number, signal: AbortSignal): AsyncGenerator<string> {
  const pref = readPref()
  const chosen = GEMMA.find((m) => m.id === pref?.model)
  const { engine: e } = await loadGemma(chosen ? [chosen] : await gemmaCandidates(), false)
  // Gemma has no system role: the instructions open the first user turn.
  const turns = messages.map((m, i) => ({ role: m.role, content: i === 0 ? `${system}\n\n---\n\n${m.content}` : m.content }))
  const stop = () => e.interruptGenerate()
  signal.addEventListener('abort', stop, { once: true })
  try {
    const chunks = await e.chat.completions.create({ messages: turns, stream: true, temperature: 0.4, max_tokens: maxTokens })
    for await (const c of chunks) {
      if (signal.aborted) break
      const t = c.choices[0]?.delta?.content
      if (t) yield t
    }
    if (signal.aborted) throw new DOMException('Génération arrêtée', 'AbortError')
  } finally {
    signal.removeEventListener('abort', stop)
  }
}

/**
 * Streams Maily's answer from the on-device model. `system` is built with
 * `localSystemPrompt` and `messages` must end with the user's turn.
 */
export async function* streamOfflineMaily(system: string, messages: LocalMessage[], maxTokens: number, signal: AbortSignal): AsyncGenerator<string> {
  await checkOfflineAi()
  if (state.status !== 'ready') throw new Error('Maily hors ligne n’est pas prête sur cet appareil.')
  busy = true
  if (idleTimer) clearTimeout(idleTimer)
  try {
    if (state.engine === 'nano') yield* nanoStream(system, messages, signal)
    else if (state.engine === 'cpu') {
      const m = await cpu()
      cpuLoaded = true
      yield* m.cpuStream(readPref()?.model ?? m.CPU_MODELS[0].id, system, messages.map(({ role, content }) => ({ role, content })), maxTokens, signal)
    } else yield* gemmaStream(system, messages, maxTokens, signal)
  } finally {
    busy = false
    if (state.engine === 'gemma' || state.engine === 'cpu') armIdle()
  }
}
