// Preferences that follow the account across devices (shared by the browser
// and the server). Anything tied to one screen or one device (VML window size,
// touch hints, the on-device model files) stays local on purpose.

export interface PrefEntry {
  // Value as stored in localStorage; null = removed
  v: string | null
  // Time of the change (ms since epoch): the latest change wins
  t: number
}
export type Prefs = Record<string, PrefEntry>

/** Maily hors ligne switched on for the account ('1'). Each device downloads its own model. */
export const AI_WANTED_KEY = 'nsp-ai-wanted'

/**
 * Id of the offline model (Gemma 3 on the processor) a device sent to the account
 * (shared-model.ts): the other devices fetch this copy from the app and use it.
 */
export const AI_SHARED_KEY = 'nsp-ai-shared'

/** « Premiers pas » guide of the home page hidden ('1'). */
export const GUIDE_HIDDEN_KEY = 'nsp-guide-hidden'

/** Logic lines ({% if %}, {% set %}…) shown in the Structure tab ('1'); hidden by default. */
export const SHOW_LOGIC_KEY = 'nsp-show-logic'

// nsp-sector (estimate), nsp-structure-focus, nsp-show-logic, nsp-folded-<module id>, nsp-ai-wanted, nsp-ai-shared, nsp-guide-hidden.
export const SYNC_KEY_RE = /^nsp-(?:sector|structure-focus|show-logic|ai-wanted|ai-shared|guide-hidden|folded-[A-Za-z0-9_-]{1,80})$/

export const isSyncedKey = (k: string) => SYNC_KEY_RE.test(k)
