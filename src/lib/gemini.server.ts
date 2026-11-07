import { GoogleGenAI } from '@google/genai'

// Credentials come from Netlify AI Gateway at runtime — no key to configure.
export const ai = new GoogleGenAI({})
export const MODEL = 'gemini-3-flash-preview'

export { APP_GUIDE, FIELDS_SPEC, FORMAT_SPEC, MAILY_PERSONA, MODULE_REPLY_SPEC, RESEARCH_SPEC, SCOPE_SPEC } from '@/lib/maily-prompts'

export const stripFences = (s: string) =>
  s.replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
