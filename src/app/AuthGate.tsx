import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { OrgProvider } from '../hooks/useOrg'
import { LoadingState } from '../components/ui'

export function FullPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <LoadingState label="Menyiapkan aplikasi…" />
    </div>
  )
}

/** Redirects to /login when there is no session, then loads the organisation context. */
export function AuthGate() {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoading />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return (
    <OrgProvider fallback={<FullPageLoading />}>
      <Outlet />
    </OrgProvider>
  )
}

/** Opposite of AuthGate: send signed-in users away from the login/signup pages. */
export function GuestOnly() {
  const { session, loading } = useAuth()
  if (loading) return <FullPageLoading />
  if (session) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
