import { describe, expect, it } from 'vitest'
import type { AuditLogEntry } from '../../../types/db'
import { ALREADY_RESTORED_MESSAGE, REFERENCE_GONE_MESSAGE, isRestorableTable, restoreErrorMessage, restorePayload, restoreState } from './restore'

const entry = (over: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'a1',
  org_id: 'org-1',
  table_name: 'rooms',
  row_id: 'R1',
  action: 'delete',
  changed_by: 'u1',
  changed_at: '2026-10-28T10:00:00Z',
  old_data: { id: 'R1', name: 'A3' },
  new_data: null,
  ...over,
})

describe('restorePayload', () => {
  it('keeps the old id and values, drops what the server fills in', () => {
    const { payload, fileDropped } = restorePayload('rooms', { id: 'R1', org_id: 'org-1', property_id: 'P1', name: 'A3', created_at: 'x', updated_at: 'y', created_by: 'u1', price_daily: 100 })
    expect(payload).toEqual({ id: 'R1', property_id: 'P1', name: 'A3', price_daily: 100 })
    expect(fileDropped).toBe(false)
  })

  it('clears a file path that went with the row and says so', () => {
    const tenant = restorePayload('tenants', { id: 'T1', full_name: 'Budi', ktp_image_path: 'org/t1.jpg' })
    expect(tenant).toEqual({ payload: { id: 'T1', full_name: 'Budi', ktp_image_path: null }, fileDropped: true })
    expect(restorePayload('expenses', { id: 'E1', receipt_path: 'r.jpg' }).payload).toMatchObject({ receipt_path: null })
    expect(restorePayload('properties', { id: 'P1', logo_path: 'l.png' }).fileDropped).toBe(true)
    expect(restorePayload('tenants', { id: 'T2', ktp_image_path: null }).fileDropped).toBe(false)
    // a receipt still used by the other rows of a split expense stays
    expect(restorePayload('expenses', { id: 'E2', receipt_path: 'r.jpg' }, { keepFile: true })).toEqual({ payload: { id: 'E2', receipt_path: 'r.jpg' }, fileDropped: false })
  })
})

describe('restoreState', () => {
  const del = entry({})
  it('a delete of a supported table with its old row can be restored', () => {
    expect(restoreState(del, [del])).toBe('restorable')
  })
  it('a later insert of the same row means it was restored already', () => {
    const back = entry({ id: 'a2', action: 'insert', changed_at: '2026-10-28T10:05:00Z', old_data: null, new_data: { id: 'R1' } })
    expect(restoreState(del, [back, del])).toBe('restored')
    // an insert before the delete (the row's creation) does not count
    const created = entry({ id: 'a0', action: 'insert', changed_at: '2026-10-01T10:00:00Z', old_data: null, new_data: { id: 'R1' } })
    expect(restoreState(del, [created, del])).toBe('restorable')
  })
  it('updates, inserts, rows without old_data and unsupported tables offer nothing', () => {
    expect(restoreState(entry({ action: 'update' }), [])).toBe('unsupported')
    expect(restoreState(entry({ old_data: null }), [])).toBe('unsupported')
    expect(restoreState(entry({ table_name: 'organization_members' }), [])).toBe('unsupported')
    expect(restoreState(entry({ table_name: 'leases' }), [])).toBe('unsupported')
    expect(restoreState(entry({ table_name: 'invoices' }), [])).toBe('unsupported')
    expect(isRestorableTable('payments')).toBe(true)
    expect(isRestorableTable('invitations')).toBe(false)
  })
})

describe('restoreErrorMessage', () => {
  it('names a row that is already back and a reference that is gone', () => {
    expect(restoreErrorMessage(new Error('duplicate key value violates unique constraint "rooms_pkey"'))).toBe(ALREADY_RESTORED_MESSAGE)
    expect(restoreErrorMessage(new Error('insert or update on table "payments" violates foreign key constraint "payments_invoice_id_fkey"'))).toBe(REFERENCE_GONE_MESSAGE)
    expect(restoreErrorMessage(new Error('Anda tidak memiliki izin untuk tindakan ini.'))).toBe('Anda tidak memiliki izin untuk tindakan ini.')
  })
})
