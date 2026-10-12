import { useMemo, useState } from 'react'
import { Info, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingState, useToast } from '../../components/ui'
import { useRemove, useTable } from '../../hooks/useTable'
import { formatRupiah } from '../../lib/format'
import { ADDON_BILLING_LABEL, type AddonCatalogItem, type Property } from '../../types/db'
import { AddonFormModal } from './AddonFormModal'

/**
 * Add-on catalogue for this kos plus org-wide entries (property_id null, shown as "Semua kos"). The catalogue is a
 * price list, so only owners/admins change it (SPEC 6.2); staff see it read-only.
 */
export function AddonsTab({ property, isAdmin }: { property: Property; isAdmin: boolean }) {
  const toast = useToast()
  const catalog = useTable('addon_catalog')
  const remove = useRemove('addon_catalog')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AddonCatalogItem | null>(null)
  const [deleting, setDeleting] = useState<AddonCatalogItem | null>(null)

  const items = useMemo(
    () =>
      (catalog.data ?? [])
        .filter((a) => a.property_id === null || a.property_id === property.id)
        .sort((a, b) => {
          // this kos first, then org-wide; alphabetical inside each group
          if ((a.property_id === null) !== (b.property_id === null)) return a.property_id === null ? 1 : -1
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        }),
    [catalog.data, property.id],
  )

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await remove.mutateAsync(deleting.id)
      toast.success(`Add-on "${deleting.name}" dihapus dari katalog.`)
      setDeleting(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus add-on.')
    }
  }

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  if (catalog.isError) return <ErrorState error={catalog.error} />
  if (catalog.isPending) return <LoadingState />

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {items.length} add-on tersedia
        </p>
        {isAdmin && (
          <Button size="sm" className="shrink-0 whitespace-nowrap" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            Tambah Add-on
          </Button>
        )}
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {isAdmin
          ? 'Katalog hanya menjadi pilihan saat membuat sewa. Mengubah atau menghapus add-on di sini tidak mengubah add-on pada sewa yang sudah berjalan.'
          : 'Katalog hanya menjadi pilihan saat membuat sewa. Hanya pemilik/admin yang dapat mengubah katalog dan harganya.'}
      </p>

      {items.length === 0 ? (
        <EmptyState
          icon={<Package className="h-10 w-10" />}
          title="Belum ada add-on"
          description="Contoh add-on: kasur tambahan, parkir motor, laundry, kunci cadangan."
          action={
            isAdmin ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                Tambah Add-on
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {items.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{a.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="font-semibold tabular-nums text-slate-800">{formatRupiah(a.default_price)}</span>
                    <span>· {ADDON_BILLING_LABEL[a.billing]}</span>
                    {a.property_id === null ? <Badge tone="brand">Semua kos</Badge> : <Badge tone="neutral">{property.name}</Badge>}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Pencil className="h-4 w-4" />}
                      aria-label={`Ubah ${a.name}`}
                      onClick={() => {
                        setEditing(a)
                        setFormOpen(true)
                      }}
                    >
                      <span className="hidden sm:inline">Ubah</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-700 hover:bg-red-50"
                      icon={<Trash2 className="h-4 w-4" />}
                      aria-label={`Hapus ${a.name}`}
                      onClick={() => setDeleting(a)}
                    >
                      <span className="hidden sm:inline">Hapus</span>
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isAdmin && <AddonFormModal open={formOpen} property={property} addon={editing} onClose={() => setFormOpen(false)} />}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={remove.isPending}
        title="Hapus add-on dari katalog?"
        message={
          <>
            <strong>{deleting?.name}</strong> tidak akan ditawarkan lagi saat membuat sewa baru. Add-on pada sewa yang sudah berjalan tetap ada.
          </>
        }
      />
    </div>
  )
}
