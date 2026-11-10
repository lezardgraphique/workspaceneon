// Password rules for new passwords (sign-up, invitation, reset), checked in
// the browser before anything is sent to Netlify Identity. Following ANSSI and
// NIST SP 800-63B: length first, no forced character classes, refuse
// passwords that are known to leak (Have I Been Pwned, k-anonymity: only the
// first 5 characters of the SHA-1 leave the browser).

export const MIN_PASSWORD = 12
// Netlify Identity hashes with bcrypt, which ignores everything after 72 bytes:
// longer passwords would be silently shortened.
export const MAX_PASSWORD_BYTES = 72

// The most used passwords and patterns (the leak check catches the rest).
const COMMON = [
  'password', 'motdepasse', 'azerty', 'qwerty', '123456', 'abcdef', 'soleil', 'bonjour', 'doudou', 'loulou',
  'marseille', 'france', 'iloveyou', 'jetaime', 'admin', 'welcome', 'letmein', 'neonsandbox', 'hubspot', 'neon',
]

export interface PasswordCheck {
  ok: boolean
  /** Why it is refused, in French (empty when ok). */
  reason: string
  /** 0 (very weak) … 4 (strong), for the meter. */
  score: 0 | 1 | 2 | 3 | 4
}

const bytes = (s: string) => new TextEncoder().encode(s).length

/** Entropy-like estimate: character pool × length, with penalties for repeats and sequences. */
function estimate(pw: string): number {
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/\d/.test(pw)) pool += 10
  if (/[^a-zA-Z\d]/.test(pw)) pool += 33
  const unique = new Set(pw).size
  const effective = Math.min(pw.length, unique * 2)
  let bits = effective * Math.log2(Math.max(pool, 1))
  if (/(.)\1{2,}/.test(pw)) bits -= 10
  if (/(?:0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|azer|zert|qwer|wert)/i.test(pw)) bits -= 15
  return bits
}

export function checkPassword(pw: string, email = ''): PasswordCheck {
  const bits = estimate(pw)
  const score = (bits < 40 ? 0 : bits < 55 ? 1 : bits < 70 ? 2 : bits < 90 ? 3 : 4) as PasswordCheck['score']
  const refuse = (reason: string): PasswordCheck => ({ ok: false, reason, score: Math.min(score, 1) as PasswordCheck['score'] })
  if (pw.length < MIN_PASSWORD) return refuse(`Au moins ${MIN_PASSWORD} caractères (une phrase de passe fait très bien l'affaire).`)
  if (bytes(pw) > MAX_PASSWORD_BYTES) return refuse(`Trop long : ${MAX_PASSWORD_BYTES} octets maximum (environ ${MAX_PASSWORD_BYTES} lettres sans accent).`)
  if (new Set(pw).size < 5) return refuse('Trop répétitif : varie davantage les caractères.')
  const lower = pw.toLowerCase().replace(/[^a-z0-9]/g, '')
  const local = email.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '')
  if (local.length >= 4 && lower.includes(local)) return refuse('Ne reprends pas ton adresse e-mail dans le mot de passe.')
  if (COMMON.some((w) => lower.replace(/\d+$/, '') === w || (lower.startsWith(w) && lower.length - w.length < 5)))
    return refuse('Ce mot de passe est trop courant.')
  if (bits < 40) return refuse('Trop facile à deviner : allonge-le ou mélange davantage.')
  return { ok: true, reason: '', score }
}

/**
 * How many times the password appears in known leaks (Have I Been Pwned).
 * Only the first 5 hex characters of its SHA-1 are sent. null = could not
 * check (offline, service down): the caller lets the password through.
 */
export async function leakCount(pw: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(pw))
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal,
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
    })
    if (!res.ok) return null
    const suffix = hex.slice(5)
    for (const line of (await res.text()).split('\n')) {
      const [s, n] = line.trim().split(':')
      if (s === suffix) return Number(n) || 0
    }
    return 0
  } catch {
    return null
  }
}
