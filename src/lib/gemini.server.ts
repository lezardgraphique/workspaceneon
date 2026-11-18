import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import type { GenerateContentConfig, GenerateContentParameters } from '@google/genai'

// Credentials come from Netlify AI Gateway at runtime — no key to configure.
export const ai = new GoogleGenAI({})
export const MODEL = 'gemini-3-flash-preview'
// Tried in this order when the main model is overloaded, rate limited or
// missing: Maily stays available when one model isn't.
export const MODELS = [MODEL, 'gemini-3.5-flash', 'gemini-flash-latest']

export { APP_GUIDE, FIELDS_SPEC, FORMAT_SPEC, MAILY_PERSONA, MODULE_REPLY_SPEC, RESEARCH_SPEC, SCOPE_SPEC } from '@/lib/maily-prompts'

export const stripFences = (s: string) =>
  s.replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function statusOf(err: unknown): number {
  const s = (err as { status?: unknown })?.status
  if (typeof s === 'number') return s
  const m = /"code"\s*:\s*(\d{3})|\bstatus(?: code)?\s*:?\s*(\d{3})|\b(4\d\d|5\d\d)\b/.exec(String((err as Error)?.message ?? err))
  return Number(m?.[1] ?? m?.[2] ?? m?.[3] ?? 0)
}

/** Worth trying again (later or with another model). */
export function retryable(err: unknown): boolean {
  const s = statusOf(err)
  if (s === 408 || s === 409 || s === 429 || s === 404 || s >= 500) return true
  return /overload|unavailable|exhausted|timeout|timed out|deadline|fetch failed|econnreset|socket|network|terminated|aborted|empty answer/i.test(String((err as Error)?.message ?? err))
}

/** The request itself was refused because of an option (tools, thinking…). */
export const configRefused = (err: unknown) =>
  statusOf(err) === 400 && /tool|search|url_context|urlContext|thinking|not supported|unsupported|invalid argument/i.test(String((err as Error)?.message ?? err))

/** Options a model may not accept, removed one after the other when refused. */
export interface Attempt {
  model: string
  tools: boolean
  thinking: boolean
}

export function attemptsFor(withTools: boolean): Attempt[] {
  // Main model twice (a 429/503 is often gone a second later), then the others.
  return [MODEL, MODEL, ...MODELS.slice(1)].map((model) => ({ model, tools: withTools, thinking: true }))
}

export const thinkingFor = (model: string, level: 'minimal' | 'low' | 'medium') =>
  /^gemini-3/.test(model)
    ? { thinkingConfig: { thinkingLevel: level === 'minimal' ? ThinkingLevel.MINIMAL : level === 'low' ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM } }
    : {}

/**
 * One-shot generation that survives an overloaded or missing model: tries the
 * models in turn with a short backoff, drops refused options.
 */
export async function generateResilient(params: Omit<GenerateContentParameters, 'model'> & { config?: GenerateContentConfig }, level: 'low' | 'medium' = 'low') {
  let last: unknown
  const attempts = attemptsFor(false)
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i]
    try {
      return await ai.models.generateContent({ ...params, model: a.model, config: { ...params.config, ...(a.thinking ? thinkingFor(a.model, level) : {}) } })
    } catch (err) {
      last = err
      if (configRefused(err) && a.thinking) {
        try {
          return await ai.models.generateContent({ ...params, model: a.model })
        } catch (e) {
          last = e
        }
      }
      if (!retryable(last) && !configRefused(last)) throw last
      await sleep(400 * (i + 1))
    }
  }
  throw last
}
