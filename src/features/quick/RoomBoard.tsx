import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { clsx } from 'clsx'
import { AlertTriangle, CalendarPlus, DoorOpen, ExternalLink, FilePlus2, KeyRound, MessageCircle, Wallet, Zap } from 'lucide-react'
import { Badge, Card, CardHeader, Modal } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { formatDate, formatRupiah, todayISO, whatsappLink } from '../../lib/format'
import type { Room } from '../../types/db'
import { leaseReminderText } from '../leases/leaseUtils'
import { useLeaseData } from '../leases/useLeaseData'
import { paidThroughText } from '../properties/roomUtils'
import { BOARD_TONES, BOARD_TONE_META, boardStatusText, buildBoard, countTones, leaseActionLink, type BoardTile, type BoardTone } from './boardModel'
import { QuickCheckInModal } from './QuickCheckInModal'

const TILE_CLASS: Record<BoardTone, string> = {
  // past due: a solid red sign, so it cannot be missed among the pale tiles
  overdue: 'border-red-700 bg-red-600 text-white shadow-sm',
  soon: 'border-orange-400 bg-orange-100 text-orange-900',
  occupied: 'border-sky-300 bg-sky-50 text-sky-900',
  vacant: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  reserved: 'border-violet-300 bg-violet-50 text-violet-900',
  maintenance: 'border-slate-300 bg-slate-100 text-slate-500',
}

const DOT_CLASS: Record<BoardTone, string> = {
  overdue: 'bg-red-600',
  soon: 'bg-orange-500',
  occupied: 'bg-sky-500',
  vacant: 'bg-emerald-500',
  reserved: 'bg-violet-400',
  maintenance: 'bg-slate-400',
}

/**
 * Papan kamar (SPEC 7.4, "Tombol cepat"): every room as a coloured tile; tapping one offers the next step. Occupied
 * rooms link into the lease page, which opens its own Bayar / Perpanjang / Checkout dialog (`?action=`), so every
 * save still goes through the existing, tested dialogs. Empty rooms offer Check-in cepat or the full form.
 */
export function RoomBoard() {
  const { properties, propertyFilterIds } = useOrg()
  const data = useLeaseData()
  const today = todayISO()
  const [openRoomId, setOpenRoomId] = useState<string | null>(null)
  const [checkInRoom, setCheckInRoom] = useState<Room | null>(null)

  const groups = useMemo(
    () => buildBoard(properties, propertyFilterIds, data.rooms, data.leases, data.tenantById, data.invoices, data.payments, today),
    [properties, propertyFilterIds, data.rooms, data.leases, data.tenantById, data.invoices, data.payments, today],
  )
  const counts = useMemo(() => countTones(groups), [groups])
  const openTile = openRoomId ? groups.flatMap((g) => g.tiles).find((t) => t.room.id === openRoomId) ?? null : null
  // The same pre-filled WhatsApp reminder as "Pengingat WhatsApp" on the lease list (leaseReminderText), built only for
  // the room that is open: the oldest open invoice, or the next period when everything is paid.
  const reminderLink = useMemo(() => {
    const lease = openTile?.lease
    const tenant = openTile?.tenant
    if (!openTile || !lease || !tenant?.phone || !openTile.summary) return null
    const text = leaseReminderText({
      lease,
      tenant,
      room: openTile.room,
      property: data.propertyById.get(lease.property_id),
      invoices: data.invoices.filter((i) => i.lease_id === lease.id),
      orgInvoices: data.invoices,
      payments: data.payments,
      addons: data.leaseAddons.filter((a) => a.lease_id === lease.id),
    })
    return text ? whatsappLink(tenant.phone, text) : null
  }, [openTile, data.propertyById, data.invoices, data.payments, data.leaseAddons])

  if (data.isPending || data.error || groups.length === 0) return null

  return (
    <Card data-testid="room-board">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-brand-700" aria-hidden /> Papan kamar
          </span>
        }
        subtitle="Ketuk kamar untuk aksi cepat"
        action={<Badge tone="brand">Percobaan</Badge>}
      />
      <div className="space-y-3 px-4 py-3">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600" aria-label="Keterangan warna">
          {BOARD_TONES.filter((t) => counts[t] > 0).map((t) => (
            <li key={t} className="inline-flex items-center gap-1">
              <span className={clsx('h-2.5 w-2.5 rounded-full', DOT_CLASS[t])} aria-hidden />
              {BOARD_TONE_META[t].legend} ({counts[t]})
            </li>
          ))}
        </ul>
        {groups.map((g) => (
          <section key={g.property.id} aria-label={`Kamar ${g.property.name}`}>
            {groups.length > 1 && <p className="mb-1.5 text-xs font-semibold text-slate-500">{g.property.name}</p>}
            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8 lg:grid-cols-10">
              {g.tiles.map((t) => (
                <button
                  key={t.room.id}
                  type="button"
                  data-testid="board-tile"
                  data-room={t.room.name}
                  data-tone={t.tone}
                  aria-label={`Kamar ${t.room.name}: ${t.tone === 'soon' ? `jatuh tempo ${t.caption.toLowerCase()}` : BOARD_TONE_META[t.tone].legend}`}
                  onClick={() => setOpenRoomId(t.room.id)}
                  className={clsx('flex min-h-12 min-w-0 flex-col items-center justify-center rounded-lg border px-0.5 py-1 text-center', TILE_CLASS[t.tone])}
                >
                  <span className="max-w-full truncate text-sm font-semibold tabular-nums">{t.room.name}</span>
                  <span className={clsx('max-w-full truncate text-[10px] leading-tight', t.tone === 'overdue' && 'font-bold uppercase tracking-wide')}>{t.caption}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {openTile && (
        <RoomActionSheet
          tile={openTile}
          reminderLink={reminderLink}
          today={today}
          onClose={() => setOpenRoomId(null)}
          onCheckIn={() => {
            setOpenRoomId(null)
            setCheckInRoom(openTile.room)
          }}
        />
      )}
      {checkInRoom && <QuickCheckInModal room={checkInRoom} onClose={() => setCheckInRoom(null)} />}
    </Card>
  )
}

const ACTION_BASE = 'inline-flex h-12 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium'
const ACTION_PRIMARY = `${ACTION_BASE} bg-brand-700 text-white hover:bg-brand-800`
const ACTION_OUTLINE = `${ACTION_BASE} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`

function ActionLink({ to, primary, icon, children }: { to: string; primary?: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <Link to={to} className={primary ? ACTION_PRIMARY : ACTION_OUTLINE}>
      {icon}
      {children}
    </Link>
  )
}

function RoomActionSheet({
  tile,
  reminderLink,
  today,
  onClose,
  onCheckIn,
}: {
  tile: BoardTile
  /** wa.me link with the reminder text, or null (no phone / nothing to remind) */
  reminderLink: string | null
  today: string
  onClose: () => void
  onCheckIn: () => void
}) {
  const { room, lease, tenant, summary, tone } = tile
  const living = Boolean(lease && summary)
  const status = boardStatusText(summary, today)

  return (
    <Modal open onClose={onClose} title={`Kamar ${room.name}`} size="sm">
      <div className="space-y-4" data-testid="room-actions">
        <div className="space-y-1 text-sm text-slate-700">
          <p className="inline-flex items-center gap-1.5 font-medium text-slate-900">
            <span className={clsx('h-2.5 w-2.5 rounded-full', DOT_CLASS[tone])} aria-hidden />
            {BOARD_TONE_META[tone].legend}
          </p>
          {tenant && <p className="text-base font-semibold text-slate-900">{tenant.full_name}</p>}
          {tenant && !tenant.phone && (
            <Link to={`/penyewa/${tenant.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> HP belum diisi: lengkapi
            </Link>
          )}
          {living && summary && (
            <>
              {summary.outstanding > 0 ? (
                <p className="font-medium text-red-700">Sisa {formatRupiah(summary.outstanding)}</p>
              ) : (
                paidThroughText(summary.paidThrough) && <p>{paidThroughText(summary.paidThrough)}</p>
              )}
              {status && <p className={tone === 'overdue' ? 'font-medium text-red-700' : 'text-slate-500'}>{status}</p>}
            </>
          )}
          {tone === 'reserved' && lease && <p>Mulai {formatDate(lease.start_date)}</p>}
          {tone === 'vacant' && <p>{room.price_daily ? `Tarif harian ${formatRupiah(room.price_daily)} / malam` : 'Belum ada tarif harian.'}</p>}
          {tone === 'maintenance' && !lease && <p>Kamar sedang perbaikan.</p>}
        </div>

        {living && (tone === 'overdue' || tone === 'soon') && (
          reminderLink ? (
            <a
              href={reminderLink}
              target="_blank"
              rel="noopener noreferrer"
              className={`${ACTION_BASE} w-full bg-green-600 text-white hover:bg-green-700`}
            >
              <MessageCircle className="h-5 w-5" aria-hidden /> Kirim pengingat WhatsApp
            </a>
          ) : (
            tenant &&
            !tenant.phone && <p className="text-xs text-slate-500">Isi nomor HP penyewa dulu untuk mengirim pengingat WhatsApp.</p>
          )
        )}
        {living && lease && (
          <div className="grid grid-cols-2 gap-2">
            {summary && summary.outstanding > 0 && (
              <ActionLink to={leaseActionLink(lease.id, 'bayar')} primary icon={<Wallet className="h-4 w-4" aria-hidden />}>
                Bayar
              </ActionLink>
            )}
            <ActionLink to={leaseActionLink(lease.id, 'tagih')} primary={!summary || summary.outstanding <= 0} icon={<CalendarPlus className="h-4 w-4" aria-hidden />}>
              Perpanjang
            </ActionLink>
            <ActionLink to={leaseActionLink(lease.id, 'checkout')} icon={<DoorOpen className="h-4 w-4" aria-hidden />}>
              Check-out
            </ActionLink>
          </div>
        )}
        {tone === 'vacant' && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onCheckIn} className={ACTION_PRIMARY}>
              <KeyRound className="h-4 w-4" aria-hidden /> Check-in cepat
            </button>
            <ActionLink to={`/sewa/baru?room=${room.id}`} icon={<FilePlus2 className="h-4 w-4" aria-hidden />}>
              Form lengkap
            </ActionLink>
          </div>
        )}
        {lease ? (
          <Link to={`/sewa/${lease.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
            Lihat detail sewa <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : (
          tone === 'maintenance' && (
            <Link to={`/kos/${room.property_id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              Buka Kos &amp; Kamar <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )
        )}
      </div>
    </Modal>
  )
}
