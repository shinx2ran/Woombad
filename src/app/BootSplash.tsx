import { useEffect, useLayoutEffect } from 'react'
import { bootSplashReady, holdBootSplash } from './bootSplash'

/** Rendered by a loading screen: the boot splash stays while it is up (bootSplash.ts). */
export function BootSplashHold() {
  useLayoutEffect(() => holdBootSplash(), [])
  return null
}

/** Rendered once at the root: after the app's first render, a splash nobody holds goes. */
export function BootSplashReady() {
  useEffect(() => bootSplashReady(), [])
  return null
}
