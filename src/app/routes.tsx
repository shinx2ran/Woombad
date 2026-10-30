import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { LoadingState } from '../components/ui'
import { AppShell } from './AppShell'
import { AuthGate, GuestOnly } from './AuthGate'
import { authRoutes } from '../features/auth/routes'
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage'
import { JoinLinkPage } from '../features/auth/JoinLinkPage'
import { dashboardRoutes } from '../features/dashboard/routes'
import { propertiesRoutes } from '../features/properties/routes'
import { tenantsRoutes } from '../features/tenants/routes'
import { leasesRoutes } from '../features/leases/routes'
import { rencanaRoutes } from '../features/rencana/routes'
import { expensesRoutes } from '../features/expenses/routes'
import { reportsRoutes } from '../features/reports/routes'
import { settingsRoutes } from '../features/settings/routes'
import { NotFoundPage } from './NotFoundPage'
import { RouteErrorPage } from './RouteErrorPage'
import { BootSplashHold } from './BootSplash'
import { installPageTransitions, seedHistoryKey } from './pageTransitions'

/**
 * Route table. Each feature exports its own `RouteObject[]` from `src/features/<name>/routes.tsx`
 * (paths are relative to "/"), so modules can add sub-routes without touching this file.
 */
const routes: RouteObject[] = [
  {
    element: <GuestOnly />,
    children: authRoutes,
  },
  // Reachable both from a recovery link (signed in with a recovery session) and from settings.
  { path: '/reset-sandi', element: <ResetPasswordPage /> },
  // Invitation links: /gabung?kode=ABCD-EFGH (works signed in or out).
  { path: '/gabung', element: <JoinLinkPage /> },
  {
    element: <AuthGate />,
    children: [
      {
        element: <AppShell />,
        // a deep link to a page still loading its code at start-up: the boot splash stays meanwhile (SPEC 7.10)
        hydrateFallbackElement: (
          <>
            <BootSplashHold />
            <LoadingState />
          </>
        ),
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          ...dashboardRoutes,
          ...propertiesRoutes,
          ...tenantsRoutes,
          ...leasesRoutes,
          ...rencanaRoutes,
          ...expensesRoutes,
          ...reportsRoutes,
          ...settingsRoutes,
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

// BASE_URL is '/' for root hosting or '/Woombad/' on GitHub Pages; react-router wants it without the trailing slash.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

// a unique history key for a freshly opened page, so it never takes another page's scroll position (pageTransitions.ts)
seedHistoryKey()

// The pathless root gives every route one error screen; AppErrorBoundary (main.tsx) covers the providers.
export const router = createBrowserRouter([{ errorElement: <RouteErrorPage />, children: routes }], { basename })

// pages slide / fade when they change (SPEC 7.9)
installPageTransitions(router)
