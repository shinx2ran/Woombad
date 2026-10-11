import type { RouteObject } from 'react-router'

export const settingsRoutes: RouteObject[] = [
  { path: 'pengaturan', lazy: () => import('./SettingsPage').then((m) => ({ Component: m.SettingsPage })) },
]
