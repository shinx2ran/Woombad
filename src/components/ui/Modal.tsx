import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { clsx } from 'clsx'
import { useDirtyWhile } from '../../app/dirtyState'
import { fitToVisibleArea, revealFocusedField } from './keyboardSafe'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Bottom-sheet on mobile, centered dialog on desktop. An open dialog holds back automatic app updates (dirtyState).
 * While the on-screen keyboard is open the dialog fits above it and keeps the field being typed in visible (keyboardSafe).
 */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  useDirtyWhile(open)
  const overlayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !overlayRef.current) return
    return fitToVisibleArea(overlayRef.current)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }
  return (
    // `group` + data-compact (set by fitToVisibleArea when little is visible): the whole sheet scrolls as one
    <div ref={overlayRef} className="group fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      {/* fixed, not absolute: still dims the whole page while the overlay is pinned above the keyboard;
          touch-pinch-zoom here and on the title and button rows: a drag there must not pan the page under the keyboard */}
      <div className="fixed inset-0 touch-pinch-zoom bg-slate-900/40" onClick={onClose} />
      <div
        className={clsx(
          'relative flex max-h-[92%] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl',
          'group-data-compact:max-h-full group-data-compact:overflow-y-auto group-data-compact:overscroll-contain',
          widths[size],
        )}
      >
        <div className="flex shrink-0 touch-pinch-zoom items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Tutup">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 group-data-compact:flex-none group-data-compact:overflow-visible"
          // a field tapped while the keyboard is already open (or half hidden at the bottom) is brought into view
          onFocus={() => requestAnimationFrame(() => overlayRef.current && revealFocusedField(overlayRef.current))}
        >
          {children}
        </div>
        {footer && <div className="flex shrink-0 touch-pinch-zoom justify-end gap-2 border-t border-slate-100 px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Hapus',
  cancelLabel = 'Batal',
  danger = true,
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: ReactNode
  confirmLabel?: string
  /** null hides the cancel button (informational dialogs with a single action) */
  cancelLabel?: string | null
  danger?: boolean
  loading?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          {cancelLabel !== null && (
            <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-medium text-slate-700 hover:bg-slate-100">
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={clsx(
              'h-10 rounded-lg px-4 text-sm font-medium text-white disabled:opacity-60',
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-700 hover:bg-brand-800',
            )}
          >
            {loading ? 'Memproses…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-slate-700">{message}</div>
    </Modal>
  )
}
