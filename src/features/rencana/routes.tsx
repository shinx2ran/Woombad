import type { RouteObject } from 'react-router'

// Rencana check-in & daftar tunggu (SPEC 7.7); lazy like the lease screens.
export const rencanaRoutes: RouteObject[] = [
  { path: 'rencana', lazy: () => import('./PlannerPage').then((m) => ({ Component: m.PlannerPage })) },
  { path: 'daftar-tunggu', lazy: () => import('./WaitlistPage').then((m) => ({ Component: m.WaitlistPage })) },
]
