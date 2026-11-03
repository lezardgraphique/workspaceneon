// Last signed-in account, kept in the browser so the app can open offline
// (the real check still happens on the server for every call that needs it).
const KEY = 'nsp-user'
export interface CachedUser {
  id: string
  email: string
}

export function cachedUser(): CachedUser | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v && typeof v.id === 'string' ? v : null
  } catch {
    return null
  }
}

export function rememberUser(u: CachedUser | null) {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify({ id: u.id, email: u.email }))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage blocked */
  }
}
