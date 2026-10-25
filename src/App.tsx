import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// the react-dom build of RouterProvider honours `flushSync` on a navigation (the planner's inputs rely on it)
import { RouterProvider } from 'react-router/dom'
import { AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './components/ui'
import { router } from './app/routes'

const queryClient = new QueryClient({
  defaultOptions: {
    // 'always': without a connection requests fail at once with the network message instead of pausing silently
    // and replaying on reconnect (a save tapped twice offline would then create the row twice)
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
      networkMode: 'always',
    },
    mutations: {
      networkMode: 'always',
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
