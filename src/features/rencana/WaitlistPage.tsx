import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { CalendarSearch, ExternalLink, MessageCircle, MessageCirclePlus, Pencil, Plus, RotateCcw, Trash2, XCircle } from 'lucide-react'
import { Badge, Button, Card, CardBody, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import { todayISO, whatsappLink } from '../../lib/format'
import type { WaitlistEntry, WaitlistStatus } from '../../types/db'
import { WAITLIST_STATUSES } from '../../types/db'
import { useLeaseData } from '../leases/useLeaseData'
import { useRencanaActions } from './useRencanaActions'
import { WaitlistFormModal } from './WaitlistFormModal'
import {
  WAITLIST_FILTERS,
  emptyWaitlistForm,
  entryToForm,
  inKosFilter,
  kabariText,
  matchText,
  plannerLinkFor,
  sortWaitlist,
  waitlistMatches,
  wantText,
  type WaitlistForm,
  type WaitlistMatch,
} from './waitlist'

/** Feature not deployed yet: the app went out before supabase/schema.sql (with the waitlist table) was re-run. */
const NOT_DEPLOYED_RE = /waitlist|PGRST205|schema cache|does not exist/i

const ACTION = 'inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium'
/** four actions side by side on a 360 px phone: icon over a short word */
const GRID_ACTION = 'inline-flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-xs font-medium'

interface FormState {
  entry: WaitlistEntry | null
  initial: WaitlistForm
  focusPhone?: boolean
}

/**
 * Daftar tunggu (SPEC 7.7): who is waiting for a room, soonest first, each with the rooms that fit right now (the same
 * search as Cek kamar). Kabari opens WhatsApp with the room, dates and price; Pesan opens the planner filled in, and the
 * booking marks the entry booked. Staff manage the list; deleting is for owners/admins (cancel instead).
 */
export function WaitlistPage() {
  const { properties, propertyFilterIds, selectedPropertyId } = useOrg()
  const data = useLeaseData()
  const waitlist = useTable('waitlist')
  const actions = useRencanaActions()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const status: WaitlistStatus = (WAITLIST_STATUSES as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as WaitlistStatus) : 'waiting'
  const [form, setForm] = useState<FormState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<WaitlistEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const today = todayISO()

  const shown = useMemo(() => sortWaitlist((waitlist.data ?? []).filter((e) => inKosFilter(e, propertyFilterIds))), [waitlist.data, propertyFilterIds])
  const counts = useMemo(() => {
    const c: Record<WaitlistStatus, number> = { waiting: 0, booked: 0, cancelled: 0 }
    for (const e of shown) c[e.status]++
    return c
  }, [shown])
  const list = shown.filter((e) => e.status === status)
  const matches = useMemo(() => {
    const out = new Map<string, WaitlistMatch>()
    for (const e of shown) {
      if (e.status !== 'waiting') continue
      out.set(e.id, waitlistMatches(e, { rooms: data.rooms, leases: data.leases, today, propertyIds: propertyFilterIds, tenants: data.tenantById }))
    }
    return out
  }, [shown, data.rooms, data.leases, data.tenantById, propertyFilterIds, today])

  const setStatus = (next: WaitlistStatus) => {
    const q = new URLSearchParams(params)
    if (next === 'waiting') q.delete('status')
    else q.set('status', next)
    setParams(q, { replace: true })
  }

  const newEntry = () => setForm({ entry: null, initial: emptyWaitlistForm(today, selectedPropertyId === 'all' ? '' : selectedPropertyId) })
  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await work()
      toast.success(done)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  const loadError = waitlist.error
  const notDeployed = loadError instanceof Error && NOT_DEPLOYED_RE.test(loadError.message)

  return (
    <>
      <PageHeader
        title="Daftar tunggu"
        subtitle="Orang yang menunggu kamar. Kamar yang cocok dicek otomatis setiap kali halaman dibuka."
        actions={
          <>
            <Link to="/rencana" className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
              <CalendarSearch className="h-4 w-4" aria-hidden /> Cek kamar
            </Link>
            <Button size="lg" icon={<Plus className="h-5 w-5" />} onClick={newEntry}>
              Tambah
            </Button>
          </>
        }
      />

      <div role="tablist" aria-label="Status daftar tunggu" className="mb-3 grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-white p-1 sm:inline-grid">
        {WAITLIST_FILTERS.map((f) => (
          <button
            key={f.status}
            type="button"
            role="tab"
            aria-selected={status === f.status}
            onClick={() => setStatus(f.status)}
            className={clsx(
              'min-h-11 rounded-md px-1.5 py-1 text-center text-sm font-medium leading-tight sm:px-3',
              status === f.status ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            {f.label} ({counts[f.status]})
          </button>
        ))}
      </div>

      {waitlist.isPending || data.isPending ? (
        <LoadingState />
      ) : notDeployed ? (
        <EmptyState title="Daftar tunggu belum aktif di server" description="Minta operator menjalankan ulang supabase/schema.sql, lalu buka halaman ini lagi." />
      ) : loadError || data.error ? (
        <ErrorState error={loadError ?? data.error} />
      ) : list.length === 0 ? (
        <EmptyState
          title={status === 'waiting' ? 'Belum ada yang menunggu' : status === 'booked' ? 'Belum ada yang dipesankan' : 'Tidak ada yang batal'}
          description={status === 'waiting' ? 'Tamu yang belum dapat kamar dicatat di sini supaya bisa dikabari bila ada kamar kosong.' : undefined}
          action={
            status === 'waiting' ? (
              <Button size="lg" icon={<Plus className="h-5 w-5" />} onClick={newEntry}>
                Tambah ke daftar tunggu
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {list.map((e) => {
            const match = matches.get(e.id)
            const best = match?.rooms[0]
            const kos = e.property_id ? data.propertyById.get(e.property_id)?.name : null
            const kabari =
              best && match?.stay && e.phone
                ? whatsappLink(
                    e.phone,
                    kabariText({ name: e.name, roomName: best.room.name, propertyName: data.propertyById.get(best.room.property_id)?.name ?? 'Kos', stay: match.stay, total: best.total }),
                  )
                : null
            return (
              <li key={e.id}>
                <Card data-testid="waitlist-entry" data-name={e.name}>
                  <CardBody className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-slate-900">{e.name}</p>
                        <p className="flex flex-wrap items-center gap-x-2 text-sm">
                          {e.phone ? (
                            <a href={whatsappLink(e.phone) ?? undefined} target="_blank" rel="noopener noreferrer" className="font-medium text-emerald-700 hover:underline">
                              {e.phone}
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setForm({ entry: e, initial: entryToForm(e, today), focusPhone: true })}
                              aria-label={`Nomor HP ${e.name} belum diisi: isi sekarang`}
                              className="inline-flex h-8 items-center gap-1 rounded-full bg-amber-50 px-2 text-xs font-medium text-amber-700 hover:bg-amber-100"
                            >
                              <MessageCirclePlus className="h-4 w-4" aria-hidden /> HP belum diisi
                            </button>
                          )}
                        </p>
                      </div>
                      <Badge tone={e.status === 'waiting' ? 'brand' : e.status === 'booked' ? 'success' : 'neutral'}>{kos ?? 'Kos mana saja'}</Badge>
                    </div>
                    <p className="text-sm text-slate-700">{wantText(e, match?.stay)}</p>
                    {(e.room_note || e.notes) && <p className="text-xs text-slate-500">{[e.room_note, e.notes].filter(Boolean).join(' · ')}</p>}
                    {e.status === 'waiting' && match && (
                      <p className={clsx('text-sm font-medium', match.rooms.length > 0 ? 'text-emerald-700' : 'text-slate-500')} data-testid="waitlist-match">
                        {matchText(match.rooms)}
                      </p>
                    )}

                    {e.status === 'waiting' && (
                      <div className="grid grid-cols-4 gap-1.5">
                        {kabari ? (
                          <a href={kabari} target="_blank" rel="noopener noreferrer" className={`${GRID_ACTION} bg-green-600 text-white hover:bg-green-700`}>
                            <MessageCircle className="h-4 w-4 shrink-0" aria-hidden /> Kabari
                          </a>
                        ) : (
                          <span
                            aria-disabled="true"
                            title={!best ? 'Belum ada kamar cocok' : 'Isi nomor HP dulu'}
                            className={`${GRID_ACTION} cursor-not-allowed bg-slate-100 text-slate-400`}
                          >
                            <MessageCircle className="h-4 w-4 shrink-0" aria-hidden /> Kabari
                          </span>
                        )}
                        <Link to={plannerLinkFor(e, today)} className={`${GRID_ACTION} bg-brand-700 text-white hover:bg-brand-800`}>
                          <CalendarSearch className="h-4 w-4 shrink-0" aria-hidden /> Pesan
                        </Link>
                        <ActionButton compact onClick={() => setForm({ entry: e, initial: entryToForm(e, today) })} icon={<Pencil className="h-4 w-4 shrink-0" aria-hidden />}>
                          Ubah
                        </ActionButton>
                        <ActionButton
                          compact
                          disabled={busy}
                          onClick={() => void run(() => actions.setEntryStatus(e, 'cancelled'), `${e.name} dibatalkan dari daftar tunggu.`)}
                          icon={<XCircle className="h-4 w-4 shrink-0" aria-hidden />}
                        >
                          Batal
                        </ActionButton>
                      </div>
                    )}
                    {e.status !== 'waiting' && (
                      <div className="flex flex-wrap gap-2">
                        {e.status === 'booked' && e.lease_id && (
                          <Link to={`/sewa/${e.lease_id}`} className={`${ACTION} border border-slate-300 bg-white px-3 text-slate-800 hover:bg-slate-50`}>
                            <ExternalLink className="h-4 w-4" aria-hidden /> Lihat sewa
                          </Link>
                        )}
                        {e.status === 'cancelled' && (
                          <ActionButton disabled={busy} onClick={() => void run(() => actions.setEntryStatus(e, 'waiting'), `${e.name} menunggu lagi.`)} icon={<RotateCcw className="h-4 w-4" aria-hidden />}>
                            Aktifkan lagi
                          </ActionButton>
                        )}
                        {actions.canDeleteEntries && (
                          <ActionButton onClick={() => setConfirmDelete(e)} icon={<Trash2 className="h-4 w-4" aria-hidden />} danger>
                            Hapus
                          </ActionButton>
                        )}
                      </div>
                    )}
                  </CardBody>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      {form && (
        <WaitlistFormModal
          key={form.entry?.id ?? 'baru'}
          entry={form.entry}
          initial={form.initial}
          focusPhone={form.focusPhone}
          properties={properties}
          onClose={() => setForm(null)}
        />
      )}
      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        loading={busy}
        title="Hapus dari daftar tunggu?"
        message={`Data ${confirmDelete?.name ?? ''} dihapus untuk selamanya. Sewa yang sudah dipesan tidak ikut terhapus.`}
        onConfirm={() => {
          const target = confirmDelete
          if (!target) return
          void run(async () => {
            await actions.removeEntry(target)
            setConfirmDelete(null)
          }, `${target.name} dihapus dari daftar tunggu.`)
        }}
      />
    </>
  )
}

function ActionButton({
  onClick,
  icon,
  children,
  disabled,
  danger,
  compact,
}: {
  onClick: () => void
  icon: ReactNode
  children: ReactNode
  disabled?: boolean
  danger?: boolean
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        compact ? GRID_ACTION : [ACTION, 'px-3'],
        'border disabled:opacity-60',
        danger ? 'border-red-200 bg-white text-red-700 hover:bg-red-50' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
      )}
    >
      {icon}
      {children}
    </button>
  )
}
