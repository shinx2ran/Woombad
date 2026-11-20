import type { RouteObject } from 'react-router'

export const tanyaRoutes: RouteObject[] = [{ path: 'tanya', lazy: () => import('./TanyaAiPage').then((m) => ({ Component: m.TanyaAiPage })) }]
