import { describe, expect, it } from 'vitest'
import { menuPlacement } from './menuPlacement'

// SPEC 7.28: the action menu is placed on the screen from the trigger's box (the menu is 224 wide)
describe('menuPlacement', () => {
  const tablet = { width: 820, height: 1180 }

  it('opens under the trigger, its right edge on the trigger\'s', () => {
    expect(menuPlacement({ top: 300, bottom: 332, left: 760, right: 792 }, tablet, 'right')).toEqual({ left: 568, top: 336, maxHeight: 836 })
  })

  it('opens above when the trigger sits near the bottom of the screen', () => {
    const p = menuPlacement({ top: 1100, bottom: 1132, left: 760, right: 792 }, tablet, 'right')
    expect(p.top).toBeUndefined()
    expect(p.bottom).toBe(1180 - 1100 + 4)
    expect(p.maxHeight).toBe(1100 - 4 - 8)
  })

  it('stays inside the screen on a phone, on either side', () => {
    const phone = { width: 360, height: 780 }
    expect(menuPlacement({ top: 100, bottom: 130, left: 20, right: 60 }, phone, 'right').left).toBe(8)
    expect(menuPlacement({ top: 100, bottom: 130, left: 300, right: 340 }, phone, 'left').left).toBe(360 - 224 - 8)
  })
})
