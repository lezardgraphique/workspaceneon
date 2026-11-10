import { createFileRoute } from '@tanstack/react-router'

import { tokenOwner } from '@/server/api-tokens.server'
import { callTool, toolList } from '@/server/mcp/tools.server'

// MCP server (Model Context Protocol, « Streamable HTTP » transport, stateless:
// one JSON-RPC exchange per POST, answered as JSON, no session, no stream).
// An AI client (Claude…) works in an account with a personal token created in
// « Mon compte », given either in the address (/mcp/<token>, for clients that
// only take a URL) or as `Authorization: Bearer <token>`. Session cookies are
// never accepted here: a web page can't drive this endpoint for a visitor.

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const LATEST = VERSIONS[0]
const MAX_BODY = 1_000_000

const INSTRUCTIONS = `Neon Sandbox Pro est un éditeur de modules e-mail et web (HTML + HuBL). Ce serveur agit dans le compte de son propriétaire : lister, lire, créer et modifier des modules, enregistrer des blocs réutilisables, exporter un module et tester son rendu dans les messageries. Rien n'y est jamais supprimé.
Avant d'écrire un module, appelle guide_format. Pour modifier un module, lis-le (lire_module) puis renvoie son code complet avec tes changements (modifier_module). Évite les doublons : consulte lister_modules / lister_blocs avant de créer. Réponds en français, en tutoyant, sauf si l'utilisateur écrit autrement.`

// Calls per token per minute (in memory, per server instance).
const LIMIT = 120
const calls = new Map<string, { n: number; reset: number }>()
function overLimit(key: string): number {
  const now = Date.now()
  if (calls.size > 2000) for (const [k, v] of calls) if (v.reset <= now) calls.delete(k)
  let c = calls.get(key)
  if (!c || c.reset <= now) {
    c = { n: 0, reset: now + 60_000 }
    calls.set(key, c)
  }
  c.n++
  return c.n > LIMIT ? Math.ceil((c.reset - now) / 1000) : 0
}

interface RpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } })
const rpcError = (id: RpcMessage['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

function tokenOf(request: Request, splat: string): string {
  const auth = request.headers.get('authorization')
  const bearer = auth?.match(/^Bearer\s+(\S+)$/i)?.[1]
  return bearer ?? splat.split('/')[0] ?? ''
}

async function answer(msg: RpcMessage, ctx: { userId: string; origin: string }) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize': {
      const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : LATEST
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: VERSIONS.includes(asked) ? asked : LATEST,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'neon-sandbox-pro', title: 'Neon Sandbox Pro', version: '1.0.0' },
          instructions: INSTRUCTIONS,
        },
      }
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: toolList() } }
    case 'tools/call': {
      const name = typeof params?.name === 'string' ? params.name : ''
      const args = params?.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {}
      return { jsonrpc: '2.0', id, result: await callTool(name, args, ctx) }
    }
    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: [] } }
    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: [] } }
    default:
      return rpcError(id, -32601, `Méthode inconnue : ${method}`)
  }
}

async function handlePost(request: Request, splat: string): Promise<Response> {
  const token = tokenOf(request, splat)
  const owner = token ? await tokenOwner(token) : null
  if (!owner) return json(rpcError(null, -32001, 'Jeton absent, invalide ou révoqué : crée une connexion dans Neon Sandbox Pro > Mon compte > Connexion IA.'), 401)
  const wait = overLimit(owner.tokenId)
  if (wait) return json(rpcError(null, -32002, 'Trop de requêtes, réessaie dans un instant.'), 429, { 'Retry-After': String(wait) })

  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY) return json(rpcError(null, -32600, 'Requête trop volumineuse.'), 413)
  const text = await request.text()
  if (text.length > MAX_BODY) return json(rpcError(null, -32600, 'Requête trop volumineuse.'), 413)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return json(rpcError(null, -32700, 'JSON invalide.'), 400)
  }

  const ctx = { userId: owner.userId, origin: new URL(request.url).origin }
  const batch = Array.isArray(body)
  const messages = (batch ? body : [body]) as RpcMessage[]
  if (!messages.length || messages.length > 20) return json(rpcError(null, -32600, 'Requête invalide.'), 400)
  const replies = []
  for (const m of messages) {
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') {
      replies.push(rpcError(null, -32600, 'Requête invalide.'))
      continue
    }
    // Notifications (no id) and client responses get no reply.
    if (m.id === undefined || m.id === null || !m.method) continue
    replies.push(await answer(m, ctx))
  }
  if (!replies.length) return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  return json(batch ? replies : replies[0])
}

// No server-to-client stream and no session to close.
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } })

export const Route = createFileRoute('/mcp/$')({
  server: {
    handlers: {
      POST: async ({ request, params }) => handlePost(request, (params as { _splat?: string })._splat ?? ''),
      GET: notAllowed,
      DELETE: notAllowed,
    },
  },
})
