// Claude (Anthropic) through the Netlify AI Gateway: Maily's expert for code.
// Used first when she recognises, builds or fixes a module (build mode, a code
// issue, code pasted in the message); Gemini stays for conversation and web
// research, and takes over whenever Claude can't answer. The SDK reads
// ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL injected by the gateway (no key here).
import Anthropic from '@anthropic-ai/sdk'
import { getStore } from '@netlify/blobs'

// Best for code first, the faster one next (then Gemini, in api.maily.ts).
export const CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5']

// Claude costs more Netlify credits than Gemini: at most this many Claude
// answers per account and per day, then Maily goes on with Gemini.
export const CLAUDE_PER_DAY = Number(process.env.MAILY_CLAUDE_PER_DAY) || 30

export const claudeEnabled = () => process.env.MAILY_CLAUDE !== 'off' && !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_BASE_URL)

let client: Anthropic | null = null
const anthropic = () => (client ??= new Anthropic())

const dayKey = (userId: string) => `${userId}/${new Date().toISOString().slice(0, 10)}`

/** Takes one Claude answer from today's allowance (false when it is used up). */
export async function takeClaudeTurn(userId: string): Promise<boolean> {
  try {
    const store = getStore('maily-usage')
    const key = dayKey(userId)
    const n = Number((await store.get(key)) ?? 0) || 0
    if (n >= CLAUDE_PER_DAY) return false
    await store.set(key, String(n + 1))
    return true
  } catch {
    // Counter unavailable: Claude is still allowed (the gateway rate limit stays).
    return true
  }
}

export type ClaudeImage = { mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string }
export type ClaudeTurn = { role: 'user' | 'assistant'; text: string; images?: ClaudeImage[] }

/** What Claude needs to know beyond Maily's usual instructions. */
export const CLAUDE_NOTE = `\n\nDANS CETTE RÉPONSE : tu n'as pas accès au web. Pour une nouveauté ou une info récente, dis que tu ne peux pas la vérifier ici plutôt que d'inventer. Concentre-toi sur la reconnaissance, la construction et la correction du code : lis tout le code fourni, respecte exactement le format \`\`\`neon et les noms de champs, et vérifie ton code avant de l'envoyer.`

/**
 * Starts a streamed Claude answer and returns its text pieces. Messages are
 * made to alternate (Claude requires it) and start with the user.
 */
export function claudeStream(model: string, system: string, turns: ClaudeTurn[], signal: AbortSignal): AsyncIterable<string> {
  const messages: Anthropic.MessageParam[] = []
  for (const t of turns) {
    const content: Anthropic.ContentBlockParam[] = [
      ...(t.images ?? []).map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mimeType, data: img.data } })),
      { type: 'text' as const, text: t.text || '…' },
    ]
    const prev = messages[messages.length - 1]
    if (prev && prev.role === t.role && Array.isArray(prev.content)) prev.content.push(...content)
    else messages.push({ role: t.role, content })
  }
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: 'Bonjour Maily.' })

  const stream = anthropic().messages.stream(
    {
      model,
      max_tokens: 16_000,
      temperature: 0.3,
      // The long instructions are the same from one message to the next: cached 5 minutes.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
    },
    { signal },
  )
  return (async function* () {
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && ev.delta.text) yield ev.delta.text
    }
  })()
}
