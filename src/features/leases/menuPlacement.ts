const MENU_WIDTH = 224 // w-56
const MENU_GAP = 4
const MENU_EDGE = 8

/**
 * Where the menu goes on the screen (SPEC 7.28), from the trigger's box: under it, or above it when there is more room
 * there; its right (or left) edge on the trigger's, kept inside the screen. Its height is capped to the room it has.
 */
export function menuPlacement(
  trigger: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
  align: 'left' | 'right',
): { left: number; top?: number; bottom?: number; maxHeight: number } {
  const wanted = align === 'right' ? trigger.right - MENU_WIDTH : trigger.left
  const left = Math.max(MENU_EDGE, Math.min(wanted, viewport.width - MENU_WIDTH - MENU_EDGE))
  const below = viewport.height - trigger.bottom - MENU_GAP - MENU_EDGE
  const above = trigger.top - MENU_GAP - MENU_EDGE
  // under the trigger unless that leaves little room and above has more
  if (below >= 240 || below >= above) return { left, top: trigger.bottom + MENU_GAP, maxHeight: Math.max(120, below) }
  return { left, bottom: viewport.height - trigger.top + MENU_GAP, maxHeight: Math.max(120, above) }
}
