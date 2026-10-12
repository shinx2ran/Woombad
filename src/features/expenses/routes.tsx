import type { RouteObject } from 'react-router'

export const expensesRoutes: RouteObject[] = [
  { path: 'pengeluaran', lazy: () => import('./ExpensesPage').then((m) => ({ Component: m.ExpensesPage })) },
]
