import type { RouteObject } from 'react-router'

export const tenantsRoutes: RouteObject[] = [
  { path: 'penyewa', lazy: () => import('./TenantsPage').then((m) => ({ Component: m.TenantsPage })) },
  { path: 'penyewa/:id', lazy: () => import('./TenantDetailPage').then((m) => ({ Component: m.TenantDetailPage })) },
]
