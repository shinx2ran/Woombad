import { Component, useEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { clsx } from 'clsx'
import { useDirtyWhile } from '../../app/dirtyState'
import { fitToVisibleArea, revealFocusedField } from './keyboardSafe'
import { EASE_IOS, EASE_OUT_QUICK, EXIT_MS, copyForExit, prepareExitStyles, type ExitCopy } from './motion'

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
 * It slides up (sheet) or fades in (dialog) when it opens (index.css) and slides down / fades out when it closes,
 * however it closes (ExitAnimation, SPEC 7.9).
 */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  useDirtyWhile(open)
  const overlayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !overlayRef.current) return
    prepareExitStyles()
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

  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }
  // while the sheet is still rising the dimming already covers the screen: the second tap of a double tap on the
  // button that opened it would land there and close it again (iOS ignores taps on a sheet that is still presenting)
  const onBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    const panel = event.currentTarget.nextElementSibling
    if (panel?.getAnimations?.().some((a) => a.playState === 'running')) return
    onClose()
  }
  return (
    <ExitAnimation show={open} nodeRef={overlayRef}>
      {open && (
        // `group` + data-compact (set by fitToVisibleArea when little is visible): the whole sheet scrolls as one
        <div ref={overlayRef} className="group fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
          {/* fixed, not absolute: still dims the whole page while the overlay is pinned above the keyboard;
              touch-pinch-zoom here and on the title and button rows: a drag there must not pan the page under the keyboard */}
          <div className="modal-backdrop fixed inset-0 touch-pinch-zoom bg-slate-900/40" onClick={onBackdropClick} />
          <div
            className={clsx(
              'modal-panel relative flex max-h-[92%] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl',
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
      )}
    </ExitAnimation>
  )
}

/** a closing dialog stays below one that opens as it closes (a confirmation after a form, say) */
const DIALOG_EXIT_LAYER = 49

/** Sheets (phones) slide down, dialogs (from the sm breakpoint) fade and shrink a little, quickly; the dimming fades with them. */
function animateDialogExit(copy: HTMLElement): Animation[] {
  const sheet = !window.matchMedia?.('(min-width: 640px)')?.matches
  // the dimming leaves on the panel's own timing, as on iOS
  const timing: KeyframeAnimationOptions = sheet
    ? { duration: EXIT_MS.sheet, easing: EASE_IOS, fill: 'forwards' }
    : { duration: EXIT_MS.dialog, easing: EASE_OUT_QUICK, fill: 'forwards' }
  const animations: Animation[] = []
  const backdrop = copy.querySelector<HTMLElement>('.modal-backdrop')
  const panel = copy.querySelector<HTMLElement>('.modal-panel')
  if (backdrop) animations.push(backdrop.animate([{ opacity: 1 }, { opacity: 0 }], timing))
  if (panel) {
    // a sheet closed while the keyboard was up was pinned above it (keyboardSafe): it slides all the way past the
    // bottom of the screen, not just its own height, or it would stay in view once the keyboard drops
    const below = Math.max(0, document.documentElement.clientHeight - panel.getBoundingClientRect().bottom)
    const frames = sheet
      ? [{ transform: 'translateY(0)' }, { transform: `translateY(calc(100% + ${Math.round(below)}px))` }]
      : [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.98)' },
        ]
    animations.push(panel.animate(frames, timing))
  }
  return animations
}

/**
 * Plays the exit of the dialog it wraps: React gives no chance to animate an element it removes, so just before the
 * removal (the dialog closing, or the whole component that holds it going away) a copy is taken (motion.ts).
 */
class ExitAnimation extends Component<{ show: boolean; nodeRef: RefObject<HTMLDivElement | null>; children: ReactNode }, object, ExitCopy | null> {
  getSnapshotBeforeUpdate(prev: { show: boolean }): ExitCopy | null {
    return prev.show && !this.props.show ? copyForExit(this.props.nodeRef.current, animateDialogExit, DIALOG_EXIT_LAYER) : null
  }

  componentDidUpdate(_prev: unknown, _state: unknown, exit: ExitCopy | null) {
    exit?.play()
  }

  componentWillUnmount() {
    if (!this.props.show) return
    const exit = copyForExit(this.props.nodeRef.current, animateDialogExit, DIALOG_EXIT_LAYER)
    // the dialog is still on the page during this call; it is gone once React finishes, before the next paint
    if (exit) queueMicrotask(exit.play)
  }

  render() {
    return this.props.children
  }
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
