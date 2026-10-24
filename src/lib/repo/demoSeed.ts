import { addDays, addMonths, subMonths } from 'date-fns'
import type { Expense, Invoice, Lease, Payment, Room, Tenant } from '../../types/db'
import { newId } from '../ids'
import { toDateISO } from '../format'
import { emptyLocalDb, type LocalDb } from './localRepo'

export const DEMO_ORG_ID = 'demo-org'
export const DEMO_USER_ID = 'local-user'

/**
 * Builds a realistic demo dataset for a two-kos owner: ~6 months of history so the dashboard
 * and reports have something to show. Deterministic apart from `today`.
 */
export function buildDemoDb(today: Date = new Date()): LocalDb {
  const db = emptyLocalDb()
  const now = today.toISOString()
  const ts = { created_at: now, updated_at: now }

  db.organizations.push({ id: DEMO_ORG_ID, name: 'Kos Keluarga (Demo)', created_by: DEMO_USER_ID, created_at: now })
  db.organization_members.push({
    id: newId(),
    org_id: DEMO_ORG_ID,
    user_id: DEMO_USER_ID,
    email: 'demo@woombad.local',
    role: 'owner',
    created_at: now,
  })

  const kosA = newId()
  const kosB = newId()
  db.properties.push(
    { id: kosA, org_id: DEMO_ORG_ID, name: 'Kos Melati', address: 'Jl. Melati No. 12, Bandung', notes: null, payment_info: 'BCA 1234567890 a.n. Ibu Sari', logo_path: null, ...ts },
    { id: kosB, org_id: DEMO_ORG_ID, name: 'Kos Anggrek', address: 'Jl. Anggrek No. 5, Bandung', notes: 'Bangunan baru', payment_info: 'BCA 1234567890 a.n. Ibu Sari', logo_path: null, ...ts },
  )

  const mkRoom = (property_id: string, name: string, floor: string, monthly: number, daily: number): Room => ({
    id: newId(),
    org_id: DEMO_ORG_ID,
    property_id,
    name,
    floor,
    price_daily: daily,
    price_weekly: Math.round(daily * 6),
    price_monthly: monthly,
    status: 'active',
    notes: null,
    ...ts,
  })
  const roomsA = [
    mkRoom(kosA, 'A1', '1', 1_200_000, 90_000),
    mkRoom(kosA, 'A2', '1', 1_200_000, 90_000),
    mkRoom(kosA, 'A3', '1', 1_350_000, 100_000),
    mkRoom(kosA, 'B1', '2', 1_500_000, 110_000),
    mkRoom(kosA, 'B2', '2', 1_500_000, 110_000),
    mkRoom(kosA, 'B3', '2', 1_650_000, 120_000),
  ]
  const roomsB = [
    mkRoom(kosB, '101', '1', 1_800_000, 130_000),
    mkRoom(kosB, '102', '1', 1_800_000, 130_000),
    mkRoom(kosB, '201', '2', 2_000_000, 150_000),
    mkRoom(kosB, '202', '2', 2_000_000, 150_000),
  ]
  roomsB[3].status = 'maintenance'
  db.rooms.push(...roomsA, ...roomsB)

  db.addon_catalog.push(
    { id: newId(), org_id: DEMO_ORG_ID, property_id: null, name: 'Kasur tambahan', default_price: 150_000, billing: 'per_period', created_at: now },
    { id: newId(), org_id: DEMO_ORG_ID, property_id: null, name: 'Parkir motor', default_price: 50_000, billing: 'per_period', created_at: now },
    { id: newId(), org_id: DEMO_ORG_ID, property_id: null, name: 'Laundry', default_price: 100_000, billing: 'per_period', created_at: now },
    { id: newId(), org_id: DEMO_ORG_ID, property_id: null, name: 'Kunci cadangan', default_price: 25_000, billing: 'one_time', created_at: now },
  )

  const mkTenant = (property_id: string, full_name: string, phone: string, gender: 'L' | 'P', occupation: string): Tenant => ({
    id: newId(),
    org_id: DEMO_ORG_ID,
    property_id,
    full_name,
    nik: null,
    id_type: 'ktp',
    id_number: null,
    nationality: null,
    phone,
    gender,
    birth_place: null,
    birth_date: null,
    address: null,
    religion: null,
    marital_status: null,
    occupation,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    ktp_image_path: null,
    notes: null,
    ...ts,
  })
  const tenants = [
    mkTenant(kosA, 'Budi Santoso', '+6281234567801', 'L', 'Karyawan swasta'),
    mkTenant(kosA, 'Siti Rahayu', '+6281234567802', 'P', 'Mahasiswa'),
    mkTenant(kosA, 'Agus Pratama', '+6281234567803', 'L', 'Wiraswasta'),
    mkTenant(kosA, 'Dewi Lestari', '+6281234567804', 'P', 'Perawat'),
    mkTenant(kosB, 'Rizky Maulana', '+6281234567805', 'L', 'Programmer'),
    mkTenant(kosB, 'Putri Ayu', '+6281234567806', 'P', 'Guru'),
    mkTenant(kosB, 'Hendra Wijaya', '+6281234567807', 'L', 'Sales'),
  ]
  db.tenants.push(...tenants)

  // Monthly leases that started 5 months ago; invoices each month; most paid, latest ones partially / unpaid.
  const start = addDays(subMonths(today, 5), -3)
  const monthlyLeaseFor = (room: Room, tenant: Tenant, monthsPaid: number, deposit: number, addons: { name: string; amount: number }[] = []) => {
    const leaseId = newId()
    const periods = 6
    const lease: Lease = {
      id: leaseId,
      org_id: DEMO_ORG_ID,
      property_id: room.property_id,
      room_id: room.id,
      tenant_id: tenant.id,
      period_type: 'monthly',
      price_per_period: room.price_monthly!,
      deposit_amount: deposit,
      start_date: toDateISO(start),
      end_date: toDateISO(addDays(addMonths(start, periods), -1)),
      status: 'active',
      checkout_date: null,
      notes: null,
      ...ts,
    }
    db.leases.push(lease)
    const addonsTotal = addons.reduce((s, a) => s + a.amount, 0)
    for (const a of addons) {
      db.lease_addons.push({ id: newId(), org_id: DEMO_ORG_ID, lease_id: leaseId, name: a.name, amount: a.amount, billing: 'per_period', created_at: now })
    }
    if (deposit > 0) {
      db.payments.push({
        id: newId(), org_id: DEMO_ORG_ID, property_id: room.property_id, invoice_id: null, lease_id: leaseId,
        amount: deposit, paid_at: toDateISO(start), method: 'transfer', kind: 'deposit', notes: 'Uang jaminan', created_by: null, created_at: now,
      })
    }
    for (let i = 0; i < periods; i++) {
      const ps = addMonths(start, i)
      const pe = addDays(addMonths(start, i + 1), -1)
      if (ps > today) break
      const total = lease.price_per_period + addonsTotal
      const invoiceId = newId()
      let status: Invoice['status'] = 'unpaid'
      const pays: Payment[] = []
      if (i < monthsPaid) {
        status = 'paid'
        pays.push({
          id: newId(), org_id: DEMO_ORG_ID, property_id: room.property_id, invoice_id: invoiceId, lease_id: leaseId,
          amount: total, paid_at: toDateISO(addDays(ps, i % 3)), method: i % 2 ? 'cash' : 'transfer', kind: 'rent', notes: null, created_by: null, created_at: now,
        })
      } else if (i === monthsPaid && tenant.full_name.startsWith('Agus')) {
        status = 'partial'
        pays.push({
          id: newId(), org_id: DEMO_ORG_ID, property_id: room.property_id, invoice_id: invoiceId, lease_id: leaseId,
          amount: Math.round(total / 2), paid_at: toDateISO(ps), method: 'qris', kind: 'rent', notes: 'DP', created_by: null, created_at: now,
        })
      }
      db.invoices.push({
        id: invoiceId, org_id: DEMO_ORG_ID, property_id: room.property_id, lease_id: leaseId,
        invoice_number: `INV-${toDateISO(ps).replace(/-/g, '').slice(0, 6)}-${String(db.invoices.length + 1).padStart(4, '0')}`,
        period_type: 'monthly',
        period_start: toDateISO(ps), period_end: toDateISO(pe), quantity: 1,
        base_amount: lease.price_per_period, addons_amount: addonsTotal, extra_amount: 0, discount_amount: 0,
        total_amount: total, due_date: toDateISO(ps), status, notes: null, ...ts,
      })
      db.payments.push(...pays)
    }
  }

  monthlyLeaseFor(roomsA[0], tenants[0], 6, 1_200_000, [{ name: 'Parkir motor', amount: 50_000 }])
  monthlyLeaseFor(roomsA[1], tenants[1], 5, 1_200_000)
  monthlyLeaseFor(roomsA[3], tenants[2], 5, 0, [{ name: 'Kasur tambahan', amount: 150_000 }])
  monthlyLeaseFor(roomsA[4], tenants[3], 6, 1_500_000)
  monthlyLeaseFor(roomsB[0], tenants[4], 6, 1_800_000, [{ name: 'Laundry', amount: 100_000 }])
  monthlyLeaseFor(roomsB[2], tenants[5], 4, 2_000_000)

  // A short daily stay in Kos Anggrek 102 (paid in full), ending in 3 days.
  {
    const room = roomsB[1]
    const tenant = tenants[6]
    const leaseId = newId()
    const s = addDays(today, -4)
    const e = addDays(today, 3)
    const nights = 8
    db.leases.push({
      id: leaseId, org_id: DEMO_ORG_ID, property_id: room.property_id, room_id: room.id, tenant_id: tenant.id,
      period_type: 'daily', price_per_period: room.price_daily!, deposit_amount: 0,
      start_date: toDateISO(s), end_date: toDateISO(e), status: 'active', checkout_date: null, notes: 'Tamu proyek', ...ts,
    })
    const invoiceId = newId()
    const total = room.price_daily! * nights
    db.invoices.push({
      id: invoiceId, org_id: DEMO_ORG_ID, property_id: room.property_id, lease_id: leaseId,
      invoice_number: `INV-${toDateISO(s).replace(/-/g, '').slice(0, 6)}-${String(db.invoices.length + 1).padStart(4, '0')}`,
      period_type: 'daily',
      period_start: toDateISO(s), period_end: toDateISO(e), quantity: nights,
      base_amount: total, addons_amount: 0, extra_amount: 0, discount_amount: 0, total_amount: total,
      due_date: toDateISO(s), status: 'paid', notes: null, ...ts,
    })
    db.payments.push({
      id: newId(), org_id: DEMO_ORG_ID, property_id: room.property_id, invoice_id: invoiceId, lease_id: leaseId,
      amount: total, paid_at: toDateISO(s), method: 'cash', kind: 'rent', notes: null, created_by: null, created_at: now,
    })
  }

  // Daftar tunggu (SPEC 7.7): a daily guest a free room fits, a weekly guest no room fits yet, one who cancelled.
  db.waitlist.push(
    {
      id: newId(), org_id: DEMO_ORG_ID, property_id: kosA, name: 'Rina Kartika', phone: '+6281234567811',
      wanted_from: toDateISO(addDays(today, 2)), period_type: 'daily', quantity: 2, max_price: 110_000,
      room_note: 'Lantai bawah', notes: null, status: 'waiting', lease_id: null, created_by: null, ...ts,
    },
    {
      id: newId(), org_id: DEMO_ORG_ID, property_id: kosB, name: 'Joko Susilo', phone: '+6281234567812',
      wanted_from: toDateISO(addDays(today, 1)), period_type: 'weekly', quantity: 2, max_price: null,
      room_note: 'Kamar mandi dalam', notes: 'Kerja proyek 2 minggu', status: 'waiting', lease_id: null, created_by: null, ...ts,
    },
    {
      id: newId(), org_id: DEMO_ORG_ID, property_id: kosA, name: 'Wulan Sari', phone: null,
      wanted_from: toDateISO(addDays(today, -5)), period_type: 'daily', quantity: 3, max_price: null,
      room_note: null, notes: 'Batal, sudah dapat tempat lain', status: 'cancelled', lease_id: null, created_by: null, ...ts,
    },
  )

  // Expenses: monthly wages + utilities per property, a few maintenance items.
  const mkExpense = (property_id: string | null, category: Expense['category'], amount: number, date: Date, description: string, vendor: string | null = null): Expense => ({
    id: newId(), org_id: DEMO_ORG_ID, property_id, lease_id: null, category, amount, expense_date: toDateISO(date), description, vendor, receipt_path: null, created_by: null, ...ts,
  })
  for (let i = 5; i >= 0; i--) {
    const m = subMonths(today, i)
    if (addDays(m, 0) > today) continue
    db.expenses.push(
      mkExpense(null, 'wages', 1_500_000, addDays(subMonths(today, i), -2), 'Gaji penjaga kos', 'Pak Udin'),
      mkExpense(kosA, 'utilities', 850_000 + (i % 3) * 40_000, addDays(subMonths(today, i), -5), 'Listrik & air Kos Melati', 'PLN / PDAM'),
      mkExpense(kosB, 'utilities', 700_000 + (i % 2) * 60_000, addDays(subMonths(today, i), -5), 'Listrik & air Kos Anggrek', 'PLN / PDAM'),
      mkExpense(kosA, 'utilities', 350_000, addDays(subMonths(today, i), -7), 'Internet Kos Melati', 'Indihome'),
    )
    if (i === 4) db.expenses.push(mkExpense(kosA, 'maintenance', 650_000, addDays(subMonths(today, i), 3), 'Perbaikan pompa air', 'Tukang Asep'))
    if (i === 2) db.expenses.push(mkExpense(kosB, 'maintenance', 1_200_000, addDays(subMonths(today, i), 9), 'Cat ulang kamar 202', 'Tukang Asep'))
    if (i === 1) db.expenses.push(mkExpense(kosA, 'supplies', 180_000, addDays(subMonths(today, i), 12), 'Sapu, pel, sabun'))
    if (i === 0) db.expenses.push(mkExpense(null, 'tax', 500_000, addDays(today, -1), 'PBB tahunan (cicilan)'))
  }

  return db
}
