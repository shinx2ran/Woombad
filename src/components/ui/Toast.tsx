import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { clsx } from 'clsx'
import { EXIT_MS, copyForExit, type ExitCopy } from './motion'

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
  const nodes = useRef(new Map<number, HTMLDivElement>())
  const exits = useRef<ExitCopy[]>([])

  const dismiss = useCallback((id: number) => {
    const exit = copyToastForExit(nodes.current.get(id))
    if (exit) exits.current.push(exit)
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])
  // a dismissed toast fades away (on a copy, motion.ts) once React has taken it off the page
  useLayoutEffect(() => {
    const pending = exits.current
    exits.current = []
    for (const exit of pending) exit.play()
  }, [toasts])

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
      <div className="app-toasts pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6">
        {toasts.map((t) => {
          const Icon = icons[t.kind]
          return (
            <div
              key={t.id}
              ref={(el) => {
                if (el) nodes.current.set(t.id, el)
                return () => {
                  nodes.current.delete(t.id)
                }
              }}
              role="status"
              className={clsx(
                'toast-item pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg',
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

/** The toast's copy keeps its place on screen (it leaves the list) and fades up and away. */
function copyToastForExit(el: HTMLDivElement | undefined): ExitCopy | null {
  if (!el || !el.isConnected) return null
  const rect = el.getBoundingClientRect()
  return copyForExit(el, (copy) => {
    Object.assign(copy.style, { position: 'fixed', top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, margin: '0' })
    const frames = [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-8px)' },
    ]
    return [copy.animate(frames, { duration: EXIT_MS.toast, easing: 'ease-in', fill: 'forwards' })]
  }, 60)
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
