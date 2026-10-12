import type { RouteObject } from 'react-router'

/**
 * The scanner is a shared component (DocumentScanner) embedded by the tenants form and the new-lease
 * wizard; it has no page of its own. Exported so the app route table can include it like every module.
 */
export const scannerRoutes: RouteObject[] = []
