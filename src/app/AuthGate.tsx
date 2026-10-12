import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { OrgProvider } from '../hooks/useOrg'
import { LoadingState } from '../components/ui'
import { ErrorScreen } from '../components/ErrorBoundary'
import { serverProblemText, useServerStatus } from '../components/serverStatus'
import { NETWORK_ERROR_MESSAGE } from '../features/auth/networkError'
import { hasStoredSession } from '../lib/supabase'
import { safeReturnPath } from '../lib/redirect'

/** a failed request during start-up is retried; give it this long before showing the error screen */
export const SERVER_PROBLEM_DELAY_MS = 3000
/** a request that neither answers nor fails (very weak signal): offer the way out after this long */
export const SLOW_START_DELAY_MS = 20000

/** The error screen for a server that does not answer: connection or paused-project text, "Muat ulang", "Keluar". */
function ServerErrorScreen() {
  return <ErrorScreen error={new Error(NETWORK_ERROR_MESSAGE)} />
}

/**
 * Spinner while the app starts. When Supabase does not answer (no signal, paused project) supabase-js keeps retrying
 * an expired session for about 25 seconds; after a short wait the error screen says why, with a way out.
 */
export function FullPageLoading() {
  const server = useServerStatus()
  const [waited, setWaited] = useState(false)
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), SERVER_PROBLEM_DELAY_MS)
    const slowTimer = setTimeout(() => setSlow(true), SLOW_START_DELAY_MS)
    return () => {
      clearTimeout(timer)
      clearTimeout(slowTimer)
    }
  }, [])
  // the screen goes away by itself once the data arrives (the parent stops rendering this fallback)
  if ((waited && server !== 'ok') || slow) return <ServerErrorScreen />
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <LoadingState label="Menyiapkan aplikasi…" />
    </div>
  )
}

/**
 * Redirects to /login when there is no session, then loads the organisation context.
 * The requested location (path + query + hash, so deep links such as /sewa/:id?action=bayar survive) is
 * passed as `state.from`, already filtered by `safeReturnPath` so it can only ever be an in-app path.
 * A stored session that could not be refreshed because the server did not answer is not a sign-out: the error
 * screen stays (the session works again once the server answers) instead of a login that cannot succeed.
 */
export function AuthGate() {
  const { session, loading } = useAuth()
  const server = useServerStatus()
  const location = useLocation()
  if (loading) return <FullPageLoading />
  if (!session) {
    if (server !== 'ok' && hasStoredSession()) return <ServerErrorScreen />
    const from = safeReturnPath(location.pathname + location.search + location.hash)
    return <Navigate to="/login" replace state={{ from }} />
  }
  return (
    <OrgProvider fallback={<FullPageLoading />}>
      <Outlet />
    </OrgProvider>
  )
}

/** Above the login and sign-up forms once a request got no answer, so a failed sign-in also names a paused project. */
function ServerNotice() {
  const status = useServerStatus()
  if (status === 'ok') return null
  const { message, hint } = serverProblemText(status)
  return (
    <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="mx-auto max-w-sm">
        <p className="font-medium">{message}</p>
        <p className="mt-1">{hint}</p>
      </div>
    </div>
  )
}

/** Opposite of AuthGate: send signed-in users away from the login/signup pages. */
export function GuestOnly() {
  const { session, loading } = useAuth()
  const location = useLocation()
  const from = safeReturnPath((location.state as { from?: unknown } | null)?.from)
  if (loading) return <FullPageLoading />
  // after sign-in, go where the visitor was headed (the deep link AuthGate remembered)
  if (session) return <Navigate to={from} replace />
  // an invite link opened while an older version was still installed was parked here by that version;
  // hand it to the join link page so the code is kept
  if (from.startsWith('/gabung?')) return <Navigate to={from} replace />
  return (
    <>
      <ServerNotice />
      <Outlet />
    </>
  )
}
