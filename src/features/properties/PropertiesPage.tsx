import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Building2, ChevronRight, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  useToast,
} from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useRemove, useTable } from '../../hooks/useTable'
import { roomOccupancyByProperty, type OccupancySnapshot } from '../../domain/occupancy'
import { todayISO } from '../../lib/format'
import type { Property } from '../../types/db'
import { PropertyFormModal } from './PropertyFormModal'

export function PropertiesPage() {
  const { properties, role, propertyFilterIds, selectedPropertyId, refreshProperties } = useOrg()
  const toast = useToast()
  const isAdmin = role === 'owner' || role === 'admin'
  const rooms = useTable('rooms')
  const leases = useTable('leases')
  const remove = useRemove('properties', ['rooms'])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Property | null>(null)
  const [deleting, setDeleting] = useState<Property | null>(null)

  const today = todayISO()
  const visible = useMemo(
    () => properties.filter((p) => propertyFilterIds.includes(p.id)),
    [properties, propertyFilterIds],
  )
  const occupancy = useMemo(
    () => roomOccupancyByProperty(rooms.data ?? [], leases.data ?? [], today),
    [rooms.data, leases.data, today],
  )

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await remove.mutateAsync(deleting.id)
      await refreshProperties()
      toast.success(`Kos "${deleting.name}" dihapus.`)
      setDeleting(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus kos.')
    }
  }

  const totalRooms = (rooms.data ?? []).length

  return (
    <>
      <PageHeader
        title="Kos & Kamar"
        subtitle={
          properties.length > 0
            ? `${properties.length} kos · ${totalRooms} kamar`
            : 'Daftarkan kos Anda untuk mulai mengelola kamar.'
        }
        actions={
          isAdmin ? (
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              Tambah Kos
            </Button>
          ) : undefined
        }
      />

      {selectedPropertyId !== 'all' && properties.length > 1 && (
        <p className="mb-3 text-xs text-slate-500">
          Filter kos aktif: menampilkan {visible.length} dari {properties.length} kos. Pilih “Semua kos” di atas untuk melihat semuanya.
        </p>
      )}

      {rooms.isError ? (
        <ErrorState error={rooms.error} />
      ) : rooms.isPending || leases.isPending ? (
        <LoadingState />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title="Belum ada kos"
          description={isAdmin ? 'Tambahkan kos pertama Anda, lalu isi daftar kamarnya.' : 'Kos ditambahkan oleh pemilik atau admin.'}
          action={
            isAdmin ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                Tambah Kos
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <PropertyCard
              key={p.id}
              property={p}
              snapshot={occupancy.get(p.id)}
              isAdmin={isAdmin}
              onEdit={() => {
                setEditing(p)
                setFormOpen(true)
              }}
              onDelete={() => setDeleting(p)}
            />
          ))}
        </div>
      )}

      {isAdmin && <PropertyFormModal open={formOpen} property={editing} onClose={() => setFormOpen(false)} />}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={remove.isPending}
        title="Hapus kos?"
        message={
          <>
            Kos <strong>{deleting?.name}</strong> akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.
          </>
        }
      />
    </>
  )
}

function PropertyCard({
  property,
  snapshot,
  isAdmin,
  onEdit,
  onDelete,
}: {
  property: Property
  snapshot: OccupancySnapshot | undefined
  isAdmin: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const total = snapshot?.total ?? 0
  const canDelete = isAdmin && total === 0
  return (
    <Card className="flex flex-col">
      <Link to={`/kos/${property.id}`} className="group flex flex-1 flex-col gap-3 p-4 hover:bg-slate-50/70">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-slate-900 group-hover:text-brand-800">{property.name}</h3>
            <p className="mt-0.5 flex items-start gap-1 text-sm text-slate-500">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="line-clamp-2">{property.address ?? 'Alamat belum diisi'}</span>
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold tabular-nums text-slate-900">{total}</span>
          <span className="text-sm text-slate-500">kamar</span>
        </div>
        {total > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="success">{snapshot?.occupied ?? 0} terisi</Badge>
            {(snapshot?.reserved ?? 0) > 0 && <Badge tone="info">{snapshot?.reserved} dipesan</Badge>}
            <Badge tone="neutral">{snapshot?.available ?? 0} kosong</Badge>
            {(snapshot?.maintenance ?? 0) > 0 && <Badge tone="warning">{snapshot?.maintenance} perbaikan</Badge>}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Belum ada kamar. Buka kos untuk menambahkan.</p>
        )}
      </Link>
      {/* Kos (incl. payment_info used in WhatsApp reminders) is admin-only: SPEC 6.2. */}
      {isAdmin && (
        <div className="flex items-center justify-end gap-1 border-t border-slate-100 px-2 py-1.5">
          <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
            Ubah
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-700 hover:bg-red-50"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={onDelete}
            disabled={!canDelete}
            title={canDelete ? 'Hapus kos' : 'Hapus semua kamar terlebih dahulu sebelum menghapus kos.'}
          >
            Hapus
          </Button>
        </div>
      )}
    </Card>
  )
}
