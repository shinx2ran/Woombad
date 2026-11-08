/**
 * What the document scanner needs from the app around it (SPEC 7.19): the organisation's default reader, whether this
 * is Mode Demo, who sees costs, whether the device is online, and what to do after a Claude scan. Kept in one hook so
 * the panel itself stays a plain component (its tests replace this hook).
 */
import { useCallback, useSyncExternalStore } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import { DEMO_KTP_SCAN_USAGE } from './claudeScan'
import { orgScanEngine, type ScanEngine } from './engine'
import type { DocumentScanResult } from './ocr'

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}
const readOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

/** true while the browser reports a network connection (false only when it says so) */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, readOnline, () => true)
}

export interface ScanEngineContext {
  orgId: string
  /** the organisation's default reader (Pengaturan → Scan KTP) */
  defaultEngine: ScanEngine
  isLocalMode: boolean
  /** owner/admin see what a Claude scan cost (SPEC 7.17) */
  showsCost: boolean
  online: boolean
  /** after a Claude scan: Mode Demo writes the sample cost row; both modes refresh the Kredit Claude card */
  recordClaudeScan: (result: DocumentScanResult) => Promise<void>
}

/** the function inserts the usage row in a background task after sending its reply: refresh a moment later */
export const USAGE_REFRESH_DELAY_MS = 1500

export function useScanEngine(): ScanEngineContext {
  const { org, role, repo, isLocalMode } = useOrg()
  const { session } = useAuth()
  const invalidate = useInvalidate()
  const online = useOnline()
  const userId = session?.user.id ?? null
  const recordClaudeScan = useCallback(
    async (result: DocumentScanResult) => {
      if (isLocalMode) {
        await repo
          .insert('scan_usage', {
            user_id: userId,
            ...DEMO_KTP_SCAN_USAGE,
            outcome: 'ok',
            kind: result.kind,
            lines: result.lines.length,
            attempts: [],
          })
          .catch(() => undefined)
      }
      if (!isLocalMode) await new Promise<void>((resolve) => setTimeout(resolve, USAGE_REFRESH_DELAY_MS))
      await invalidate('scan_usage').catch(() => undefined)
    },
    [isLocalMode, repo, userId, invalidate],
  )
  return {
    orgId: org.id,
    defaultEngine: orgScanEngine(org.ktp_scan_engine),
    isLocalMode,
    showsCost: role === 'owner' || role === 'admin',
    online,
    recordClaudeScan,
  }
}
