import { describe, expect, it } from 'vitest'
import type { Invoice, Lease, Payment, Room, Tenant } from '../../types/db'
import {
  buildBulkRoomNames,
  findDuplicateRoomNames,
  roomDisplayState,
  roomPriceLabel,
  sortRoomsNatural,
  validateAddonForm,
  validatePropertyForm,
  validateRoomForm,
} from './roomUtils'

const ts = { org_id: 'org', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

function mkRoom(over: Partial<Room> = {}): Room {
  return {
    id: 'r1',
    property_id: 'p1',
    name: 'A1',
    floor: '1',
    price_daily: 90_000,
    price_weekly: 540_000,
    price_monthly: 1_200_000,
    status: 'active',
    notes: null,
    ...ts,
    ...over,
  }
}

function mkLease(over: Partial<Lease> = {}): Lease {
  return {
    id: 'l1',
    property_id: 'p1',
    room_id: 'r1',
    tenant_id: 't1',
    period_type: 'monthly',
    price_per_period: 1_200_000,
    deposit_amount: 0,
    start_date: '2026-01-01',
    end_date: '2026-01-31',
    status: 'active',
    checkout_date: null,
    notes: null,
    ...ts,
    ...over,
  }
}

function mkInvoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'i1',
    property_id: 'p1',
    lease_id: 'l1',
    invoice_number: 'INV-202601-0001',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    quantity: 1,
    base_amount: 1_200_000,
    addons_amount: 0,
    extra_amount: 0,
    discount_amount: 0,
    total_amount: 1_200_000,
    due_date: '2026-01-01',
    status: 'unpaid',
    notes: null,
    ...ts,
    ...over,
  }
}

function mkPayment(over: Partial<Payment> = {}): Payment {
  return {
    id: 'pay1',
    property_id: 'p1',
    invoice_id: 'i1',
    lease_id: 'l1',
    amount: 1_200_000,
    paid_at: '2026-01-02',
    method: 'cash',
    kind: 'rent',
    notes: null,
    created_by: null,
    org_id: 'org',
    created_at: ts.created_at,
    ...over,
  }
}

const tenant: Tenant = {
  id: 't1',
  property_id: 'p1',
  full_name: 'Budi',
  nik: null,
  phone: null,
  gender: null,
  birth_place: null,
  birth_date: null,
  address: null,
  religion: null,
  marital_status: null,
  occupation: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  ktp_image_path: null,
  notes: null,
  ...ts,
}
const tenants = new Map([[tenant.id, tenant]])

describe('sortRoomsNatural', () => {
  it('sorts A1 < A2 < A10 and ignores case', () => {
    const rooms = [{ name: 'A10' }, { name: 'a2' }, { name: 'A1' }, { name: 'B1' }]
    expect(sortRoomsNatural(rooms).map((r) => r.name)).toEqual(['A1', 'a2', 'A10', 'B1'])
  })
  it('does not mutate the input', () => {
    const rooms = [{ name: 'B' }, { name: 'A' }]
    sortRoomsNatural(rooms)
    expect(rooms[0].name).toBe('B')
  })
})

describe('buildBulkRoomNames', () => {
  it('builds prefix + numbers inclusive', () => {
    expect(buildBulkRoomNames('A', 1, 3)).toEqual(['A1', 'A2', 'A3'])
  })
  it('pads when asked', () => {
    expect(buildBulkRoomNames('K', 9, 11, true)).toEqual(['K09', 'K10', 'K11'])
  })
  it('trims the prefix and accepts an empty one', () => {
    expect(buildBulkRoomNames(' ', 101, 102)).toEqual(['101', '102'])
  })
  it('rejects to < from, non-integers and oversized ranges', () => {
    expect(() => buildBulkRoomNames('A', 5, 2)).toThrow(/lebih besar/)
    expect(() => buildBulkRoomNames('A', 1.5, 2)).toThrow(/bilangan bulat/)
    expect(() => buildBulkRoomNames('A', 1, 500)).toThrow(/Maksimal/)
    expect(() => buildBulkRoomNames('A', -1, 2)).toThrow(/negatif/)
  })
})

describe('findDuplicateRoomNames', () => {
  it('is case-insensitive, trims, and lists each duplicate once', () => {
    expect(findDuplicateRoomNames(['a1', ' A2 ', 'A3', 'A1'], ['A1', 'A2'])).toEqual(['a1', 'A2'])
  })
  it('returns [] when nothing clashes', () => {
    expect(findDuplicateRoomNames(['C1'], ['A1'])).toEqual([])
  })
})

describe('roomPriceLabel', () => {
  it('prefers monthly, then weekly, then daily', () => {
    expect(roomPriceLabel({ price_monthly: 1_200_000, price_weekly: 1, price_daily: 1 })).toBe('Rp 1.200.000 / bulan')
    expect(roomPriceLabel({ price_monthly: null, price_weekly: 300_000, price_daily: 1 })).toBe('Rp 300.000 / minggu')
    expect(roomPriceLabel({ price_monthly: null, price_weekly: null, price_daily: 90_000 })).toBe('Rp 90.000 / malam')
    expect(roomPriceLabel({ price_monthly: null, price_weekly: null, price_daily: null })).toBe('Harga belum diisi')
  })
})

describe('roomDisplayState', () => {
  const today = '2026-01-15'

  it('maintenance wins even with an active lease', () => {
    const s = roomDisplayState(mkRoom({ status: 'maintenance' }), [mkLease()], tenants, [], [], today)
    expect(s.kind).toBe('maintenance')
    expect(s.lease).toBeNull()
  })

  it('occupied: tenant, paidThrough and outstanding from billing summary', () => {
    const s = roomDisplayState(mkRoom(), [mkLease()], tenants, [mkInvoice()], [mkPayment()], today)
    expect(s.kind).toBe('occupied')
    expect(s.tenant?.full_name).toBe('Budi')
    expect(s.paidThrough).toBe('2026-01-31')
    expect(s.outstanding).toBe(0)
  })

  it('occupied with unpaid invoice has outstanding and no paidThrough', () => {
    const s = roomDisplayState(mkRoom(), [mkLease()], tenants, [mkInvoice()], [], today)
    expect(s.kind).toBe('occupied')
    expect(s.paidThrough).toBeNull()
    expect(s.outstanding).toBe(1_200_000)
  })

  it('reserved: earliest future active lease', () => {
    const later = mkLease({ id: 'l3', start_date: '2026-03-01', end_date: '2026-03-31' })
    const sooner = mkLease({ id: 'l2', start_date: '2026-02-01', end_date: '2026-02-28', tenant_id: 'tX' })
    const s = roomDisplayState(mkRoom(), [later, sooner], tenants, [], [], today)
    expect(s.kind).toBe('reserved')
    expect(s.lease?.id).toBe('l2')
    expect(s.startDate).toBe('2026-02-01')
    expect(s.tenant).toBeNull()
  })

  it('ended, cancelled and other-room leases do not occupy', () => {
    const leases = [
      mkLease({ id: 'a', status: 'ended', checkout_date: '2026-01-10' }),
      mkLease({ id: 'b', status: 'cancelled' }),
      mkLease({ id: 'c', room_id: 'other' }),
    ]
    expect(roomDisplayState(mkRoom(), leases, tenants, [], [], today).kind).toBe('vacant')
  })

  it('an active lease past end_date still occupies until checkout', () => {
    const s = roomDisplayState(mkRoom(), [mkLease({ end_date: '2026-01-10' })], tenants, [], [], today)
    expect(s.kind).toBe('occupied')
  })
})

describe('form validation', () => {
  it('property requires a name', () => {
    expect(validatePropertyForm({ name: '  ', address: '', notes: '', payment_info: '' })).toEqual({ name: 'Nama kos wajib diisi.' })
    expect(validatePropertyForm({ name: 'Kos', address: '', notes: '', payment_info: '' })).toEqual({})
  })

  it('room requires a unique name and at least one price', () => {
    const base = { name: 'A1', floor: '', price_daily: 0, price_weekly: 0, price_monthly: 0, status: 'active' as const, notes: '' }
    expect(validateRoomForm(base, { existingNames: [] }).price_monthly).toMatch(/minimal satu harga/)
    expect(validateRoomForm({ ...base, price_monthly: 100 }, { existingNames: ['a1'] }).name).toMatch(/sudah ada/)
    expect(validateRoomForm({ ...base, name: '', price_monthly: 100 }, { existingNames: [] }).name).toBe('Nama kamar wajib diisi.')
    expect(validateRoomForm({ ...base, price_monthly: 100, price_daily: -5 }, { existingNames: [] }).price_daily).toMatch(/negatif/)
    expect(validateRoomForm({ ...base, price_monthly: 100 }, { existingNames: [] })).toEqual({})
  })

  it('addon requires a name and non-negative price', () => {
    expect(validateAddonForm({ name: '', default_price: 0, billing: 'per_period', scope: 'org' }).name).toBeDefined()
    expect(validateAddonForm({ name: 'Parkir', default_price: -1, billing: 'per_period', scope: 'org' }).default_price).toBeDefined()
    expect(validateAddonForm({ name: 'Parkir', default_price: 50_000, billing: 'one_time', scope: 'property' })).toEqual({})
  })
})
