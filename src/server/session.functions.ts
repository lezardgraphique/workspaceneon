import { createServerFn } from '@tanstack/react-start'

import { sessionUser } from '@/server/auth.server'

// Read by the root route to gate the app. Only the id and the e-mail leave the server.
export const getSession = createServerFn({ method: 'GET' }).handler(async () => sessionUser())
