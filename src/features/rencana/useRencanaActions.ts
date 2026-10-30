/**
 * Writes of Rencana check-in & daftar tunggu (SPEC 7.7). A booking goes through the same path as Check-in cepat
 * (saveStayBooking: tenant -> lease -> first invoice via insertFromDraft -> DP -> invoice status), after a fresh read
 * of the room's leases: a room another phone booked meanwhile is refused with the booking named, before anything is
 * written. The database guard (leases_overlap_guard) catches the last race; its refusal is named the same way. A booking
 * for a daftar tunggu entry, and Batal / Aktifkan lagi, first re-read the entry: an entry another phone booked meanwhile
 * is never booked twice nor turned back (WAITLIST_CHANGED_MESSAGE).
 */
import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import { todayISO } from '../../lib/format'
import { LEASE_OVERLAP_MESSAGE } from '../../lib/repo/types'
import type { Invoice, Lease, Payment, PaymentMethod, PeriodType, Room, Tenant, WaitlistEntry } from '../../types/db'
import { QuickCheckInError, saveStayBooking } from '../quick/quickCheckIn'
import { useLeaseActions } from '../leases/useLeaseActions'
import { plannedStay, stayConflict } from './availability'
import { formToWaitlistInsert, formToWaitlistPatch, type WaitlistForm } from './waitlist'

export const WAITLIST_DELETE_STAFF_MESSAGE = 'Hanya pemilik/admin yang dapat menghapus data daftar tunggu. Pilih Batal saja.'
/** The entry was booked, cancelled or deleted on another phone after this screen read it. */
export const WAITLIST_CHANGED_MESSAGE = 'Entri daftar tunggu ini sudah dipesan, dibatalkan atau dihapus di HP lain. Muat ulang lalu periksa.'

export interface BookStayInput {
  room: Room
  periodType: PeriodType
  startDate: string
  quantity: number
  /** agreed total for the stay */
  total: number
  /** DP (or the whole total) paid now; 0 = nothing yet */
  paidAmount: number
  method: PaymentMethod
  /** existing tenant (same-name match), or null for a new one from name + phone */
  tenantId: string | null
  name: string
  phone: string
  notes: string | null
  /** optional: the tenant's vehicle plate(s) as typed; saveStayBooking writes them normalised (SPEC 7.11) */
  vehiclePlate?: string | null
  /** every invoice of the org (numbering) */
  orgInvoices: Invoice[]
  /** the daftar tunggu entry this booking is for: it becomes 'booked' with the new lease */
  waitlistId?: string | null
  /** the device's today (tests pin it) */
  today?: string
  /** free periods on top of `quantity` (Check-in cepat tahunan: "bonus 1 bulan") */
  bonusQuantity?: number
  /** uang jaminan agreed; paidNow records it as received with `method` */
  deposit?: { amount: number; paidNow: boolean } | null
}

export interface BookStayResult {
  lease: Lease
  invoice: Invoice
  payment: Payment | null
  depositPayment: Payment | null
  /** the booking is saved but the daftar tunggu entry could not be marked (shown as a warning) */
  waitlistError: string | null
}

export function useRencanaActions() {
  const { repo, role } = useOrg()
  const actions = useLeaseActions()
  const invalidate = useInvalidate()

  return useMemo(() => {
    const isAdmin = role === 'owner' || role === 'admin'

    /** The fresh conflict message for the room and stay, naming the tenant of the booking in the way; null when free. */
    async function freshConflict(room: Room, startDate: string, periodType: PeriodType, quantity: number, today: string): Promise<string | null> {
      const stay = plannedStay(startDate, periodType, quantity)
      if (!stay) return null
      const leases = await repo.list('leases', { where: { room_id: room.id } })
      const conflict = stayConflict(room, leases, stay, today)
      if (!conflict) return null
      const tenant = await repo.get('tenants', conflict.hold.lease.tenant_id).catch(() => null)
      const names = new Map<string, Pick<Tenant, 'full_name'>>(tenant ? [[tenant.id, tenant]] : [])
      return stayConflict(room, leases, stay, today, names)!.message
    }

    async function bookStay(input: BookStayInput): Promise<BookStayResult> {
      const today = input.today ?? todayISO()
      // the room is held for the paid and the bonus periods
      const periods = input.quantity + (input.bonusQuantity ?? 0)
      const stay = plannedStay(input.startDate, input.periodType, periods)
      if (!stay) throw new Error('Isi tanggal check-in dan jumlahnya.')
      try {
        // the daftar tunggu entry as stored now: another phone may have booked (or cancelled) this person meanwhile, in
        // another room too, which no room check would catch; a second booking would also replace the entry's lease link
        if (input.waitlistId) {
          const entry = await repo.get('waitlist', input.waitlistId)
          if (!entry || entry.status !== 'waiting') throw new Error(WAITLIST_CHANGED_MESSAGE)
        }
        // fresh rows right before writing: another phone may have booked the room or put it under repair meanwhile
        const room = await repo.get('rooms', input.room.id)
        if (!room) throw new Error('Kamar tidak ditemukan. Muat ulang lalu coba lagi.')
        if (room.status === 'maintenance') throw new Error(`Kamar ${room.name} sedang perbaikan.`)
        const taken = await freshConflict(room, input.startDate, input.periodType, periods, today)
        if (taken) throw new Error(taken)
        let saved: Awaited<ReturnType<typeof saveStayBooking>>
        try {
          saved = await saveStayBooking(
            {
              room,
              periodType: input.periodType,
              startDate: input.startDate,
              quantity: input.quantity,
              total: input.total,
              paidAmount: input.paidAmount,
              method: input.method,
              tenantId: input.tenantId,
              name: input.name,
              phone: input.phone,
              notes: input.notes,
              vehiclePlate: input.vehiclePlate ?? null,
              bonusQuantity: input.bonusQuantity ?? 0,
              deposit: input.deposit ?? null,
            },
            { repo, insertFromDraft: actions.insertFromDraft, canWriteInvoiceStatus: actions.canWriteInvoiceStatus, orgInvoices: input.orgInvoices, todayISO: today },
          )
        } catch (err) {
          // the database guard refused in the last moment (two phones at once): name the booking that won
          if (err instanceof QuickCheckInError && !err.lease && err.message === LEASE_OVERLAP_MESSAGE) {
            const named = await freshConflict(room, input.startDate, input.periodType, periods, today).catch(() => null)
            throw new QuickCheckInError(named ?? err.message, err.createdTenant, null)
          }
          throw err
        }
        let waitlistError: string | null = null
        if (input.waitlistId) {
          try {
            await repo.update('waitlist', input.waitlistId, { status: 'booked', lease_id: saved.lease.id })
          } catch (err) {
            waitlistError = err instanceof Error ? err.message : 'Daftar tunggu gagal diperbarui.'
          }
        }
        return { lease: saved.lease, invoice: saved.invoice, payment: saved.payment, depositPayment: saved.depositPayment, waitlistError }
      } finally {
        // also after a refusal, so the planner shows the room as it is now
        await invalidate('leases', 'invoices', 'payments', 'tenants', 'waitlist')
      }
    }

    async function addEntry(form: WaitlistForm): Promise<WaitlistEntry> {
      try {
        return await repo.insert('waitlist', formToWaitlistInsert(form))
      } finally {
        await invalidate('waitlist')
      }
    }

    async function updateEntry(entry: WaitlistEntry, form: WaitlistForm): Promise<WaitlistEntry> {
      try {
        return await repo.update('waitlist', entry.id, formToWaitlistPatch(form))
      } finally {
        await invalidate('waitlist')
      }
    }

    /**
     * 'Batal' (no longer wanted) or back to 'Menunggu'. Read fresh first: an entry another phone booked meanwhile keeps
     * its booking and lease link (a stale card must not turn it into Batal or Menunggu while the lease stays active).
     */
    async function setEntryStatus(entry: WaitlistEntry, status: 'waiting' | 'cancelled'): Promise<void> {
      try {
        const fresh = await repo.get('waitlist', entry.id)
        if (!fresh || fresh.status === 'booked') throw new Error(WAITLIST_CHANGED_MESSAGE)
        await repo.update('waitlist', entry.id, { status })
      } finally {
        await invalidate('waitlist')
      }
    }

    /** Owner/admin only (RLS online); staff cancel instead. */
    async function removeEntry(entry: WaitlistEntry): Promise<void> {
      if (!isAdmin) throw new Error(WAITLIST_DELETE_STAFF_MESSAGE)
      try {
        await repo.remove('waitlist', entry.id)
      } finally {
        await invalidate('waitlist')
      }
    }

    return { isAdmin, canDeleteEntries: isAdmin, bookStay, addEntry, updateEntry, setEntryStatus, removeEntry }
  }, [repo, role, actions, invalidate])
}

export type RencanaActions = ReturnType<typeof useRencanaActions>
