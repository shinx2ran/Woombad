import { useCallback, useState } from 'react'
import { ATTENTION_SORT_STORAGE_KEY, parseAttentionSort, type AttentionSort } from './dashboardModel'

function readStoredSort(): AttentionSort {
  try {
    return parseAttentionSort(localStorage.getItem(ATTENTION_SORT_STORAGE_KEY))
  } catch {
    return 'date'
  }
}

/** The "Perlu perhatian" row order, remembered per device in localStorage (falls back to 'date' when storage is blocked). */
export function useAttentionSort(): [AttentionSort, (sort: AttentionSort) => void] {
  const [sort, setSortState] = useState<AttentionSort>(readStoredSort)
  const setSort = useCallback((next: AttentionSort) => {
    setSortState(next)
    try {
      localStorage.setItem(ATTENTION_SORT_STORAGE_KEY, next)
    } catch {
      // Storage unavailable (private mode): the choice still applies for this visit.
    }
  }, [])
  return [sort, setSort]
}
