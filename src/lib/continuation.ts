// A Maily answer cut before its end (platform time limit, dropped connection,
// overloaded model) is resumed instead of lost: the server ends the stream with
// CONTINUE_MARK and the editor asks for the rest, sending the partial answer
// back. Shared by the server route and the browser.

/** Written alone at the very end of a stream that must be resumed. */
export const CONTINUE_MARK = '⁣[[nsp:suite]]'

/** Written while a slow model is still thinking, so the platform sees the answer
 * has started (it cuts a response with no first byte after ~30 s). Removed by the editor. */
export const KEEPALIVE = '\u2060'

/** Ends a stream that could not start: `⁣[[nsp:erreur:503]]message`. */
export const failMark = (status: number, message: string) => `⁣[[nsp:erreur:${status}]]${message}`
export const readFail = (text: string): { status: number; message: string } | null => {
  const m = /⁣\[\[nsp:erreur:(\d{3})\]\]([\s\S]*)$/.exec(text)
  return m ? { status: Number(m[1]), message: m[2].trim() } : null
}

/** Ends with the mark (the mark itself is removed by `stripMark`). */
export const wantsContinue = (text: string) => text.trimEnd().endsWith(CONTINUE_MARK)
export const stripMark = (text: string) => text.replace(/\s*⁣\[\[nsp:suite\]\]\s*$/, '')

export const CONTINUE_PROMPT =
  "Ta réponse précédente a été coupée par une limite technique. Reprends EXACTEMENT au caractère où elle s'arrête : aucune introduction, ne répète rien de ce qui est déjà écrit, ne rouvre pas un bloc de code déjà ouvert (continue son contenu là où il s'arrête, puis ferme-le avec ```). Termine ensuite normalement."

/**
 * The model sometimes repeats the end of what it had written: removes the
 * longest overlap (≥ 8 characters) between the end of `before` and the start
 * of `next`, and a code fence reopened at the start of `next` when `before`
 * stopped inside an open one.
 */
export function trimOverlap(before: string, next: string): string {
  let out = next
  const openFence = (before.match(/```/g)?.length ?? 0) % 2 === 1
  if (openFence) out = out.replace(/^\s*```(?:neon|html?|hubl)?[^\n]*\n/, '')
  const max = Math.min(400, before.length, out.length)
  for (let k = max; k >= 8; k--) {
    if (before.endsWith(out.slice(0, k))) return out.slice(k)
  }
  return out
}
