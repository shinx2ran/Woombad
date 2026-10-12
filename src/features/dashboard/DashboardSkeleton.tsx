import { Card } from '../../components/ui'

function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} />
}

/** Grey placeholders in the shape of the dashboard while the six tables load. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Memuat dashboard">
      <div className="grid grid-cols-3 gap-2 sm:flex">
        <Block className="h-14 sm:h-10 sm:w-32" />
        <Block className="h-14 sm:h-10 sm:w-40" />
        <Block className="h-14 sm:h-10 sm:w-40" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <Block className="h-3 w-20" />
            <Block className="mt-3 h-7 w-28" />
            <Block className="mt-2 h-3 w-24" />
          </Card>
        ))}
        <Card className="col-span-2 p-4 md:col-span-4">
          <Block className="h-3 w-20" />
          <Block className="mt-3 h-7 w-36" />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <Block className="h-4 w-32" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="mt-4 space-y-2">
                <Block className="h-4 w-40" />
                <Block className="h-3 w-56" />
                <Block className="h-9 w-full" />
              </div>
            ))}
          </Card>
          <Card className="p-4">
            <Block className="h-4 w-32" />
            <Block className="mt-4 h-48 w-full" />
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="p-4">
            <Block className="h-4 w-32" />
            {[0, 1, 2].map((i) => (
              <Block key={i} className="mt-3 h-10 w-full" />
            ))}
          </Card>
          <Card className="p-4">
            <Block className="h-4 w-40" />
            {[0, 1, 2, 3].map((i) => (
              <Block key={i} className="mt-3 h-10 w-full" />
            ))}
          </Card>
        </div>
      </div>
      <span className="sr-only">Memuat…</span>
    </div>
  )
}
