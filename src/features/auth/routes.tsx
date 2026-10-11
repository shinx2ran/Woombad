import type { RouteObject } from 'react-router'
import { LoginPage } from './LoginPage'
import { SignupPage } from './SignupPage'

export const authRoutes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/daftar', element: <SignupPage /> },
]
