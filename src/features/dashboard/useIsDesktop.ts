import { useEffect, useState } from 'react'

const QUERY = '(min-width: 1024px)'

/** Tailwind `lg` breakpoint as a live boolean, so a heavy component (the chart) is mounted only once. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches === true)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(QUERY)
    const onChange = () => setIsDesktop(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}
