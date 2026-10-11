import { PageHeader, EmptyState } from '../../components/ui'

export function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <EmptyState title="Belum tersedia" description="Modul ini sedang dibangun." />
    </>
  )
}
