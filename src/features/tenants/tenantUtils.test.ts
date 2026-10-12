import { describe, expect, it } from 'vitest'
import type { Lease, Payment, Tenant } from '../../types/db'
import {
  applyPrefill,
  currentStayFor,
  describeRoom,
  diffPrefill,
  EMPTY_TENANT_FORM,
  filterTenantsByProperty,
  formToTenantPayload,
  initialTenantForm,
  initials,
  leasesOfTenant,
  matchesTenantSearch,
  paymentsOfLeases,
  tenantToForm,
  validateTenantForm,
} from './tenantUtils'

const ts = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

function tenant(partial: Partial<Tenant> = {}): Tenant {
  return {
    id: 't1',
    org_id: 'o',
    property_id: 'kosA',
    full_name: 'Budi Santoso',
    nik: '3273010503900001',
    phone: '+6281234567801',
    gender: 'L',
    birth_place: 'Bandung',
    birth_date: '1990-03-05',
    address: null,
    religion: null,
    marital_status: null,
    occupation: 'Karyawan',
    emergency_contact_name: null,
    emergency_contact_phone: null,
    ktp_image_path: null,
    notes: null,
    ...ts,
    ...partial,
  }
}

function lease(partial: Partial<Lease>): Lease {
  return {
    id: 'l1',
    org_id: 'o',
    property_id: 'kosA',
    room_id: 'r1',
    tenant_id: 't1',
    period_type: 'monthly',
    price_per_period: 1_000_000,
    deposit_amount: 0,
    start_date: '2026-01-01',
    end_date: '2026-06-30',
    status: 'active',
    checkout_date: null,
    notes: null,
    ...ts,
    ...partial,
  }
}

describe('validateTenantForm', () => {
  it('requires a name and a kos', () => {
    const errors = validateTenantForm({ ...EMPTY_TENANT_FORM })
    expect(errors.full_name).toMatch(/wajib/i)
    expect(errors.property_id).toMatch(/kos/i)
  })

  it('accepts a minimal valid form', () => {
    expect(validateTenantForm({ ...EMPTY_TENANT_FORM, full_name: 'Siti', property_id: 'kosA' })).toEqual({})
  })

  it('flags a NIK that is not 16 digits (with the current length) and non-numeric NIK', () => {
    const base = { ...EMPTY_TENANT_FORM, full_name: 'Siti', property_id: 'kosA' }
    expect(validateTenantForm({ ...base, nik: '12345' }).nik).toContain('5 digit')
    expect(validateTenantForm({ ...base, nik: '3273 0105 0390 0001' })).toEqual({}) // spaces tolerated
    expect(validateTenantForm({ ...base, nik: '3273O10503900001' }).nik).toMatch(/angka/)
  })

  it('validates phone numbers (normalised) and birth date', () => {
    const base = { ...EMPTY_TENANT_FORM, full_name: 'Siti', property_id: 'kosA' }
    expect(validateTenantForm({ ...base, phone: '0812-3456-7890' })).toEqual({})
    expect(validateTenantForm({ ...base, phone: '12' }).phone).toBeDefined()
    expect(validateTenantForm({ ...base, phone: 'abc' }).phone).toBeDefined()
    expect(validateTenantForm({ ...base, emergency_contact_phone: '08' }).emergency_contact_phone).toBeDefined()
    expect(validateTenantForm({ ...base, birth_date: '2026-02-30' }).birth_date).toBeDefined()
    expect(validateTenantForm({ ...base, birth_date: '2024-02-29' })).toEqual({})
  })
})

describe('formToTenantPayload / tenantToForm', () => {
  it('normalises phones to +62 and turns blanks into null', () => {
    const payload = formToTenantPayload({
      ...EMPTY_TENANT_FORM,
      full_name: '  Budi Santoso ',
      phone: '0812-3456-7801',
      emergency_contact_phone: '62 813 0000 1111',
      nik: '3273 0105 0390 0001',
      property_id: 'kosA',
      gender: 'L',
    })
    expect(payload.full_name).toBe('Budi Santoso')
    expect(payload.phone).toBe('+6281234567801')
    expect(payload.emergency_contact_phone).toBe('+6281300001111')
    expect(payload.nik).toBe('3273010503900001')
    expect(payload.gender).toBe('L')
    expect(payload.address).toBeNull()
    expect(payload.religion).toBeNull()
    expect(payload.ktp_image_path).toBeNull()
  })

  it('round-trips a row through the form', () => {
    const t = tenant({ address: 'Jl. Melati 1', gender: null })
    const form = tenantToForm(t)
    expect(form.gender).toBe('')
    expect(form.address).toBe('Jl. Melati 1')
    const back = formToTenantPayload(form)
    expect(back.full_name).toBe(t.full_name)
    expect(back.nik).toBe(t.nik)
    expect(back.phone).toBe(t.phone)
    expect(back.gender).toBeNull()
    expect(back.property_id).toBe('kosA')
  })

  it('initialTenantForm preselects the global kos, or the only kos, otherwise nothing', () => {
    const props = [{ id: 'a' }, { id: 'b' }]
    expect(initialTenantForm('b', props).property_id).toBe('b')
    expect(initialTenantForm('all', props).property_id).toBe('')
    expect(initialTenantForm('zzz', props).property_id).toBe('')
    expect(initialTenantForm('all', [{ id: 'only' }]).property_id).toBe('only')
  })
})

describe('matchesTenantSearch', () => {
  const t = tenant()
  it('matches name case-insensitively, NIK and phone (local or international form)', () => {
    expect(matchesTenantSearch(t, 'budi')).toBe(true)
    expect(matchesTenantSearch(t, 'SANTOSO')).toBe(true)
    expect(matchesTenantSearch(t, '327301')).toBe(true)
    expect(matchesTenantSearch(t, '0812 3456')).toBe(true)
    expect(matchesTenantSearch(t, '+62812')).toBe(true)
    expect(matchesTenantSearch(t, '  ')).toBe(true)
    expect(matchesTenantSearch(t, 'siti')).toBe(false)
    expect(matchesTenantSearch(t, '999')).toBe(false)
  })
  it('does not match phone/NIK when they are null', () => {
    expect(matchesTenantSearch(tenant({ nik: null, phone: null }), '0812')).toBe(false)
  })
})

describe('filterTenantsByProperty', () => {
  const rows = [tenant({ id: '1', property_id: 'a' }), tenant({ id: '2', property_id: 'b' }), tenant({ id: '3', property_id: null })]
  it('shows unassigned tenants only with "Semua kos"', () => {
    expect(filterTenantsByProperty(rows, ['a', 'b'], 'all').map((t) => t.id)).toEqual(['1', '2', '3'])
    expect(filterTenantsByProperty(rows, ['a'], 'a').map((t) => t.id)).toEqual(['1'])
  })
})

describe('currentStayFor', () => {
  const today = '2026-03-15'
  it('returns the occupying active lease', () => {
    const stay = currentStayFor('t1', [lease({})], today)
    expect(stay?.kind).toBe('occupied')
  })
  it('keeps an active lease occupied even after end_date (until checkout)', () => {
    const stay = currentStayFor('t1', [lease({ end_date: '2026-02-01' })], today)
    expect(stay?.kind).toBe('occupied')
  })
  it('reports a future active lease as reserved and ignores ended/cancelled ones', () => {
    const leases = [
      lease({ id: 'old', status: 'ended', end_date: '2026-02-01', checkout_date: '2026-02-01' }),
      lease({ id: 'x', status: 'cancelled' }),
      lease({ id: 'future', start_date: '2026-04-01', end_date: '2026-04-30' }),
    ]
    const stay = currentStayFor('t1', leases, today)
    expect(stay?.kind).toBe('reserved')
    expect(stay?.lease.id).toBe('future')
  })
  it('returns null when the tenant has no lease / only ended leases / someone else\'s leases', () => {
    expect(currentStayFor('t1', [], today)).toBeNull()
    expect(currentStayFor('t1', [lease({ status: 'ended', checkout_date: '2026-03-01' })], today)).toBeNull()
    expect(currentStayFor('t1', [lease({ tenant_id: 't2' })], today)).toBeNull()
  })
})

describe('history helpers', () => {
  it('leasesOfTenant sorts newest first; paymentsOfLeases filters by lease and sorts by paid_at desc', () => {
    const leases = [lease({ id: 'a', start_date: '2025-01-01' }), lease({ id: 'b', start_date: '2026-01-01' }), lease({ id: 'c', tenant_id: 't2' })]
    expect(leasesOfTenant('t1', leases).map((l) => l.id)).toEqual(['b', 'a'])
    const pay = (id: string, lease_id: string | null, paid_at: string): Payment => ({
      id,
      org_id: 'o',
      property_id: 'kosA',
      invoice_id: null,
      lease_id,
      amount: 1,
      paid_at,
      method: 'cash',
      kind: 'deposit',
      notes: null,
      created_by: null,
      created_at: ts.created_at,
    })
    const payments = [pay('p1', 'a', '2025-01-02'), pay('p2', 'c', '2026-02-02'), pay('p3', 'b', '2026-01-02'), pay('p4', null, '2026-03-02')]
    expect(paymentsOfLeases(['a', 'b'], payments).map((p) => p.id)).toEqual(['p3', 'p1'])
  })

  it('describeRoom falls back when room / kos are missing', () => {
    const l = lease({ room_id: 'r1', property_id: 'kosA' })
    expect(describeRoom(l, [{ id: 'r1', name: 'A1' }], [{ id: 'kosA', name: 'Kos Melati' }])).toBe('A1 · Kos Melati')
    expect(describeRoom(l, [], [{ id: 'kosA', name: 'Kos Melati' }])).toBe('Kamar? · Kos Melati')
    expect(describeRoom(l, [{ id: 'r1', name: 'A1' }], [])).toBe('A1')
  })

  it('initials', () => {
    expect(initials('Budi Santoso')).toBe('BS')
    expect(initials('Siti')).toBe('S')
    expect(initials('  ')).toBe('?')
    expect(initials('Agus Dwi Pratama')).toBe('AP')
  })
})

describe('OCR prefill merge', () => {
  it('pre-checks empty fields and leaves typed, different values unchecked', () => {
    const current = { ...EMPTY_TENANT_FORM, full_name: 'Budi S', nik: '3273010503900001' }
    const diff = diffPrefill({ full_name: 'Budi Santoso', nik: '3273010503900001', gender: 'L', birth_date: '1990-03-05' }, current)
    expect(diff.map((d) => d.key)).toEqual(['full_name', 'nik', 'gender', 'birth_date'])
    expect(diff.find((d) => d.key === 'full_name')?.apply).toBe(false) // user typed something else
    expect(diff.find((d) => d.key === 'nik')?.apply).toBe(true) // equal
    expect(diff.find((d) => d.key === 'gender')?.apply).toBe(true) // empty
  })

  it('applyPrefill only writes checked entries and never touches phone', () => {
    const current = { ...EMPTY_TENANT_FORM, full_name: 'Budi S', phone: '0812' }
    const diff = diffPrefill({ full_name: 'Budi Santoso', gender: 'P', address: 'Jl. Melati' }, current)
    const next = applyPrefill(current, diff)
    expect(next.full_name).toBe('Budi S')
    expect(next.gender).toBe('P')
    expect(next.address).toBe('Jl. Melati')
    expect(next.phone).toBe('0812')
    const forced = applyPrefill(current, diff.map((d) => ({ ...d, apply: true })))
    expect(forced.full_name).toBe('Budi Santoso')
  })

  it('skips empty detected values', () => {
    expect(diffPrefill({ full_name: '', occupation: 'Guru' }, EMPTY_TENANT_FORM).map((d) => d.key)).toEqual(['occupation'])
  })
})
