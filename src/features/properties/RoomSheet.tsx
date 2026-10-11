import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AlertTriangle, Copy, ExternalLink, KeyRound, Pencil, Trash2, Wrench } from 'lucide-react'
import { Button, ConfirmDialog, Modal, useToast } from '../../components/ui'
import { useRemove, useUpdate } from '../../hooks/useTable'
import { formatDate, formatRupiah } from '../../lib/format'
import { PERIOD_TYPE_LABEL, PERIOD_UNIT_LABEL, type Room } from '../../types/db'
import type { RoomWithState } from './RoomsTab'
import { RoomStateBadge } from './RoomCard'

function PriceRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-slate-900">{value ? formatRupiah(value) : '—'}</span>
    </div>
  )
}

/** Detail sheet for one room: prices, current occupant, and actions. */
export function RoomSheet({
  item,
  open,
  onClose,
  onEdit,
}: {
  item: RoomWithState | null
  open: boolean
  onClose: () => void
  onEdit: (room: Room) => void
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const update = useUpdate('rooms')
  const remove = useRemove('rooms')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmMaintenance, setConfirmMaintenance] = useState(false)

  if (!item) return null
  const { room, state, hasLeases } = item
  const isMaintenance = room.status === 'maintenance'
  const occupantName = state.tenant?.full_name ?? 'Penyewa'

  const applyMaintenance = async () => {
    try {
      await update.mutateAsync({ id: room.id, patch: { status: isMaintenance ? 'active' : 'maintenance' } })
      toast.success(isMaintenance ? `Kamar ${room.name} aktif kembali.` : `Kamar ${room.name} ditandai perbaikan.`)
      setConfirmMaintenance(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status kamar.')
    }
  }

  /** Marking a room that still has a tenant (or a booking) as under repair needs an explicit confirmation. */
  const toggleMaintenance = () => {
    if (!isMaintenance && state.occupancy !== null) setConfirmMaintenance(true)
    else void applyMaintenance()
  }

  const doDelete = async () => {
    try {
      await remove.mutateAsync(room.id)
      toast.success(`Kamar ${room.name} dihapus.`)
      setConfirmDelete(false)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus kamar.')
    }
  }

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(room.id)
      toast.success('ID kamar disalin.')
    } catch {
      toast.error('Tidak dapat menyalin. Salin ID secara manual.')
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={
          <span className="flex items-center gap-2">
            Kamar {room.name}
            <RoomStateBadge kind={state.kind} />
            {state.kind === 'maintenance' && state.occupancy && <RoomStateBadge kind={state.occupancy} />}
          </span>
        }
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-red-700 hover:bg-red-50 disabled:text-slate-400"
              icon={<Trash2 className="h-4 w-4" />}
              disabled={hasLeases}
              onClick={() => setConfirmDelete(true)}
              title={hasLeases ? 'Kamar yang pernah disewa tidak dapat dihapus.' : 'Hapus kamar'}
            >
              Hapus
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" icon={<Wrench className="h-4 w-4" />} onClick={toggleMaintenance} loading={update.isPending}>
                {isMaintenance ? 'Aktifkan kembali' : 'Tandai perbaikan'}
              </Button>
              <Button variant="outline" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(room)}>
                Ubah
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Lantai</dt>
              <dd className="font-medium text-slate-900">{room.floor ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Status kamar</dt>
              <dd className="font-medium text-slate-900">
                {!isMaintenance
                  ? 'Aktif'
                  : state.occupancy === 'occupied'
                    ? 'Perbaikan (masih dihuni)'
                    : state.occupancy === 'reserved'
                      ? 'Perbaikan (sudah dipesan)'
                      : 'Perbaikan (tidak disewakan)'}
              </dd>
            </div>
          </dl>

          <section>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Harga default</h4>
            <div className="space-y-1.5">
              <PriceRow label="Bulanan" value={room.price_monthly} />
              <PriceRow label="Mingguan" value={room.price_weekly} />
              <PriceRow label="Harian" value={room.price_daily} />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-3">
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Penghuni</h4>
            {isMaintenance && state.occupancy !== null && (
              <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  Kamar ditandai perbaikan, tetapi {state.occupancy === 'occupied' ? 'masih dihuni dan sewanya tetap berjalan' : 'sudah dipesan'}.
                  Penyewa tetap tampil di sini.
                </span>
              </p>
            )}
            {state.occupancy === 'occupied' && state.lease && (
              <div className="space-y-1 text-sm">
                <p className="font-medium text-slate-900">{state.tenant?.full_name ?? 'Penyewa'}</p>
                <p className="text-slate-600">
                  Sewa {PERIOD_TYPE_LABEL[state.lease.period_type].toLowerCase()} · {formatRupiah(state.lease.price_per_period)} /{' '}
                  {PERIOD_UNIT_LABEL[state.lease.period_type]}
                </p>
                <p className="text-slate-600">
                  Mulai {formatDate(state.lease.start_date)} · s/d {formatDate(state.lease.end_date)}
                </p>
                <p className="text-slate-600">
                  {state.paidThrough ? `Dibayar s/d ${formatDate(state.paidThrough)}` : 'Belum ada pembayaran tercatat'}
                  {state.outstanding > 0 && <span className="ml-1 font-medium text-amber-700">· Sisa tagihan {formatRupiah(state.outstanding)}</span>}
                </p>
                <Link to={`/sewa/${state.lease.id}`} className="inline-flex items-center gap-1 pt-1 font-medium text-brand-700 hover:underline">
                  Lihat sewa <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            )}
            {state.occupancy === 'reserved' && state.lease && (
              <div className="space-y-1 text-sm">
                <p className="font-medium text-slate-900">{state.tenant?.full_name ?? 'Penyewa'}</p>
                <p className="text-slate-600">Dipesan, sewa mulai {formatDate(state.startDate)}</p>
                <Link to={`/sewa/${state.lease.id}`} className="inline-flex items-center gap-1 pt-1 font-medium text-brand-700 hover:underline">
                  Lihat sewa <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            )}
            {state.kind === 'vacant' && (
              <div className="space-y-2 text-sm">
                <p className="text-slate-600">Kamar ini kosong dan siap disewakan.</p>
                <Button fullWidth icon={<KeyRound className="h-4 w-4" />} onClick={() => navigate(`/sewa/baru?room=${room.id}`)}>
                  Sewakan kamar ini
                </Button>
              </div>
            )}
            {state.kind === 'maintenance' && state.occupancy === null && (
              <p className="text-sm text-slate-600">Kamar sedang diperbaiki dan tidak ditawarkan ke penyewa baru. Aktifkan kembali bila sudah siap.</p>
            )}
          </section>

          {room.notes && (
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Catatan</h4>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{room.notes}</p>
            </section>
          )}

          <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">ID kamar</p>
              <p className="truncate font-mono text-xs text-slate-700">{room.id}</p>
            </div>
            <Button variant="ghost" size="sm" icon={<Copy className="h-4 w-4" />} onClick={copyId} aria-label="Salin ID kamar">
              Salin
            </Button>
          </div>

          {hasLeases && (
            <p className="text-xs text-slate-500">
              Kamar ini pernah atau sedang disewa, sehingga tidak dapat dihapus agar riwayat sewa tetap utuh. Gunakan “Tandai perbaikan” untuk menonaktifkannya.
            </p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmMaintenance}
        onClose={() => setConfirmMaintenance(false)}
        onConfirm={() => void applyMaintenance()}
        loading={update.isPending}
        danger={false}
        confirmLabel="Tandai perbaikan"
        title="Kamar masih ada penyewanya"
        message={
          <>
            Kamar <strong>{room.name}</strong>{' '}
            {state.occupancy === 'occupied' ? (
              <>
                saat ini dihuni <strong>{occupantName}</strong>. Menandai perbaikan tidak mengakhiri sewa dan tagihan tetap berjalan; kamar hanya dihitung
                sebagai “perbaikan” dan tidak ditawarkan ke penyewa baru.
              </>
            ) : (
              <>
                sudah dipesan <strong>{occupantName}</strong> mulai {formatDate(state.startDate)}. Menandai perbaikan tidak membatalkan pesanan tersebut.
              </>
            )}{' '}
            Penyewa tetap tampil di kartu kamar. Lanjutkan?
          </>
        }
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
        loading={remove.isPending}
        title="Hapus kamar?"
        message={
          <>
            Kamar <strong>{room.name}</strong> akan dihapus permanen.
          </>
        }
      />
    </>
  )
}
