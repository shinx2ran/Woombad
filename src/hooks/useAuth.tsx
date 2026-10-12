import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getAuth } from '../lib/auth'
import type { AuthService, AuthSession } from '../lib/auth'

interface AuthContextValue {
  auth: AuthService
  session: AuthSession | null
  /** true until the initial session lookup completes */
  loading: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useMemo(() => getAuth(), [])
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    auth
      .getSession()
      .then((s) => {
        if (!cancelled) setSession(s)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    const unsubscribe = auth.onAuthStateChange((s) => setSession(s))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [auth])

  const value = useMemo(() => ({ auth, session, loading }), [auth, session, loading])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
