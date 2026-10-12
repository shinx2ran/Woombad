import { useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import { savePendingCode } from './pendingCode'

/**
 * Target of invitation links shared over WhatsApp: /gabung?kode=ABCD-EFGH. Saves the code, then sends the
 * visitor to sign up (no account yet) or to the app, where the join screen picks the code up.
 */
export function JoinLinkPage() {
  const [params] = useSearchParams()
  const { session, loading } = useAuth()
  const code = params.get('kode') ?? ''
  useEffect(() => {
    if (code) savePendingCode(code)
  }, [code])
  if (loading) return null
  return <Navigate to={session ? '/dashboard' : '/daftar'} replace />
}
