import { describe, expect, it } from 'vitest'
import type { Lease, Payment, Tenant } from '../../types/db'
import {
  applyScanPrefill,
  currentStayFor,
  describeIdentity,
  describeRoom,
  EMPTY_TENANT_FORM,
  filterTenantsByProperty,
  formToScanPrefill,
  formToTenantPayload,
  identityColumns,
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
    id_type: 'ktp',
    id_number: null,
    nationality: null,
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

describe('identity columns (KTP / Paspor / Lainnya)', () => {
  const base = { ...EMPTY_TENANT_FORM, full_name: 'John Smith', property_id: 'kosA' }

  it('KTP keeps the NIK and clears passport columns', () => {
    const p = formToTenantPayload({ ...base, id_type: 'ktp', nik: '3273 0105 0390 0001', id_number: 'N123', nationality: 'AUS' })
    expect(p).toMatchObject({ id_type: 'ktp', nik: '3273010503900001', id_number: null, nationality: null })
  })

  it('passport keeps id_number (upper-cased, no spaces) + nationality code and clears nik', () => {
    const p = formToTenantPayload({ ...base, id_type: 'passport', nik: '3273010503900001', id_number: ' n123 4567 ', nationality: 'aus' })
    expect(p).toMatchObject({ id_type: 'passport', nik: null, id_number: 'N1234567', nationality: 'AUS' })
    expect(formToTenantPayload({ ...base, id_type: 'passport', nationality: 'Australia' }).nationality).toBe('Australia')
    expect(formToTenantPayload({ ...base, id_type: 'passport' })).toMatchObject({ id_number: null, nationality: null })
  })

  it('other keeps only id_number', () => {
    expect(identityColumns({ id_type: 'other', nik: '1', id_number: 'sim-123', nationality: 'AUS' })).toEqual({ id_type: 'other', nik: null, id_number: 'SIM-123', nationality: null })
  })

  it('round-trips a passport row through the form', () => {
    const t = tenant({ id_type: 'passport', nik: null, id_number: 'N1234567', nationality: 'AUS' })
    const form = tenantToForm(t)
    expect(form).toMatchObject({ id_type: 'passport', nik: '', id_number: 'N1234567', nationality: 'AUS' })
    expect(formToTenantPayload(form)).toMatchObject({ id_type: 'passport', nik: null, id_number: 'N1234567', nationality: 'AUS' })
  })

  it('validates the number of the selected document only', () => {
    expect(validateTenantForm({ ...base, id_type: 'passport', nik: 'abc', id_number: 'N1234567' })).toEqual({})
    expect(validateTenantForm({ ...base, id_type: 'passport', id_number: 'N1' }).id_number).toMatch(/paspor/i)
    expect(validateTenantForm({ ...base, id_type: 'passport', id_number: 'N12#4567' }).id_number).toBeDefined()
    expect(validateTenantForm({ ...base, id_type: 'passport', nationality: '123' }).nationality).toBeDefined()
    expect(validateTenantForm({ ...base, id_type: 'passport', nationality: 'AUS' })).toEqual({})
    expect(validateTenantForm({ ...base, id_type: 'other', id_number: 'SIM-12345' })).toEqual({})
    expect(validateTenantForm({ ...base, id_type: 'ktp', nik: '12345' }).nik).toBeDefined()
  })

  it('describeIdentity labels the document and its number', () => {
    expect(describeIdentity(tenant())).toEqual({ label: 'KTP', number: '3273010503900001', text: 'KTP 3273010503900001' })
    expect(describeIdentity(tenant({ id_type: 'passport', nik: null, id_number: 'N1234567', nationality: 'AUS' })).text).toBe('Paspor N1234567 · AUS')
    expect(describeIdentity(tenant({ id_type: 'passport', nik: null, id_number: 'N1234567', nationality: null })).text).toBe('Paspor N1234567')
    expect(describeIdentity(tenant({ id_type: 'other', nik: null, id_number: 'X1' })).text).toBe('Lainnya X1')
    expect(describeIdentity(tenant({ nik: null }))).toEqual({ label: 'KTP', number: null, text: null })
  })

  it('search also matches the passport number', () => {
    const t = tenant({ id_type: 'passport', nik: null, id_number: 'N1234567' })
    expect(matchesTenantSearch(t, 'n1234')).toBe(true)
    expect(matchesTenantSearch(t, '3273')).toBe(false)
  })
})

describe('scanner glue', () => {
  it('formToScanPrefill turns empty strings into undefined and keeps id_type', () => {
    const cur = formToScanPrefill({ ...EMPTY_TENANT_FORM, full_name: 'Budi', id_type: 'passport' })
    expect(cur).toMatchObject({ id_type: 'passport', full_name: 'Budi' })
    expect(cur.nik).toBeUndefined()
    expect(cur.gender).toBeUndefined()
  })

  it('applyScanPrefill switches the document type, writes present fields and never touches phone', () => {
    const current = { ...EMPTY_TENANT_FORM, full_name: 'Budi S', phone: '0812', nik: '3273010503900001' }
    const next = applyScanPrefill(current, { id_type: 'passport', id_number: 'N1234567', nationality: 'AUS', gender: 'P', address: 'Jl. Melati' })
    expect(next.full_name).toBe('Budi S')
    expect(next.id_type).toBe('passport')
    expect(next.id_number).toBe('N1234567')
    expect(next.nationality).toBe('AUS')
    expect(next.gender).toBe('P')
    expect(next.address).toBe('Jl. Melati')
    expect(next.phone).toBe('0812')
    expect(next.nik).toBe('3273010503900001') // kept in the form; identityColumns drops it on save
    const ktp = applyScanPrefill(next, { id_type: 'ktp', nik: '1111111111111111', full_name: 'Budi Santoso' })
    expect(ktp.id_type).toBe('ktp')
    expect(ktp.nik).toBe('1111111111111111')
    expect(ktp.full_name).toBe('Budi Santoso')
  })
})
