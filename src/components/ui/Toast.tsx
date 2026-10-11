import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { clsx } from 'clsx'

type ToastKind = 'success' | 'error' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++counter.current
      setToasts((t) => [...t, { id, kind, message }])
      window.setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500)
    },
    [dismiss],
  )

  const value = useMemo<ToastContextValue>(
    () => ({ toast, success: (m) => toast(m, 'success'), error: (m) => toast(m, 'error') }),
    [toast],
  )

  const icons = { success: CheckCircle2, error: AlertCircle, info: Info }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6">
        {toasts.map((t) => {
          const Icon = icons[t.kind]
          return (
            <div
              key={t.id}
              role="status"
              className={clsx(
                'pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg',
                t.kind === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
                t.kind === 'error' && 'border-red-200 bg-red-50 text-red-900',
                t.kind === 'info' && 'border-slate-200 bg-white text-slate-900',
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{t.message}</span>
              <button type="button" onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-600" aria-label="Tutup">
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
