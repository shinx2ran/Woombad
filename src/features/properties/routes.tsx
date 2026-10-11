import type { RouteObject } from 'react-router'
import { PropertiesPage } from './PropertiesPage'
import { PropertyDetailPage } from './PropertyDetailPage'

export const propertiesRoutes: RouteObject[] = [
  { path: 'kos', element: <PropertiesPage /> },
  { path: 'kos/:propertyId', element: <PropertyDetailPage /> },
]
