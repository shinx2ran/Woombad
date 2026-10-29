import { describe, expect, it } from 'vitest'
import { motionBetween, motionForHistory, pageDepth } from './pageMotion'

describe('pageDepth', () => {
  it('a section of the tabs is 1, a page opened from it deeper', () => {
    expect(pageDepth('/dashboard')).toBe(1)
    expect(pageDepth('/sewa')).toBe(1)
    expect(pageDepth('/sewa/abc')).toBe(2)
    expect(pageDepth('/sewa/baru')).toBe(2)
    expect(pageDepth('/kos/p1')).toBe(2)
    // not a section of their own: opened from the dashboard or the lease list
    expect(pageDepth('/rencana')).toBe(2)
    expect(pageDepth('/daftar-tunggu')).toBe(2)
    expect(pageDepth('/')).toBe(0)
  })
})

describe('motionBetween', () => {
  it('opening a page from a list or the dashboard pushes it', () => {
    expect(motionBetween('/sewa', '/sewa/abc')).toBe('push')
    expect(motionBetween('/dashboard', '/sewa/abc')).toBe('push')
    expect(motionBetween('/dashboard', '/rencana')).toBe('push')
    expect(motionBetween('/kos', '/kos/p1')).toBe('push')
  })

  it('a cross link between two opened pages pushes too', () => {
    expect(motionBetween('/sewa/abc', '/penyewa/t1')).toBe('push')
    expect(motionBetween('/rencana', '/daftar-tunggu')).toBe('push')
    expect(motionBetween('/sewa/baru', '/sewa/abc')).toBe('push')
  })

  it('going back up to the list of the same section pops', () => {
    expect(motionBetween('/sewa/abc', '/sewa')).toBe('pop')
    expect(motionBetween('/kos/p1', '/kos')).toBe('pop')
    expect(motionBetween('/sewa/abc/', '/sewa')).toBe('pop')
  })

  it('switching sections from the tabs crossfades, also from an opened page', () => {
    expect(motionBetween('/dashboard', '/sewa')).toBe('tab')
    expect(motionBetween('/laporan', '/pengaturan')).toBe('tab')
    expect(motionBetween('/sewa/abc', '/penyewa')).toBe('tab')
    expect(motionBetween('/rencana', '/dashboard')).toBe('tab')
  })

  it('login, sign-up and the root redirect crossfade', () => {
    expect(motionBetween('/login', '/dashboard')).toBe('tab')
    expect(motionBetween('/sewa/abc', '/login')).toBe('tab')
    expect(motionBetween('/', '/dashboard')).toBe('tab')
    expect(motionBetween('/gabung', '/pengaturan')).toBe('tab')
  })

  it('the same page (only the search params change) does not animate', () => {
    expect(motionBetween('/rencana', '/rencana')).toBe('none')
    expect(motionBetween('/laporan/', '/laporan')).toBe('none')
  })
})

describe('motionForHistory', () => {
  it('back plays the reverse of the step that led here', () => {
    // list → lease was a push: back from the lease pops it off
    expect(motionForHistory('/sewa/abc', '/sewa', 'back')).toBe('pop')
    expect(motionForHistory('/sewa/abc', '/dashboard', 'back')).toBe('pop')
    // lease → list link was a pop: going back to the lease brings it in again
    expect(motionForHistory('/sewa', '/sewa/abc', 'back')).toBe('push')
    expect(motionForHistory('/sewa', '/dashboard', 'back')).toBe('tab')
    expect(motionForHistory('/rencana', '/rencana', 'back')).toBe('none')
  })

  it('forward replays the step', () => {
    expect(motionForHistory('/sewa', '/sewa/abc', 'forward')).toBe('push')
    expect(motionForHistory('/sewa/abc', '/sewa', 'forward')).toBe('pop')
  })
})
