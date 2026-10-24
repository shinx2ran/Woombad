import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AlertTriangle, CalendarCheck, ListPlus, MessageCircle, MessageCirclePlus, Users, X } from 'lucide-react'
import { Badge, Button, Card, CardBody, CountInput, EmptyState, ErrorState, Input, LoadingState, MoneyInput, PageHeader } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import { summarizeLeaseBilling } from '../../domain/billing'
import { formatCheckout, formatRupiah, todayISO, whatsappLink } from '../../lib/format'
import type { PeriodType, Room, WaitlistEntry } from '../../types/db'
import { PERIOD_UNIT_LABEL } from '../../types/db'
import { extensionQuestionText } from '../dashboard/dashboardModel'
import { PeriodTypePicker } from '../leases/components'
import { PlannedCheckoutModal } from '../leases/PlannedCheckoutModal'
import { useLeaseActions } from '../leases/useLeaseActions'
import { useLeaseData } from '../leases/useLeaseData'
import { AvailabilityStrip, StripLegend } from './AvailabilityStrip'
import { availabilityStrip, findAvailability, rateText, roomHolds, type FreeRoom, type MaybeFreeRoom, type PlannedStay } from './availability'
import { BookingSheet } from './BookingSheet'
import { parsePlannerParams, plannerSearch, type PlannerParams } from './rencanaParams'
import { WaitlistFormModal } from './WaitlistFormModal'
import { emptyWaitlistForm } from './waitlist'

/** "Bisa kosong" cards shown before "Tampilkan semua (N)" */
const MAYBE_FREE_SHOWN = 8

/** 'belum diperpanjang 3 hari' / '… jatuh tempo hari ini' for a monthly tenant whose billed period ended (SPEC 7.8). */
function lapsedText(days: number): string {
  return days === 0 ? 'belum diperpanjang, jatuh tempo hari ini' : `belum diperpanjang ${days} hari`
}

/** two side by side on a 360 px phone: a label may take two short lines */
const CARD_ACTION = 'inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-center text-sm font-medium leading-tight'

/**
 * Cek kamar & pesan (SPEC 7.7, 7.8): pick Harian / Mingguan / Bulanan, the check-in day and how long; every room free
 * for the whole stay is listed best fit first, with the price and a 14-day strip; then "Bisa kosong": rooms of monthly
 * tenants paid only up to before the stay who have not said whether they extend (ask on WhatsApp, or record their
 * Rencana keluar, after which the room moves up to the free list); then "Hampir cocok" rooms with the exact reason.
 * Pesan books the room through the Check-in cepat path. Nothing free: put the guest on the daftar tunggu. The inputs live
 * in the address (rencanaParams), so the room board and the daftar tunggu can open it filled in.
 */
export function PlannerPage() {
  const { properties, propertyFilterIds, selectedPropertyId } = useOrg()
  const data = useLeaseData()
  const waitlist = useTable('waitlist')
  const leaseActions = useLeaseActions()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const today = todayISO()
  const p = parsePlannerParams(params, today)
  const [booking, setBooking] = useState<FreeRoom | null>(null)
  const [waitlistOpen, setWaitlistOpen] = useState(false)
  /** the "Bisa kosong" room whose tenant is being marked as leaving (Rencana keluar sheet) */
  const [leaving, setLeaving] = useState<MaybeFreeRoom | null>(null)
  const [showAllMaybe, setShowAllMaybe] = useState(false)

  const update = (patch: Partial<PlannerParams>) => setParams(new URLSearchParams(plannerSearch({ ...p, ...patch }).slice(1)), { replace: true })

  const entry: WaitlistEntry | null = p.waitlistId ? (waitlist.data ?? []).find((w) => w.id === p.waitlistId) ?? null : null
  const pinnedRoom: Room | undefined = p.roomId ? data.roomById.get(p.roomId) : undefined

  const result = useMemo(
    () =>
      findAvailability({
        rooms: data.rooms,
        leases: data.leases,
        request: { periodType: p.periodType, start: p.start, quantity: p.quantity, maxPrice: p.maxPrice },
        today,
        // one room: whatever kos is selected; a daftar tunggu entry for one kos: that kos; otherwise the global kos filter
        propertyIds: p.roomId ? undefined : p.kosId ? [p.kosId] : propertyFilterIds,
        roomId: p.roomId,
        tenants: data.tenantById,
      }),
    [data.rooms, data.leases, data.tenantById, p.periodType, p.start, p.quantity, p.maxPrice, p.kosId, p.roomId, propertyFilterIds, today],
  )

  const unit = PERIOD_UNIT_LABEL[p.periodType]
  const pinnedKos = p.kosId ? (properties.find((x) => x.id === p.kosId)?.name ?? 'kos terpilih') : null
  const kosLabel =
    pinnedKos ??
    (selectedPropertyId === 'all' ? (properties.length > 1 ? 'semua kos' : properties[0]?.name ?? 'kos') : (properties.find((x) => x.id === selectedPropertyId)?.name ?? 'kos terpilih'))
  const showKos = selectedPropertyId === 'all' && properties.length > 1 && !p.kosId

  const strip = (roomId: string, stay: PlannedStay) => availabilityStrip(roomHolds(roomId, data.leases, today), stay.start, stay)

  const openWaitlistForm = () => setWaitlistOpen(true)

  const maybeFree = result?.maybeFree ?? []
  const maybeIds = new Set(maybeFree.map((m) => m.room.id))
  const shownMaybe = showAllMaybe ? maybeFree : maybeFree.slice(0, MAYBE_FREE_SHOWN)
  const maybeHint =
    maybeFree.length > 0 ? ` ${maybeFree.length} kamar bisa kosong bila penyewa bulanannya keluar: lihat “Bisa kosong” di bawah.` : ''
  /** 'dibayar s/d 20 Nov', or 'ditagih s/d 20 Nov · sisa Rp …' while the billed period is not paid in full */
  const paidText = (m: MaybeFreeRoom) => {
    const summary = summarizeLeaseBilling(m.lease, data.invoices, data.payments, today)
    const out = formatCheckout(m.paidThrough, 'd MMM')
    return summary.outstanding > 0 ? `ditagih s/d ${out} · sisa ${formatRupiah(summary.outstanding)}` : `dibayar s/d ${out}`
  }

  return (
    <>
      <PageHeader
        title="Cek kamar & pesan"
        subtitle="Cari kamar kosong untuk tamu yang akan datang, lalu pesan. Kamar yang sudah dipesan tidak bisa dipesan dua kali."
        actions={
          <Link to="/daftar-tunggu" className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
            <Users className="h-4 w-4" aria-hidden /> Daftar tunggu
          </Link>
        }
      />

      {p.waitlistId && (
        <Card className="mb-3 border-brand-200 bg-brand-50" data-testid="planner-waitlist-entry">
          <CardBody className="text-sm text-brand-900">
            {entry ? (
              <>
                <p>
                  Memesan untuk daftar tunggu: <strong>{entry.name}</strong>
                  {entry.phone ? ` · ${entry.phone}` : ''}
                </p>
                {entry.room_note && <p className="text-xs text-brand-800">Preferensi: {entry.room_note}</p>}
                {entry.status !== 'waiting' && <p className="text-xs font-medium text-amber-800">Entri ini sudah {entry.status === 'booked' ? 'dipesan' : 'dibatalkan'}.</p>}
              </>
            ) : (
              <p>{waitlist.isPending ? 'Memuat daftar tunggu…' : 'Entri daftar tunggu tidak ditemukan.'}</p>
            )}
          </CardBody>
        </Card>
      )}

      <Card className="mb-4">
        <CardBody className="space-y-3">
          <PeriodTypePicker label="Jenis sewa" value={p.periodType} onChange={(t: PeriodType) => update({ periodType: t })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Check-in" type="date" value={p.start} onChange={(e) => e.target.value && update({ start: e.target.value })} required />
            <CountInput label={`Jumlah ${unit}`} value={p.quantity} onChange={(n) => update({ quantity: n })} required />
          </div>
          <MoneyInput label={`Harga maks. per ${unit} (opsional)`} value={p.maxPrice ?? 0} onChange={(n) => update({ maxPrice: n > 0 ? n : null })} />
          {result && (
            <p className="text-sm text-slate-700" data-testid="planner-checkout">
              Check-out <strong>{formatCheckout(result.stay.end, 'EEEE, d MMM yyyy')}</strong> · {result.stay.nights} malam
              {p.start < today && <span className="block text-xs text-amber-700">Tanggal check-in sudah lewat.</span>}
            </p>
          )}
          <p className="text-xs text-slate-500" data-testid="planner-scope">
            Mencari di {p.roomId ? `kamar ${pinnedRoom?.name ?? '?'}` : kosLabel}. {p.roomId || p.kosId ? '' : 'Ganti kos lewat pilihan kos di atas.'}
          </p>
          {!p.roomId && p.kosId && (
            <button type="button" onClick={() => update({ kosId: null })} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
              Hanya {pinnedKos} <X className="h-4 w-4" aria-hidden /> <span className="sr-only">Cari di semua kos</span>
            </button>
          )}
          {p.roomId && (
            <button type="button" onClick={() => update({ roomId: null })} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">
              Hanya kamar {pinnedRoom?.name ?? '?'} <X className="h-4 w-4" aria-hidden /> <span className="sr-only">Tampilkan semua kamar</span>
            </button>
          )}
        </CardBody>
      </Card>

      {data.isPending ? (
        <LoadingState />
      ) : data.error ? (
        <ErrorState error={data.error} />
      ) : !result ? (
        <EmptyState title="Isi tanggal check-in dan jumlahnya" />
      ) : (
        <div className="space-y-5">
          <StripLegend />
          <section aria-labelledby="free-heading" className="space-y-2">
            <h2 id="free-heading" className="text-sm font-semibold text-slate-900">
              Kosong untuk seluruh tanggal ({result.free.length})
            </h2>
            {result.free.length === 0 ? (
              <EmptyState
                icon={<CalendarCheck className="h-10 w-10" />}
                title={p.roomId ? `Kamar ${pinnedRoom?.name ?? ''} tidak kosong untuk tanggal ini` : 'Tidak ada kamar kosong untuk seluruh tanggal'}
                description={
                  (result.overBudget > 0
                    ? `${result.overBudget} kamar kosong tetapi harganya di atas batas. Ubah tanggal atau harga maks., atau catat tamu di daftar tunggu.`
                    : 'Ubah tanggal atau jumlahnya, atau catat tamu di daftar tunggu supaya dikabari bila ada kamar.') + maybeHint
                }
                action={
                  <Button size="lg" icon={<ListPlus className="h-5 w-5" />} onClick={openWaitlistForm}>
                    Masukkan ke daftar tunggu
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {result.free.map((f) => (
                  <li key={f.room.id}>
                    <Card data-testid="free-room" data-room={f.room.name}>
                      <CardBody className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-base font-semibold text-slate-900">
                              Kamar {f.room.name}
                              {showKos && <span className="ml-1.5 text-xs font-normal text-slate-500">{data.propertyById.get(f.room.property_id)?.name}</span>}
                            </p>
                            <p className="text-sm text-emerald-700">{f.reason}</p>
                            {f.note && (
                              <p className={f.previous?.expectedLeave ? 'text-xs text-amber-700' : 'text-xs text-slate-500'}>
                                {f.previous?.expectedLeave && <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />}
                                {f.note}
                              </p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold tabular-nums text-slate-900">{f.total !== null ? formatRupiah(f.total) : 'Harga belum diatur'}</p>
                            {f.rate !== null && <p className="text-[11px] text-slate-500">{rateText(f.rate, p.periodType)}</p>}
                          </div>
                        </div>
                        <AvailabilityStrip cells={strip(f.room.id, result.stay)} />
                        <Button fullWidth size="lg" onClick={() => setBooking(f)} aria-label={`Pesan kamar ${f.room.name}`}>
                          Pesan
                        </Button>
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            {result.free.length > 0 && result.overBudget > 0 && <p className="text-xs text-slate-500">{result.overBudget} kamar lain kosong tetapi di atas harga maks.</p>}
          </section>

          {maybeFree.length > 0 && (
            <section aria-labelledby="maybe-heading" className="space-y-2" data-testid="maybe-free-section">
              <h2 id="maybe-heading" className="text-sm font-semibold text-slate-900">
                Bisa kosong — penyewa bulanan belum konfirmasi ({maybeFree.length})
              </h2>
              <p className="text-xs text-slate-500">
                Sewanya dibayar sampai sebelum tanggal ini dan belum diperpanjang. Tanyakan dulu; bila ia akan keluar, tandai rencana keluarnya, lalu kamar bisa
                dipesan.
              </p>
              <ul className="space-y-2">
                {shownMaybe.map((m) => {
                  const tenant = data.tenantById.get(m.lease.tenant_id)
                  const name = tenant?.full_name ?? 'Penyewa'
                  const wa = whatsappLink(
                    tenant?.phone,
                    extensionQuestionText({ tenantName: name, roomName: m.room.name, propertyName: data.propertyById.get(m.room.property_id)?.name ?? 'Kos', endDate: m.paidThrough }),
                  )
                  return (
                    <li key={m.room.id}>
                      <Card data-testid="maybe-free-room" data-room={m.room.name}>
                        <CardBody className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-base font-semibold text-slate-900">
                                Kamar {m.room.name}
                                {showKos && <span className="ml-1.5 text-xs font-normal text-slate-500">{data.propertyById.get(m.room.property_id)?.name}</span>}
                              </p>
                              <p className="truncate text-sm">
                                <Link to={`/sewa/${m.lease.id}`} className="font-medium text-brand-700 hover:underline">
                                  {name}
                                </Link>
                                <span className="text-slate-500"> · bulanan</span>
                              </p>
                              <p className="text-xs text-slate-600">{paidText(m)}</p>
                              {m.lapsedDays !== null && <p className="text-xs font-medium text-amber-700">{lapsedText(m.lapsedDays)}</p>}
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-semibold tabular-nums text-slate-900">{m.total !== null ? formatRupiah(m.total) : 'Harga belum diatur'}</p>
                              {m.rate !== null && <p className="text-[11px] text-slate-500">{rateText(m.rate, p.periodType)}</p>}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {wa ? (
                              <a href={wa} target="_blank" rel="noopener noreferrer" className={`${CARD_ACTION} bg-green-600 text-white hover:bg-green-700`}>
                                <MessageCircle className="h-4 w-4 shrink-0" aria-hidden /> Tanya perpanjang
                              </a>
                            ) : (
                              <Link
                                to={tenant ? `/penyewa/${tenant.id}?isi=hp` : `/sewa/${m.lease.id}`}
                                aria-label={`Nomor HP ${name} belum diisi: isi sekarang`}
                                className={`${CARD_ACTION} bg-amber-50 text-amber-700 hover:bg-amber-100`}
                              >
                                <MessageCirclePlus className="h-4 w-4 shrink-0" aria-hidden /> HP belum diisi
                              </Link>
                            )}
                            <button
                              type="button"
                              onClick={() => setLeaving(m)}
                              aria-label={`Tandai ${name} akan keluar`}
                              className={`${CARD_ACTION} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}
                            >
                              Tandai akan keluar
                            </button>
                          </div>
                        </CardBody>
                      </Card>
                    </li>
                  )
                })}
              </ul>
              {!showAllMaybe && maybeFree.length > MAYBE_FREE_SHOWN && (
                <Button variant="outline" size="lg" fullWidth onClick={() => setShowAllMaybe(true)}>
                  Tampilkan semua ({maybeFree.length})
                </Button>
              )}
            </section>
          )}

          {result.partial.length > 0 && (
            <section aria-labelledby="partial-heading" className="space-y-2">
              <h2 id="partial-heading" className="text-sm font-semibold text-slate-900">
                Hampir cocok ({result.partial.length})
              </h2>
              <ul className="space-y-2">
                {result.partial.map((r) => (
                  <li key={r.room.id}>
                    <Card data-testid="partial-room" data-room={r.room.name}>
                      <CardBody className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">
                              Kamar {r.room.name}
                              {showKos && <span className="ml-1.5 text-xs font-normal text-slate-500">{data.propertyById.get(r.room.property_id)?.name}</span>}
                            </p>
                            <p className="text-sm text-amber-800">{r.reason}</p>
                          </div>
                          <Badge tone="warning">
                            {r.freeNights} dari {result.stay.nights} malam
                          </Badge>
                        </div>
                        <AvailabilityStrip cells={strip(r.room.id, result.stay)} />
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* one room (?kamar=): why it is not free; a "Bisa kosong" room has its card above instead */}
          {p.roomId &&
            result.taken
              .filter((t) => !maybeIds.has(t.room.id))
              .map((t) => (
                <Card key={t.room.id} data-testid="taken-room">
                  <CardBody className="space-y-2">
                    <p className="font-semibold text-slate-900">Kamar {t.room.name}</p>
                    <p className="text-sm text-red-700">{t.reason}</p>
                    <AvailabilityStrip cells={strip(t.room.id, result.stay)} />
                  </CardBody>
                </Card>
              ))}

          {result.free.length > 0 && (
            <p className="text-center text-sm text-slate-600">
              Tamu belum pasti?{' '}
              <button type="button" onClick={openWaitlistForm} className="inline-flex h-11 items-center font-medium text-brand-700 hover:underline">
                Masukkan ke daftar tunggu
              </button>
            </p>
          )}
        </div>
      )}

      {booking && result && (
        <BookingSheet
          room={booking.room}
          property={data.propertyById.get(booking.room.property_id)}
          stay={result.stay}
          rate={booking.rate}
          entry={entry && entry.status === 'waiting' ? entry : null}
          tenants={data.tenants}
          tenantById={data.tenantById}
          orgInvoices={data.invoices}
          onClose={() => setBooking(null)}
        />
      )}
      {leaving && (
        <PlannedCheckoutModal
          // the room re-evaluates as soon as the leases are read again: free from his check-out day on
          lease={data.leases.find((l) => l.id === leaving.lease.id) ?? leaving.lease}
          tenantName={data.tenantById.get(leaving.lease.tenant_id)?.full_name ?? 'Penyewa'}
          roomName={leaving.room.name}
          actions={leaseActions}
          onClose={() => setLeaving(null)}
        />
      )}
      {waitlistOpen && (
        <WaitlistFormModal
          entry={null}
          initial={{
            ...emptyWaitlistForm(today, selectedPropertyId === 'all' ? '' : selectedPropertyId),
            wantedFrom: p.start,
            periodType: p.periodType,
            quantity: p.quantity,
            maxPrice: p.maxPrice ?? 0,
            propertyId: pinnedRoom?.property_id ?? p.kosId ?? (selectedPropertyId === 'all' ? '' : selectedPropertyId),
          }}
          properties={properties}
          onClose={() => setWaitlistOpen(false)}
          onSaved={() => navigate('/daftar-tunggu')}
        />
      )}
    </>
  )
}
