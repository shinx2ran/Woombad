import { useSyncExternalStore } from 'react'
import { getServerStatus, isSupabaseConfigured, subscribeServerStatus, type ServerStatus } from '../lib/supabase'
import { NETWORK_ERROR_MESSAGE } from '../features/auth/networkError'

const RESTORE_STEPS = 'Pemilik kos: buka dashboard Supabase → proyek Woombad → Restore project, lalu tunggu beberapa menit.'

/** Main text and the owner's next step when Supabase did not answer (online mode only). */
export function serverProblemText(status: ServerStatus): { message: string; hint: string } {
  return status === 'paused'
    ? { message: 'Server Woombad sedang dijeda karena lama tidak dipakai.', hint: RESTORE_STEPS }
    : { message: NETWORK_ERROR_MESSAGE, hint: `Jika internet lancar, proyek Supabase mungkin sedang dijeda. ${RESTORE_STEPS}` }
}

/** How the last Supabase request went; always 'ok' in Mode Demo. Needs no providers. */
export function useServerStatus(): ServerStatus {
  const status = useSyncExternalStore(subscribeServerStatus, getServerStatus, getServerStatus)
  return isSupabaseConfigured ? status : 'ok'
}
