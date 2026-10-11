import { useMemo, useState } from 'react'
import { CheckSquare, DoorOpen, Plus, Tags, X } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, LoadingState } from '../../components/ui'
import { useTable } from '../../hooks/useTable'
import { roomOccupancy } from '../../domain/occupancy'
import { todayISO } from '../../lib/format'
import type { Property, Room } from '../../types/db'
import { roomDisplayState, sortRoomsNatural, type RoomDisplayState } from './roomUtils'
import { RoomCard } from './RoomCard'
import { RoomSheet } from './RoomSheet'
import { RoomFormModal } from './RoomFormModal'
import { BulkPriceModal } from './BulkPriceModal'

export interface RoomWithState {
  room: Room
  state: RoomDisplayState
  /** true when any lease (any status) ever referenced the room: it cannot be deleted */
  hasLeases: boolean
}

export function RoomsTab({ property }: { property: Property }) {
  const rooms = useTable('rooms', { where: { property_id: property.id } })
  // Leases/invoices/payments/tenants are tiny tables; load them whole and filter in memory.
  const leases = useTable('leases')
  const tenants = useTable('tenants')
  const invoices = useTable('invoices')
  const payments = useTable('payments')

  const [sheetRoomId, setSheetRoomId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Room | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)

  const today = todayISO()

  const items = useMemo<RoomWithState[]>(() => {
    const tenantsById = new Map((tenants.data ?? []).map((t) => [t.id, t]))
    const allLeases = leases.data ?? []
    const roomIds = new Set((rooms.data ?? []).map((r) => r.id))
    const relevantLeases = allLeases.filter((l) => roomIds.has(l.room_id))
    const leaseIds = new Set(relevantLeases.map((l) => l.id))
    const relevantInvoices = (invoices.data ?? []).filter((i) => leaseIds.has(i.lease_id))
    const relevantPayments = (payments.data ?? []).filter((p) => p.lease_id !== null && leaseIds.has(p.lease_id))
    return sortRoomsNatural(rooms.data ?? []).map((room) => ({
      room,
      state: roomDisplayState(room, relevantLeases, tenantsById, relevantInvoices, relevantPayments, today),
      hasLeases: relevantLeases.some((l) => l.room_id === room.id),
    }))
  }, [rooms.data, leases.data, tenants.data, invoices.data, payments.data, today])

  const snapshot = useMemo(() => roomOccupancy(rooms.data ?? [], leases.data ?? [], today), [rooms.data, leases.data, today])

  const sheetItem = sheetRoomId ? items.find((i) => i.room.id === sheetRoomId) ?? null : null
  const selectedRooms = items.filter((i) => selected.has(i.room.id)).map((i) => i.room)

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const exitSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  if (rooms.isError) return <ErrorState error={rooms.error} />
  if (rooms.isPending || leases.isPending || tenants.isPending || invoices.isPending || payments.isPending) return <LoadingState />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {selecting ? (
          <div className="flex items-center gap-1 text-sm">
            <span className="font-medium text-slate-700">{selected.size} dipilih</span>
            <span className="text-slate-400">·</span>
            <button
              type="button"
              className="font-medium text-brand-700 hover:underline"
              onClick={() => setSelected(new Set(items.map((i) => i.room.id)))}
            >
              Pilih semua
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="success">{snapshot.occupied} terisi</Badge>
            {snapshot.reserved > 0 && <Badge tone="info">{snapshot.reserved} dipesan</Badge>}
            <Badge tone="neutral">{snapshot.available} kosong</Badge>
            {snapshot.maintenance > 0 && <Badge tone="warning">{snapshot.maintenance} perbaikan</Badge>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {selecting ? (
            <>
              <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={exitSelecting}>
                Batal
              </Button>
              <Button size="sm" icon={<Tags className="h-4 w-4" />} disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
                Ubah harga ({selected.size})
              </Button>
            </>
          ) : (
            <>
              {items.length > 0 && (
                <Button variant="outline" size="sm" icon={<CheckSquare className="h-4 w-4" />} onClick={() => setSelecting(true)}>
                  Ubah harga massal
                </Button>
              )}
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                Tambah Kamar
              </Button>
            </>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<DoorOpen className="h-10 w-10" />}
          title="Belum ada kamar"
          description="Tambahkan kamar satu per satu atau sekaligus (mis. A1 sampai A6) dengan harga yang sama."
          action={
            <Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              Tambah Kamar
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => (
            <RoomCard
              key={item.room.id}
              item={item}
              selecting={selecting}
              selected={selected.has(item.room.id)}
              onClick={() => (selecting ? toggleSelect(item.room.id) : setSheetRoomId(item.room.id))}
            />
          ))}
        </div>
      )}

      <RoomSheet
        item={sheetItem}
        open={sheetItem !== null}
        onClose={() => setSheetRoomId(null)}
        onEdit={(room) => {
          setSheetRoomId(null)
          setEditing(room)
          setFormOpen(true)
        }}
      />

      <RoomFormModal
        open={formOpen}
        property={property}
        room={editing}
        existingRooms={rooms.data ?? []}
        onClose={() => setFormOpen(false)}
      />

      <BulkPriceModal
        open={bulkOpen}
        rooms={selectedRooms}
        onClose={() => setBulkOpen(false)}
        onDone={() => {
          setBulkOpen(false)
          exitSelecting()
        }}
      />
    </div>
  )
}
