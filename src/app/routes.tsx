import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AppShell } from './AppShell'
import { AuthGate, GuestOnly } from './AuthGate'
import { authRoutes } from '../features/auth/routes'
import { dashboardRoutes } from '../features/dashboard/routes'
import { propertiesRoutes } from '../features/properties/routes'
import { tenantsRoutes } from '../features/tenants/routes'
import { leasesRoutes } from '../features/leases/routes'
import { expensesRoutes } from '../features/expenses/routes'
import { reportsRoutes } from '../features/reports/routes'
import { settingsRoutes } from '../features/settings/routes'
import { NotFoundPage } from './NotFoundPage'

/**
 * Route table. Each feature exports its own `RouteObject[]` from `src/features/<name>/routes.tsx`
 * (paths are relative to "/"), so modules can add sub-routes without touching this file.
 */
const routes: RouteObject[] = [
  {
    element: <GuestOnly />,
    children: authRoutes,
  },
  {
    element: <AuthGate />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          ...dashboardRoutes,
          ...propertiesRoutes,
          ...tenantsRoutes,
          ...leasesRoutes,
          ...expensesRoutes,
          ...reportsRoutes,
          ...settingsRoutes,
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
