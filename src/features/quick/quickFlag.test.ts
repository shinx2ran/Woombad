// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QUICK_BUTTONS_KEY, quickButtonsEnabled, useQuickButtons } from './quickFlag'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('Tombol cepat switch (SPEC 7.4)', () => {
  it('is off with real data until switched on, and always on in Mode Demo', () => {
    expect(quickButtonsEnabled(false, null)).toBe(false)
    expect(quickButtonsEnabled(false, '0')).toBe(false)
    expect(quickButtonsEnabled(false, '1')).toBe(true)
    expect(quickButtonsEnabled(true, null)).toBe(true)
  })

  it('switching on and off is remembered on this device', () => {
    const { result } = renderHook(() => useQuickButtons(false))
    expect(result.current.enabled).toBe(false)
    act(() => result.current.setStored(true))
    expect(result.current.enabled).toBe(true)
    expect(localStorage.getItem(QUICK_BUTTONS_KEY)).toBe('1')
    act(() => result.current.setStored(false))
    expect(result.current.enabled).toBe(false)
    expect(localStorage.getItem(QUICK_BUTTONS_KEY)).toBeNull()
  })

  it('a second screen (Dashboard and Pengaturan) follows the switch', () => {
    const settings = renderHook(() => useQuickButtons(false))
    const dashboard = renderHook(() => useQuickButtons(false))
    act(() => settings.result.current.setStored(true))
    expect(dashboard.result.current.enabled).toBe(true)
  })
})
