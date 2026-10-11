import type { RouteObject } from 'react-router'
import { TenantsPage } from './TenantsPage'
import { TenantDetailPage } from './TenantDetailPage'

export const tenantsRoutes: RouteObject[] = [
  { path: 'penyewa', element: <TenantsPage /> },
  { path: 'penyewa/:id', element: <TenantDetailPage /> },
]
