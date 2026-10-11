import { PageHeader, EmptyState } from '../../components/ui'

export function ExpensesPage() {
  return (
    <>
      <PageHeader title="Pengeluaran" />
      <EmptyState title="Belum tersedia" description="Modul ini sedang dibangun." />
    </>
  )
}
