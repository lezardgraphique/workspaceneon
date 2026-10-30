// An expired session answers 401: back to the sign-in page instead of a vague error.
export function guard(res: Response): Response {
  if (res.status === 401 && typeof window !== 'undefined') window.location.replace('/connexion')
  return res
}

export const guardedFetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init).then(guard)
