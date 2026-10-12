import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { isSupabaseConfigured } from '../lib/supabase'
import { clearDeviceData, datedFileName, deviceDataProblem, downloadText, readDeviceData } from './deviceData'

// A new deploy removes old lazy chunks; a reload fetches the current ones.
const STALE_CHUNK_RE = /dynamically imported module|Importing a module script failed|error loading dynamically/i

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return null
}

const buttonBase = 'inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium'

/**
 * Last-resort screen. Uses no context, router or query hooks so it renders even when providers are broken.
 * In Mode Demo it offers to download or reset the raw data on this device (broken data is the usual cause).
 * `deviceDataBroken`: shown at start because the stored Mode Demo data cannot be opened.
 */
export function ErrorScreen({ error, deviceDataBroken = false }: { error: unknown; deviceDataBroken?: boolean }) {
  const isDemo = !isSupabaseConfigured
  const [confirmReset, setConfirmReset] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const message = errorMessage(error)
  const isStaleChunk = message !== null && STALE_CHUNK_RE.test(message)

  const download = () => {
    const raw = readDeviceData()
    if (!raw) {
      setNotice('Tidak ada data tersimpan di perangkat ini.')
      return
    }
    try {
      downloadText(raw, datedFileName('data-perangkat'))
      setNotice('Data diunduh. Simpan file ini baik-baik.')
    } catch {
      setNotice('Gagal mengunduh data.')
    }
  }

  const reset = () => {
    clearDeviceData()
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Terjadi kesalahan</h1>
        <p className="mt-2 text-sm text-slate-600">
          {deviceDataBroken
            ? 'Data di perangkat ini rusak, jadi aplikasi tidak bisa dibuka. Unduh data ini dulu, lalu reset.'
            : isStaleChunk
              ? 'Aplikasi baru saja diperbarui. Tekan Muat ulang.'
              : 'Aplikasi mengalami masalah. Coba muat ulang.'}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button type="button" onClick={() => window.location.reload()} className={`${buttonBase} bg-brand-700 text-white hover:bg-brand-800`}>
            Muat ulang
          </button>
          {!deviceDataBroken && (
            <a href={`${import.meta.env.BASE_URL}dashboard`} className={`${buttonBase} text-slate-700 hover:bg-slate-100`}>
              Buka Dashboard
            </a>
          )}
        </div>

        {isDemo && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            {!deviceDataBroken && <p className="text-sm text-slate-600">Jika masalah berulang, data di perangkat ini mungkin rusak.</p>}
            <div className="mt-3 flex flex-col gap-2">
              <button type="button" onClick={download} className={`${buttonBase} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>
                Unduh data perangkat ini
              </button>
              {confirmReset ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  <p>Semua data di perangkat ini dihapus dan diganti data contoh. Unduh data dulu bila masih diperlukan.</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={reset} className={`${buttonBase} flex-1 bg-red-600 text-white hover:bg-red-700`}>
                      Ya, reset
                    </button>
                    <button type="button" onClick={() => setConfirmReset(false)} className={`${buttonBase} flex-1 text-slate-700 hover:bg-white`}>
                      Batal
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmReset(true)} className={`${buttonBase} text-red-700 hover:bg-red-50`}>
                  Reset data di perangkat ini
                </button>
              )}
            </div>
          </div>
        )}

        {notice && (
          <p role="status" className="mt-3 text-sm text-slate-700">
            {notice}
          </p>
        )}

        {message && !isStaleChunk && (
          <details className="mt-4 text-xs text-slate-500">
            <summary className="cursor-pointer">Detail teknis</summary>
            <p className="mt-1 break-words font-mono">{message}</p>
          </details>
        )}
      </div>
    </div>
  )
}

interface BoundaryState {
  hasError: boolean
  error: unknown
}

/**
 * Mode Demo: when the data on this device cannot be opened, show the error screen (download / reset) instead of
 * the app, which would otherwise read it as empty and overwrite it with sample data. Checked once at start.
 */
export function DeviceDataGate({ children }: { children: ReactNode }) {
  const [problem] = useState(() => (isSupabaseConfigured ? null : deviceDataProblem(readDeviceData())))
  return problem ? <ErrorScreen error={new Error(problem)} deviceDataBroken /> : children
}

/** App-level boundary around all providers; route errors are caught by the router's errorElement first. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Woombad: unhandled render error', error, info.componentStack)
  }

  render() {
    return this.state.hasError ? <ErrorScreen error={this.state.error} /> : this.props.children
  }
}
