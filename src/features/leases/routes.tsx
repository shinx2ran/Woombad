import type { RouteObject } from 'react-router'
import { LeasesPage } from './LeasesPage'
import { NewLeasePage } from './NewLeasePage'
import { LeaseDetailPage } from './LeaseDetailPage'

export const leasesRoutes: RouteObject[] = [
  { path: 'sewa', element: <LeasesPage /> },
  { path: 'sewa/baru', element: <NewLeasePage /> },
  { path: 'sewa/:id', element: <LeaseDetailPage /> },
]
