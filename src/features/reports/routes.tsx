import type { RouteObject } from 'react-router'

// Lazy: recharts and the XLSX writer load only when the report is opened.
export const reportsRoutes: RouteObject[] = [
  { path: 'laporan', lazy: () => import('./ReportsPage').then((m) => ({ Component: m.ReportsPage })) },
]
