// Daily security analysis (src/server/security-ai.server.ts): reads the last
// 24 hours of the firewall journal with the AI and applies the vetted blocks.
// Scheduled functions can't be called from outside the site.
import { runDailyAnalysis } from '../../src/server/security-ai.server.ts'

export default async () => {
  const report = await runDailyAnalysis('planifiée')
  return new Response(JSON.stringify({ ok: true, at: report?.at }), { headers: { 'Content-Type': 'application/json' } })
}

export const config = { schedule: '@daily' }
