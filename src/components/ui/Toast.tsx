import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { clsx } from 'clsx'

type ToastKind = 'success' | 'error' | 'info'

/** An optional button on the toast ("Urungkan" after a delete); the toast closes when it is tapped. */
export interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
}
export interface ToastOptions {
  action?: ToastAction
  /** how long the toast stays (default 3.5 s, errors 6 s); a toast with an action gets 10 s */
  durationMs?: number
}

interface Toast {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind, options?: ToastOptions) => void
  success: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info', options?: ToastOptions) => {
      const id = ++counter.current
      setToasts((t) => [...t, { id, kind, message, action: options?.action }])
      const duration = options?.durationMs ?? (options?.action ? 10_000 : kind === 'error' ? 6000 : 3500)
      window.setTimeout(() => dismiss(id), duration)
    },
    [dismiss],
  )

  const value = useMemo<ToastContextValue>(
    () => ({ toast, success: (m, o) => toast(m, 'success', o), error: (m, o) => toast(m, 'error', o) }),
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
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    dismiss(t.id)
                    void t.action!.onClick()
                  }}
                  className="shrink-0 rounded px-1.5 py-0.5 font-semibold underline underline-offset-2 hover:bg-black/5"
                >
                  {t.action.label}
                </button>
              )}
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
