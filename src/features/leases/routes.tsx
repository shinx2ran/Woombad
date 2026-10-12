import type { RouteObject } from 'react-router'

// Lazy routes keep the heavy lease screens out of the initial bundle.
export const leasesRoutes: RouteObject[] = [
  { path: 'sewa', lazy: () => import('./LeasesPage').then((m) => ({ Component: m.LeasesPage })) },
  { path: 'sewa/baru', lazy: () => import('./NewLeasePage').then((m) => ({ Component: m.NewLeasePage })) },
  { path: 'sewa/:id', lazy: () => import('./LeaseDetailPage').then((m) => ({ Component: m.LeaseDetailPage })) },
]
