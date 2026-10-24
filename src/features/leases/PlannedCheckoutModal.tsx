import { useState } from 'react'
import { AlertTriangle, CalendarX2 } from 'lucide-react'
import { Button, Input, Modal, useToast } from '../../components/ui'
import type { Lease } from '../../types/db'
import { formatCheckout, formatDate, todayISO } from '../../lib/format'
import { defaultPlannedCheckout, plannedCheckoutError, plannedCheckoutNote } from './leaseUtils'
import { Row } from './components'
import type { LeaseActions } from './useLeaseActions'

export interface PlannedCheckoutModalProps {
  lease: Lease
  tenantName: string
  roomName: string
  actions: Pick<LeaseActions, 'setPlannedCheckout'>
  /** the day the sheet starts with (Cek kamar: the check-out day of the billed period); default defaultPlannedCheckout */
  initialDay?: string
  onClose: () => void
  /** after the plan was saved or cancelled, with the stored lease */
  onSaved?: (lease: Lease) => void
}

/**
 * Rencana keluar (SPEC 7.8): the tenant said he will leave; record his check-out day (the day he leaves, SPEC 7.3) so Cek
 * kamar offers the room from then. Nothing else changes: the invoices, end_date and the room stay as they are, and the
 * checkout itself is recorded when he really leaves. A recorded plan can be changed or cancelled here. Every member may
 * do it (front-desk work). Opened from the lease page (Lainnya) and from "Bisa kosong" in Cek kamar.
 */
export function PlannedCheckoutModal({ lease, tenantName, roomName, actions, initialDay, onClose, onSaved }: PlannedCheckoutModalProps) {
  const toast = useToast()
  const today = todayISO()
  const [day, setDay] = useState(initialDay ?? defaultPlannedCheckout(lease, today))
  const [saving, setSaving] = useState<'save' | 'clear' | null>(null)
  const current = lease.planned_checkout_date ?? null
  const error = plannedCheckoutError(lease, day)
  const note = error ? null : plannedCheckoutNote(lease, day)
  const past = !error && day < today

  const run = async (next: string | null) => {
    setSaving(next === null ? 'clear' : 'save')
    try {
      const saved = await actions.setPlannedCheckout(lease, next)
      toast.success(next === null ? `Rencana keluar ${tenantName} dibatalkan.` : `Rencana keluar ${tenantName} dicatat: check-out ${formatDate(next)}.`)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan rencana keluar.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Rencana keluar · Kamar ${roomName}`}
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={onClose}>
            Batal
          </Button>
          <Button size="lg" onClick={() => void run(day)} loading={saving === 'save'} disabled={Boolean(error) || saving !== null || day === current}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="planned-checkout-sheet">
        <p className="text-sm text-slate-600">
          <strong className="text-slate-900">{tenantName}</strong> bilang akan keluar? Catat hari check-out-nya: mulai hari itu kamar ditawarkan di Cek kamar. Tagihan
          dan sewa tidak berubah; catat <strong>Checkout</strong> saat ia benar-benar keluar.
        </p>
        <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
          <Row label="Ditagih s/d (check-out)" value={formatCheckout(lease.end_date)} />
          <Row label="Rencana keluar sekarang" value={current ? formatDate(current) : 'Belum ada'} />
        </div>
        <Input
          label="Tanggal keluar (check-out)"
          type="date"
          value={day}
          min={lease.start_date}
          onChange={(e) => setDay(e.target.value)}
          required
          error={error ?? undefined}
          hint="Hari penyewa meninggalkan kamar; malam itu kamar sudah kosong."
        />
        {note && (
          <p className="text-xs text-slate-600" data-testid="planned-checkout-note">
            {note}
          </p>
        )}
        {past && (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Tanggal ini sudah lewat. Bila penyewa sudah keluar, catat Checkout; selama checkout belum dicatat kamar tetap dianggap terisi.
          </p>
        )}
        {current && (
          <Button
            variant="outline"
            size="lg"
            fullWidth
            className="text-red-700"
            icon={<CalendarX2 className="h-4 w-4" aria-hidden />}
            onClick={() => void run(null)}
            loading={saving === 'clear'}
            disabled={saving !== null}
          >
            Batalkan rencana keluar
          </Button>
        )}
      </div>
    </Modal>
  )
}
