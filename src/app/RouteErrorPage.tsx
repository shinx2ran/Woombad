import { isRouteErrorResponse, useRouteError } from 'react-router'
import { ErrorScreen } from '../components/ErrorBoundary'

/** Router errorElement: render errors inside any route (and failed lazy route loads) land here. */
export function RouteErrorPage() {
  const error = useRouteError()
  if (isRouteErrorResponse(error)) return <ErrorScreen error={new Error(`${error.status} ${error.statusText}`)} />
  return <ErrorScreen error={error} />
}
