import type { MouseEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { previousPathname } from './pageTransitions'

/**
 * "← Semua sewa": when the list is the page before this one in history, the link goes back to it (as the phone's
 * back does: the page pops off, the list returns where it was scrolled, history does not grow); otherwise it opens
 * the list (SPEC 7.9).
 */
export function BackLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const navigate = useNavigate()
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // a new tab / window keeps the plain link
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (previousPathname() !== to) return
    event.preventDefault()
    void navigate(-1)
  }
  return (
    <Link to={to} className={className} onClick={onClick}>
      {children}
    </Link>
  )
}
