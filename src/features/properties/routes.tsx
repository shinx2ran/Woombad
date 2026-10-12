import type { RouteObject } from 'react-router'

export const propertiesRoutes: RouteObject[] = [
  { path: 'kos', lazy: () => import('./PropertiesPage').then((m) => ({ Component: m.PropertiesPage })) },
  { path: 'kos/:propertyId', lazy: () => import('./PropertyDetailPage').then((m) => ({ Component: m.PropertyDetailPage })) },
]
