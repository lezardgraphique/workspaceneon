// Preferences that follow the account across devices (shared by the browser
// and the server). Anything tied to one screen or one device (VML window size,
// touch hints) stays local on purpose.

export interface PrefEntry {
  // Value as stored in localStorage; null = removed
  v: string | null
  // Time of the change (ms since epoch): the latest change wins
  t: number
}
export type Prefs = Record<string, PrefEntry>

/** « Premiers pas » guide of the home page hidden ('1'). */
export const GUIDE_HIDDEN_KEY = 'nsp-guide-hidden'

/** Logic lines ({% if %}, {% set %}…) shown in the Structure tab ('1'); hidden by default. */
export const SHOW_LOGIC_KEY = 'nsp-show-logic'

// nsp-sector (estimate), nsp-structure-focus, nsp-show-logic, nsp-folded-<module id>, nsp-guide-hidden,
// nsp-brand (« Ma marque », brand.ts), nsp-maily-memories (« Mémoires de Maily »).
export const SYNC_KEY_RE = /^nsp-(?:sector|structure-focus|show-logic|guide-hidden|brand|maily-memories|folded-[A-Za-z0-9_-]{1,80})$/

export const isSyncedKey = (k: string) => SYNC_KEY_RE.test(k)
