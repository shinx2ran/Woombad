/**
 * "Impor dari Mode Demo" planning (SPEC 6.5). Pure: given a parsed backup, the user's selection and the ids
 * that already exist online, decide which rows to insert (in dependency order) and why the others are skipped.
 * The UI fetches the existing rows, calls planDemoImport and hands the plan to runImportPlan.
 *
 * Rows keep their UUIDs; org_id is set by the OrgRepo; created_by/created_at/updated_at are dropped so the
 * database fills them; photo paths are cleared (photos are not part of a backup). Every column is written
 * explicitly (missing ones get the database default) because a bulk insert turns missing keys into NULL.
 */
import { invoiceNumber } from '../../../domain/billing'
import { DEMO_ORG_ID } from '../../../lib/repo/demoSeed'
import {
  ADDON_BILLINGS,
  EXPENSE_CATEGORIES,
  GENDERS,
  ID_TYPES,
  INVOICE_STATUSES,
  LEASE_STATUSES,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PERIOD_TYPES,
  REFUND_CATEGORIES,
  ROOM_STATUSES,
  type Row,
} from '../../../types/db'
import type { BackupRow, ParsedBackup } from './backupFormat'

/** Insert order: parents before children. */
export const IMPORT_ORDER = ['properties', 'rooms', 'addon_catalog', 'tenants', 'leases', 'lease_addons', 'invoices', 'payments', 'expenses'] as const
export type ImportTable = (typeof IMPORT_ORDER)[number]

export const SKIP_REASONS = ['exists', 'invalid_id', 'other_org', 'invalid_data', 'broken_ref'] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  exists: 'sudah ada online',
  invalid_id: 'format id lama',
  other_org: 'dari organisasi lain',
  invalid_data: 'data tidak lengkap',
  broken_ref: 'data terkait tidak ikut',
}

export interface ImportSelection {
  /** kos (property ids from the backup) to import */
  propertyIds: readonly string[]
  /** also import the owner's expenses without a kos ("Bersama") */
  includeShared: boolean
  /** also import Mode Demo sample rows that belong to no kos (shared expenses, org-wide add-ons, tenants) */
  includeSample?: boolean
}

/** What is already in the online organisation (ids per table, lowercase) — skipped, but valid as references. */
export interface ExistingOnline {
  ids: Record<ImportTable, ReadonlySet<string>>
  invoiceNumbers: ReadonlySet<string>
}

export interface PlannedRow {
  id: string
  /** insert payload without org_id */
  row: Record<string, unknown>
  /** ids of rows in this same import that must be inserted first (FK targets) */
  deps: string[]
}

export interface TablePlan {
  rows: PlannedRow[]
  skipped: Record<SkipReason, number>
}

export interface ImportPlan {
  tables: Record<ImportTable, TablePlan>
  /** invoices whose number was already taken online; the old number is kept in the invoice notes */
  renumberedInvoices: number
}

export interface KosPreview {
  id: string
  name: string
  rooms: number
  tenants: number
  leases: number
  invoices: number
  payments: number
  expenses: number
  /** the kos itself was imported before (its rows will be skipped as "sudah ada") */
  alreadyOnline: boolean
  /** a Mode Demo sample kos (not selected by default) */
  sample: boolean
}

export interface SampleOutsideKos {
  expenses: number
  addons: number
  tenants: number
}

export interface BackupPreview {
  properties: KosPreview[]
  /** the owner's expenses without a kos (or whose kos no longer exists in the backup) */
  sharedExpenses: number
  /** Mode Demo sample rows that belong to no kos; imported only with includeSample */
  sample: SampleOutsideKos
}

// ---------------------------------------------------------------- columns

type ColType = 'text' | 'int' | 'date' | 'uuid' | readonly string[]
interface Col {
  type: ColType
  required?: true
  /** database default used when the value is missing */
  def?: string | number
  min?: number
  /** always written as null (photos are not in a backup) */
  clear?: true
}

type ServerColumns = 'id' | 'org_id' | 'created_at' | 'updated_at' | 'created_by'
type DataColumns<T extends ImportTable> = Exclude<keyof Row<T>, ServerColumns> & string

const text: Col = { type: 'text' }
const reqText: Col = { type: 'text', required: true }
const uuid: Col = { type: 'uuid' }
const reqUuid: Col = { type: 'uuid', required: true }
const date: Col = { type: 'date' }
const reqDate: Col = { type: 'date', required: true }
const money = (def?: number): Col => ({ type: 'int', min: 0, def })

/** Every insertable column per table (typed against src/types/db.ts, so a new column fails to compile here). */
const COLUMNS: { [T in ImportTable]: { [K in DataColumns<T>]: Col } } = {
  properties: { name: reqText, address: text, notes: text, payment_info: text },
  rooms: {
    property_id: reqUuid,
    name: reqText,
    floor: text,
    price_daily: money(),
    price_weekly: money(),
    price_monthly: money(),
    status: { type: ROOM_STATUSES, def: 'active' },
    notes: text,
  },
  addon_catalog: {
    property_id: uuid,
    name: reqText,
    default_price: { type: 'int', def: 0 },
    billing: { type: ADDON_BILLINGS, def: 'per_period' },
  },
  tenants: {
    property_id: uuid,
    full_name: reqText,
    nik: text,
    id_type: { type: ID_TYPES, def: 'ktp' },
    id_number: text,
    nationality: text,
    phone: text,
    gender: { type: GENDERS },
    birth_place: text,
    birth_date: date,
    address: text,
    religion: text,
    marital_status: text,
    occupation: text,
    emergency_contact_name: text,
    emergency_contact_phone: text,
    ktp_image_path: { type: 'text', clear: true },
    notes: text,
  },
  leases: {
    property_id: reqUuid,
    room_id: reqUuid,
    tenant_id: reqUuid,
    period_type: { type: PERIOD_TYPES, required: true },
    price_per_period: { type: 'int', required: true, min: 0 },
    deposit_amount: money(0),
    start_date: reqDate,
    end_date: reqDate,
    status: { type: LEASE_STATUSES, def: 'active' },
    checkout_date: date,
    notes: text,
  },
  lease_addons: {
    lease_id: reqUuid,
    name: reqText,
    amount: { type: 'int', required: true },
    billing: { type: ADDON_BILLINGS, def: 'per_period' },
  },
  invoices: {
    property_id: reqUuid,
    lease_id: reqUuid,
    invoice_number: reqText,
    period_type: { type: PERIOD_TYPES },
    period_start: reqDate,
    period_end: reqDate,
    quantity: { type: 'int', def: 1, min: 1 },
    base_amount: money(0),
    addons_amount: { type: 'int', def: 0 },
    extra_amount: money(0),
    discount_amount: money(0),
    total_amount: money(0),
    due_date: reqDate,
    status: { type: INVOICE_STATUSES, def: 'unpaid' },
    notes: text,
  },
  payments: {
    property_id: reqUuid,
    invoice_id: uuid,
    lease_id: uuid,
    amount: { type: 'int', required: true, min: 1 },
    paid_at: reqDate,
    method: { type: PAYMENT_METHODS, def: 'cash' },
    kind: { type: PAYMENT_KINDS, def: 'rent' },
    notes: text,
  },
  expenses: {
    property_id: uuid,
    lease_id: uuid,
    category: { type: EXPENSE_CATEGORIES, required: true },
    amount: { type: 'int', required: true, min: 0 },
    expense_date: reqDate,
    description: reqText,
    vendor: text,
    receipt_path: { type: 'text', clear: true },
  },
}

interface ForeignKey {
  column: string
  target: ImportTable
  /** nullable FK whose parent is gone: write null instead of skipping the row (ON DELETE SET NULL) */
  nullIfMissing?: true
}

const FOREIGN_KEYS: Record<ImportTable, ForeignKey[]> = {
  properties: [],
  rooms: [{ column: 'property_id', target: 'properties' }],
  addon_catalog: [{ column: 'property_id', target: 'properties' }],
  tenants: [{ column: 'property_id', target: 'properties', nullIfMissing: true }],
  leases: [
    { column: 'property_id', target: 'properties' },
    { column: 'room_id', target: 'rooms' },
    { column: 'tenant_id', target: 'tenants' },
  ],
  lease_addons: [{ column: 'lease_id', target: 'leases' }],
  invoices: [
    { column: 'property_id', target: 'properties' },
    { column: 'lease_id', target: 'leases' },
  ],
  payments: [
    { column: 'property_id', target: 'properties' },
    { column: 'invoice_id', target: 'invoices' },
    { column: 'lease_id', target: 'leases' },
  ],
  expenses: [
    { column: 'property_id', target: 'properties' },
    { column: 'lease_id', target: 'leases' },
  ],
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}/

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** Lowercase string key for id comparisons; null for anything that is not a non-empty string. */
function key(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value.toLowerCase() : null
}

function normalizeValue(col: Col, value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (col.clear) return { ok: true, value: null }
  const missing = value === undefined || value === null || (value === '' && col.type !== 'text')
  if (missing) return col.required ? { ok: false } : { ok: true, value: col.def ?? null }
  if (col.type === 'text') {
    if (typeof value === 'string') return { ok: true, value }
    return typeof value === 'number' ? { ok: true, value: String(value) } : { ok: false }
  }
  if (col.type === 'int') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return { ok: false }
    return col.min !== undefined && value < col.min ? { ok: false } : { ok: true, value }
  }
  if (col.type === 'date') {
    return typeof value === 'string' && DATE_RE.test(value) ? { ok: true, value: value.slice(0, 10) } : { ok: false }
  }
  if (col.type === 'uuid') return typeof value === 'string' ? { ok: true, value: value.toLowerCase() } : { ok: false }
  return typeof value === 'string' && col.type.includes(value) ? { ok: true, value } : { ok: false }
}

/** Whitelisted, defaulted copy of a backup row (without id), or null when it cannot be inserted as is. */
export function normalizeRow(table: ImportTable, raw: BackupRow): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const [column, col] of Object.entries(COLUMNS[table] as Record<string, Col>)) {
    const result = normalizeValue(col, raw[column])
    if (!result.ok) return null
    out[column] = result.value
  }
  return passesChecks(table, out) ? out : null
}

/** The database CHECK constraints that span several columns. */
function passesChecks(table: ImportTable, r: Record<string, unknown>): boolean {
  const n = (c: string) => r[c] as number
  const s = (c: string) => r[c] as string
  switch (table) {
    case 'leases':
      return s('end_date') >= s('start_date')
    case 'invoices':
      return s('period_end') >= s('period_start') && n('total_amount') === n('base_amount') + n('addons_amount') + n('extra_amount') - n('discount_amount')
    case 'payments':
      return (r.kind === 'rent') === (r.invoice_id !== null)
    case 'expenses':
      return !(REFUND_CATEGORIES as readonly unknown[]).includes(r.category) || r.lease_id !== null
    default:
      return true
  }
}

// ---------------------------------------------------------------- source organisation & preview

/** The organisation the backup belongs to: its organizations row, else the most common org_id of its kos. */
export function sourceOrgId(backup: ParsedBackup): string | null {
  const orgId = backup.tables.organizations[0]?.id
  if (orgId) return orgId
  const counts = new Map<string, number>()
  for (const p of backup.tables.properties) {
    if (typeof p.org_id === 'string') counts.set(p.org_id, (counts.get(p.org_id) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [id, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = id
  return best
}

function fromSourceOrg(row: BackupRow, orgId: string | null): boolean {
  return orgId === null || row.org_id === undefined || row.org_id === null || row.org_id === orgId
}

/**
 * Detects the Mode Demo sample data (buildDemoDb): every seeded row has the demo organisation's id and exactly
 * the organizations row's created_at, while rows the owner added later carry their own, later timestamp.
 * Never matches a backup of an online organisation.
 */
export function sampleRowCheck(backup: ParsedBackup): (row: BackupRow) => boolean {
  const org = backup.tables.organizations[0]
  const stamp = org?.id === DEMO_ORG_ID && typeof org.created_at === 'string' ? org.created_at : null
  if (stamp === null) return () => false
  return (row) => row.org_id === DEMO_ORG_ID && row.created_at === stamp
}

/** Kos of the backup's own organisation, sorted by name. */
export function backupProperties(backup: ParsedBackup): BackupRow[] {
  const orgId = sourceOrgId(backup)
  return backup.tables.properties
    .filter((p) => fromSourceOrg(p, orgId))
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'id'))
}

export function emptyExisting(): ExistingOnline {
  const ids = {} as Record<ImportTable, ReadonlySet<string>>
  for (const t of IMPORT_ORDER) ids[t] = new Set()
  return { ids, invoiceNumbers: new Set() }
}

/** Build ExistingOnline from the rows currently online (OrgRepo.list per import table). */
export function existingFromRows(rows: Partial<Record<ImportTable, readonly { id: string }[]>>): ExistingOnline {
  const ids = {} as Record<ImportTable, ReadonlySet<string>>
  for (const t of IMPORT_ORDER) ids[t] = new Set((rows[t] ?? []).map((r) => r.id.toLowerCase()))
  const invoiceNumbers = new Set((rows.invoices ?? []).map((r) => String((r as { invoice_number?: unknown }).invoice_number)))
  return { ids, invoiceNumbers }
}

/** Tenant ids referenced by any lease in the backup. */
function leaseTenantIds(backup: ParsedBackup): Set<string> {
  const ids = new Set<string>()
  for (const l of backup.tables.leases) {
    const id = key(l.tenant_id)
    if (id) ids.add(id)
  }
  return ids
}

/** Per-kos counts for the preview (rows of the backup, before any skipping). */
export function previewBackup(backup: ParsedBackup, existing: ExistingOnline = emptyExisting()): BackupPreview {
  const t = backup.tables
  const isSample = sampleRowCheck(backup)
  const allPropertyIds = new Set(t.properties.map((p) => key(p.id)))
  const withoutKos = (r: BackupRow) => {
    const pid = key(r.property_id)
    return pid === null || !allPropertyIds.has(pid)
  }
  const withLease = leaseTenantIds(backup)
  const count = (rows: BackupRow[], pid: string) => rows.filter((r) => key(r.property_id) === pid).length

  const properties = backupProperties(backup).map((p): KosPreview => {
    const pid = key(p.id) ?? ''
    const tenants = new Set<string>()
    for (const l of t.leases) {
      const tid = key(l.tenant_id)
      if (tid && key(l.property_id) === pid) tenants.add(tid)
    }
    for (const tn of t.tenants) {
      const tid = key(tn.id)
      if (tid && key(tn.property_id) === pid && !withLease.has(tid)) tenants.add(tid)
    }
    return {
      id: p.id,
      name: typeof p.name === 'string' && p.name.trim() ? p.name : 'Tanpa nama',
      rooms: count(t.rooms, pid),
      tenants: tenants.size,
      leases: count(t.leases, pid),
      invoices: count(t.invoices, pid),
      payments: count(t.payments, pid),
      expenses: count(t.expenses, pid),
      alreadyOnline: existing.ids.properties.has(pid),
      sample: isSample(p),
    }
  })
  const sharedExpenses = t.expenses.filter(withoutKos)
  return {
    properties,
    sharedExpenses: sharedExpenses.filter((e) => !isSample(e)).length,
    sample: {
      expenses: sharedExpenses.filter(isSample).length,
      addons: t.addon_catalog.filter((a) => key(a.property_id) === null && isSample(a)).length,
      tenants: t.tenants.filter((tn) => isSample(tn) && withoutKos(tn) && !withLease.has(key(tn.id) ?? '')).length,
    },
  }
}

export function sampleOutsideKosCount(preview: BackupPreview): number {
  return preview.sample.expenses + preview.sample.addons + preview.sample.tenants
}

/** Default selection: the owner's kos and shared expenses; Mode Demo sample data stays unticked. */
export function defaultSelection(preview: BackupPreview): ImportSelection {
  return {
    propertyIds: preview.properties.filter((p) => !p.sample).map((p) => p.id),
    includeShared: preview.sharedExpenses > 0,
    includeSample: false,
  }
}

// ---------------------------------------------------------------- plan

const INVOICE_NUMBER_RE = /^INV-(\d{4})(\d{2})-(\d+)$/

/** A number not in `taken`: next sequence of the same month for INV-YYYYMM-NNNN, else a "-2", "-3" suffix. */
function freeInvoiceNumber(original: string, taken: ReadonlySet<string>): string {
  const m = INVOICE_NUMBER_RE.exec(original)
  if (m) {
    let max = 0
    for (const n of taken) {
      const k = INVOICE_NUMBER_RE.exec(n)
      if (k && k[1] === m[1] && k[2] === m[2]) max = Math.max(max, Number(k[3]))
    }
    return invoiceNumber(`${m[1]}-${m[2]}-01`, max + 1)
  }
  let i = 2
  while (taken.has(`${original}-${i}`)) i++
  return `${original}-${i}`
}

export function emptySkipped(): Record<SkipReason, number> {
  return { exists: 0, invalid_id: 0, other_org: 0, invalid_data: 0, broken_ref: 0 }
}

/**
 * Decide what to import for the selected kos.
 *
 * Which rows: kos, kamar, sewa, tagihan, pembayaran of the selected kos; add-on catalog items of the selected kos
 * plus the org-wide ones (when any kos is selected); add-ons of imported leases; tenants referenced by those
 * leases plus tenants without any lease whose home kos is selected, unset or gone (when any kos is selected);
 * expenses of the selected kos, plus — with includeShared — expenses without a kos (or whose kos no longer
 * exists in the backup; they become shared, as ON DELETE SET NULL would have made them).
 * Mode Demo sample rows of a selected kos follow the kos; sample rows outside any kos (shared expenses,
 * org-wide add-ons, tenants) are imported only with includeSample.
 *
 * Skipped (counted per reason): non-UUID ids, rows of another organisation, ids already online, rows that
 * break a column rule, and rows whose parent is neither imported nor online. A tenant's missing home kos is
 * cleared instead. Invoice numbers already used online (or twice in the file) get the next free number.
 */
export function planDemoImport(backup: ParsedBackup, selection: ImportSelection, existing: ExistingOnline = emptyExisting()): ImportPlan {
  const t = backup.tables
  const orgId = sourceOrgId(backup)
  const selected = new Set(selection.propertyIds.map((id) => id.toLowerCase()))
  const anySelected = selected.size > 0
  const isSample = sampleRowCheck(backup)
  /** rows outside any kos: the owner's follow `own`, sample rows need includeSample */
  const outsideKos = (r: BackupRow, own: boolean) => (isSample(r) ? selection.includeSample === true : own)
  const backupPropertyIds = new Set(t.properties.map((p) => key(p.id)).filter((id): id is string => id !== null))

  const tables = {} as Record<ImportTable, TablePlan>
  const valid = {} as Record<ImportTable, Set<string>>
  const seen = {} as Record<ImportTable, Set<string>>
  for (const table of IMPORT_ORDER) {
    tables[table] = { rows: [], skipped: emptySkipped() }
    valid[table] = new Set(existing.ids[table])
    seen[table] = new Set()
  }
  const planned = new Set<string>()

  const take = (
    table: ImportTable,
    raw: BackupRow,
    hooks: { adjust?: (row: Record<string, unknown>) => void; accept?: (row: Record<string, unknown>) => void } = {},
  ): void => {
    const plan = tables[table]
    const skip = (reason: SkipReason) => void plan.skipped[reason]++
    const id = raw.id.toLowerCase()
    if (!isUuid(id)) return skip('invalid_id')
    if (!fromSourceOrg(raw, orgId)) return skip('other_org')
    if (existing.ids[table].has(id)) return skip('exists')
    if (seen[table].has(id)) return skip('invalid_data')
    seen[table].add(id)
    const row = normalizeRow(table, raw)
    if (!row) return skip('invalid_data')
    hooks.adjust?.(row)
    const deps: string[] = []
    for (const fk of FOREIGN_KEYS[table]) {
      const ref = row[fk.column] as string | null
      if (ref === null) continue
      if (!valid[fk.target].has(ref)) {
        if (fk.nullIfMissing) {
          row[fk.column] = null
          continue
        }
        return skip('broken_ref')
      }
      if (planned.has(ref)) deps.push(ref)
    }
    hooks.accept?.(row)
    valid[table].add(id)
    planned.add(id)
    plan.rows.push({ id, row: { id, ...row }, deps })
  }

  const inSelected = (r: BackupRow) => selected.has(key(r.property_id) ?? '')

  for (const p of t.properties) if (selected.has(key(p.id) ?? '')) take('properties', p)
  for (const r of t.rooms) if (inSelected(r)) take('rooms', r)
  for (const a of t.addon_catalog) {
    const pid = key(a.property_id)
    if (pid === null ? outsideKos(a, anySelected) : selected.has(pid)) take('addon_catalog', a)
  }

  // Tenants follow the leases that will be imported (decided on kos + room; the tenant itself comes next).
  const leaseCandidates = t.leases.filter(inSelected)
  const neededTenants = new Set<string>()
  for (const l of leaseCandidates) {
    const tid = key(l.tenant_id)
    if (tid && valid.properties.has(key(l.property_id) ?? '') && valid.rooms.has(key(l.room_id) ?? '')) neededTenants.add(tid)
  }
  const withLease = leaseTenantIds(backup)
  for (const tn of t.tenants) {
    const id = key(tn.id) ?? ''
    const pid = key(tn.property_id)
    const homeless = pid === null || !backupPropertyIds.has(pid)
    const leaseless = !withLease.has(id) && (homeless ? outsideKos(tn, anySelected) : selected.has(pid))
    if (neededTenants.has(id) || leaseless) take('tenants', tn)
  }

  for (const l of leaseCandidates) take('leases', l)
  const candidateLeaseIds = new Set(leaseCandidates.map((l) => key(l.id)))
  for (const la of t.lease_addons) if (candidateLeaseIds.has(key(la.lease_id))) take('lease_addons', la)

  const onlineNumbers = existing.invoiceNumbers
  const allNumbers = new Set<string>([...onlineNumbers, ...t.invoices.map((i) => String(i.invoice_number))])
  const usedNumbers = new Set<string>()
  let renumberedInvoices = 0
  for (const inv of t.invoices) {
    if (!inSelected(inv)) continue
    take('invoices', inv, {
      accept: (row) => {
        const number = row.invoice_number as string
        if (onlineNumbers.has(number) || usedNumbers.has(number)) {
          const next = freeInvoiceNumber(number, allNumbers)
          allNumbers.add(next)
          row.invoice_number = next
          row.notes = [row.notes, `Nomor tagihan di Mode Demo: ${number}`].filter(Boolean).join('\n')
          renumberedInvoices++
        }
        usedNumbers.add(row.invoice_number as string)
      },
    })
  }

  for (const p of t.payments) if (inSelected(p)) take('payments', p)

  for (const e of t.expenses) {
    const pid = key(e.property_id)
    const ownKos = pid !== null && backupPropertyIds.has(pid)
    if (ownKos ? !selected.has(pid) : !outsideKos(e, selection.includeShared)) continue
    take('expenses', e, { adjust: ownKos ? undefined : (row) => void (row.property_id = null) })
  }

  return { tables, renumberedInvoices }
}

export function plannedCount(plan: ImportPlan): number {
  return IMPORT_ORDER.reduce((sum, t) => sum + plan.tables[t].rows.length, 0)
}

export function skippedCount(skipped: Record<SkipReason, number>): number {
  return SKIP_REASONS.reduce((sum, r) => sum + skipped[r], 0)
}

/** Skip counts per reason summed over all tables. */
export function skippedByReason(plan: ImportPlan): Record<SkipReason, number> {
  const total = emptySkipped()
  for (const t of IMPORT_ORDER) for (const r of SKIP_REASONS) total[r] += plan.tables[t].skipped[r]
  return total
}
