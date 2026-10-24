/**
 * Central data model for Woombad.
 *
 * Every business table carries `org_id` (denormalised) so Supabase Row Level Security can be a
 * single `is_org_member(org_id)` check, and so the local/demo adapter can filter trivially.
 *
 * Money is stored as integer Rupiah (no decimals). Dates are ISO strings:
 *   - `*_date`, `period_start`, `period_end`, `due_date`, `paid_at`  -> 'YYYY-MM-DD' (date only)
 *   - `created_at`, `updated_at`                                        -> full ISO timestamp
 *
 * NOTE: tsconfig has `erasableSyntaxOnly`, so no TypeScript enums. Use the `as const` arrays below.
 */

// ---------- Enumerations ----------

export const MEMBER_ROLES = ['owner', 'admin', 'staff'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export const PERIOD_TYPES = ['daily', 'weekly', 'monthly'] as const
export type PeriodType = (typeof PERIOD_TYPES)[number]

export const ROOM_STATUSES = ['active', 'maintenance'] as const
export type RoomStatus = (typeof ROOM_STATUSES)[number]

export const LEASE_STATUSES = ['active', 'ended', 'cancelled'] as const
export type LeaseStatus = (typeof LEASE_STATUSES)[number]

export const ADDON_BILLINGS = ['per_period', 'one_time'] as const
export type AddonBilling = (typeof ADDON_BILLINGS)[number]

/** unpaid = Belum bayar, partial = DP / Sebagian, paid = Lunas, void = Dibatalkan */
export const INVOICE_STATUSES = ['unpaid', 'partial', 'paid', 'void'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/** deposit = paid by using the tenant's held deposit (potong jaminan): counts as revenue, is not cash in */
export const PAYMENT_METHODS = ['cash', 'transfer', 'qris', 'deposit', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/**
 * rent    -> payment against an invoice (counts as revenue)
 * deposit -> uang jaminan received for a lease (NOT revenue; liability)
 * other   -> misc income not tied to an invoice (counts as revenue)
 */
export const PAYMENT_KINDS = ['rent', 'deposit', 'other'] as const
export type PaymentKind = (typeof PAYMENT_KINDS)[number]

export const EXPENSE_CATEGORIES = [
  'wages', // Gaji / upah
  'maintenance', // Perbaikan & perawatan
  'utilities', // Listrik, air, internet
  'supplies', // Perlengkapan & kebersihan
  'tax', // Pajak & retribusi
  'marketing', // Iklan / promosi
  'deposit_refund', // Pengembalian uang jaminan (cash out, not an operating expense; needs lease_id)
  'rent_refund', // Pengembalian sewa (reduces revenue, not an operating expense; needs lease_id)
  'other',
] as const

/** Expense categories that are money returned to a tenant rather than operating cost. */
export const REFUND_CATEGORIES: readonly ExpenseCategory[] = ['deposit_refund', 'rent_refund']
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

/** Daftar tunggu (SPEC 7.7): waiting = no room yet, booked = a lease was made for it (lease_id), cancelled = no longer wanted */
export const WAITLIST_STATUSES = ['waiting', 'booked', 'cancelled'] as const
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number]

export const GENDERS = ['L', 'P'] as const
export type Gender = (typeof GENDERS)[number]

/** Identity document used at check-in. KTP keeps its number in `nik`; passports use `id_number`. */
export const ID_TYPES = ['ktp', 'passport', 'other'] as const
export type IdType = (typeof ID_TYPES)[number]

// ---------- Row types ----------

interface BaseRow {
  id: string
  org_id: string
  created_at: string
}

interface TimestampedRow extends BaseRow {
  updated_at: string
}

export interface Organization {
  id: string
  name: string
  created_by: string
  created_at: string
}

export interface OrganizationMember extends BaseRow {
  user_id: string
  /** denormalised for display; may be null if unknown */
  email: string | null
  role: MemberRole
}

/**
 * An invitation is a one-time code (shown once to the admin who creates it, stored only as a hash) that
 * the invitee enters after creating an account. No email delivery is involved.
 */
export interface Invitation extends BaseRow {
  /** who it is for, free text shown in the list (e.g. "Istri", "Pak Udin"); optional */
  label: string | null
  /** legacy column from email invitations; always null for code invitations */
  email: string | null
  role: MemberRole
  invited_by: string | null
  expires_at: string
  accepted_at: string | null
  accepted_by: string | null
}

export const AUDIT_ACTIONS = ['insert', 'update', 'delete'] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** Append-only change history written by database triggers (online mode only). Owner/admin can read it. */
export interface AuditLogEntry {
  id: string
  org_id: string
  table_name: string
  row_id: string | null
  action: AuditAction
  changed_by: string | null
  changed_at: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}

export interface Property extends TimestampedRow {
  name: string
  address: string | null
  notes: string | null
  /** bank account / QRIS instructions inserted into WhatsApp reminders */
  payment_info: string | null
  /** storage path in bucket "logos" (Supabase mode) or null; shown on invoices */
  logo_path: string | null
}

export interface Room extends TimestampedRow {
  property_id: string
  /** e.g. "A1", "Kamar 3" */
  name: string
  floor: string | null
  price_daily: number | null
  price_weekly: number | null
  price_monthly: number | null
  /** occupancy is derived from leases; this flag only marks rooms out of service */
  status: RoomStatus
  notes: string | null
}

export interface AddonCatalogItem extends BaseRow {
  /** null = available for every property in the org */
  property_id: string | null
  name: string
  default_price: number
  billing: AddonBilling
}

export interface Tenant extends TimestampedRow {
  /** home property; null when not yet assigned */
  property_id: string | null
  full_name: string
  /** KTP number (16 digits) when id_type = 'ktp' */
  nik: string | null
  id_type: IdType
  /** passport (or other document) number when id_type != 'ktp' */
  id_number: string | null
  /** ISO 3166-1 alpha-3 from the passport MRZ (e.g. 'AUS'), or null for Indonesians */
  nationality: string | null
  phone: string | null
  gender: Gender | null
  birth_place: string | null
  birth_date: string | null
  address: string | null
  religion: string | null
  marital_status: string | null
  occupation: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  /** storage path in bucket "ktp" (Supabase mode) or null */
  ktp_image_path: string | null
  notes: string | null
}

export interface Lease extends TimestampedRow {
  property_id: string
  room_id: string
  tenant_id: string
  period_type: PeriodType
  /** agreed rent for one period (day / week / month) */
  price_per_period: number
  /** agreed deposit (uang jaminan); actual money received is a payment with kind='deposit' */
  deposit_amount: number
  start_date: string
  /** expected end / check-out date. Extended automatically when a new invoice is issued. */
  end_date: string
  status: LeaseStatus
  /** actual move-out date when status = ended */
  checkout_date: string | null
  /**
   * Rencana keluar (SPEC 7.8): the CHECK-OUT day the tenant said he will leave (the room is free that day, SPEC 7.3);
   * null = no plan (a monthly tenant rolls on). Not a lease term: every member may set or clear it, and a start-date
   * correction leaves it alone (database: null or after start_date). Optional because rows stored before the column
   * existed (backups, Mode Demo data, fixtures) do not carry it: missing reads as null.
   */
  planned_checkout_date?: string | null
  notes: string | null
}

export interface LeaseAddon extends BaseRow {
  lease_id: string
  name: string
  amount: number
  billing: AddonBilling
}

export interface Invoice extends TimestampedRow {
  property_id: string
  lease_id: string
  invoice_number: string
  /**
   * Period type this invoice was billed with. null = the lease's period_type at the time (older rows).
   * A lease can switch type on extension (daily guest becomes monthly), so each invoice remembers its own.
   */
  period_type: PeriodType | null
  period_start: string
  period_end: string
  /** number of periods billed, e.g. 3 (days) or 1 (month) */
  quantity: number
  /** quantity * price_per_period */
  base_amount: number
  /** sum of lease addons for this invoice */
  addons_amount: number
  /** manual extras: late fee, electricity token, damage, ... */
  extra_amount: number
  discount_amount: number
  /** base + addons + extra - discount */
  total_amount: number
  due_date: string
  status: InvoiceStatus
  notes: string | null
}

export interface Payment extends BaseRow {
  property_id: string
  /** null for deposit / other income */
  invoice_id: string | null
  /** always set; lets us show per-tenant history */
  lease_id: string | null
  amount: number
  paid_at: string
  method: PaymentMethod
  kind: PaymentKind
  notes: string | null
  /** auth user who recorded it (DB default auth.uid()); null in demo mode */
  created_by: string | null
}

export interface Expense extends TimestampedRow {
  /** null = shared across properties */
  property_id: string | null
  /** required for deposit_refund / rent_refund: the lease the money goes back to */
  lease_id: string | null
  category: ExpenseCategory
  amount: number
  expense_date: string
  description: string
  vendor: string | null
  /** storage path in bucket "receipts" or null */
  receipt_path: string | null
  /** auth user who recorded it (DB default auth.uid()); null in demo mode */
  created_by: string | null
}

/**
 * Someone waiting for a room (daftar tunggu, SPEC 7.7): what they want (from when, how long, budget, preference) and,
 * once a room was booked for them, the lease. Front-desk work: every member may add and change entries; only owners
 * and admins may delete one (cancel instead).
 */
export interface WaitlistEntry extends TimestampedRow {
  /** wanted kos; null = any kos */
  property_id: string | null
  name: string
  phone: string | null
  /** first night wanted; null = secepatnya (as soon as possible) */
  wanted_from: string | null
  period_type: PeriodType
  /** nights / weeks / months (>= 1) */
  quantity: number
  /** highest price per night / week / month; null = any */
  max_price: number | null
  /** room preference, e.g. 'lantai bawah, kamar mandi dalam' */
  room_note: string | null
  notes: string | null
  status: WaitlistStatus
  /** the lease booked for this entry (status booked); cleared when that lease is deleted */
  lease_id: string | null
  /** auth user who added it (DB default auth.uid()); null in demo mode */
  created_by: string | null
}

// ---------- Table map ----------

export interface Tables {
  organizations: Organization
  organization_members: OrganizationMember
  invitations: Invitation
  properties: Property
  rooms: Room
  addon_catalog: AddonCatalogItem
  tenants: Tenant
  leases: Lease
  lease_addons: LeaseAddon
  invoices: Invoice
  payments: Payment
  expenses: Expense
  waitlist: WaitlistEntry
  audit_log: AuditLogEntry
}

export type TableName = keyof Tables
export type Row<T extends TableName> = Tables[T]

/** Tables scoped to an organisation (everything except `organizations`). */
export type OrgTableName = Exclude<TableName, 'organizations'>

type GeneratedKeys = 'id' | 'created_at' | 'updated_at' | 'created_by'

/** Insert payload: generated columns optional. */
export type Insert<T extends TableName> = Omit<Row<T>, Extract<keyof Row<T>, GeneratedKeys>> &
  Partial<Pick<Row<T>, Extract<keyof Row<T>, GeneratedKeys>>>

/** Insert payload when org_id is filled in by the OrgRepo wrapper. */
export type OrgInsert<T extends OrgTableName> = Omit<Insert<T>, 'org_id'> & { org_id?: string }

/** Partial update; id/org_id/created_at are never updatable. */
export type Update<T extends TableName> = Partial<Omit<Row<T>, 'id' | 'org_id' | 'created_at'>>

export const TABLE_NAMES: TableName[] = [
  'organizations',
  'organization_members',
  'invitations',
  'properties',
  'rooms',
  'addon_catalog',
  'tenants',
  'leases',
  'lease_addons',
  'invoices',
  'payments',
  'expenses',
  'waitlist',
  'audit_log',
]

// ---------- Indonesian labels (shared vocabulary) ----------

export const PERIOD_TYPE_LABEL: Record<PeriodType, string> = {
  daily: 'Harian',
  weekly: 'Mingguan',
  monthly: 'Bulanan',
}

/** Unit word for quantities: '3 malam', '2 minggu', '1 bulan'. */
export const PERIOD_UNIT_LABEL: Record<PeriodType, string> = {
  daily: 'malam',
  weekly: 'minggu',
  monthly: 'bulan',
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: 'Belum Bayar',
  partial: 'DP / Sebagian',
  paid: 'Lunas',
  void: 'Dibatalkan',
}

export const LEASE_STATUS_LABEL: Record<LeaseStatus, string> = {
  active: 'Aktif',
  ended: 'Selesai',
  cancelled: 'Dibatalkan',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS',
  deposit: 'Potong Jaminan',
  other: 'Lainnya',
}

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  rent: 'Sewa',
  deposit: 'Deposit (Uang Jaminan)',
  other: 'Pemasukan Lain',
}

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  wages: 'Gaji & Upah',
  maintenance: 'Perbaikan & Perawatan',
  utilities: 'Listrik, Air & Internet',
  supplies: 'Perlengkapan & Kebersihan',
  tax: 'Pajak & Retribusi',
  marketing: 'Promosi',
  deposit_refund: 'Pengembalian Uang Jaminan',
  rent_refund: 'Pengembalian Sewa',
  other: 'Lainnya',
}

export const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  active: 'Aktif',
  maintenance: 'Perbaikan',
}

export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Pemilik',
  admin: 'Admin',
  staff: 'Staf',
}

export const ADDON_BILLING_LABEL: Record<AddonBilling, string> = {
  per_period: 'Per periode',
  one_time: 'Sekali bayar',
}

export const WAITLIST_STATUS_LABEL: Record<WaitlistStatus, string> = {
  waiting: 'Menunggu',
  booked: 'Sudah dipesan',
  cancelled: 'Batal',
}

export const GENDER_LABEL: Record<Gender, string> = {
  L: 'Laki-laki',
  P: 'Perempuan',
}

export const ID_TYPE_LABEL: Record<IdType, string> = {
  ktp: 'KTP',
  passport: 'Paspor',
  other: 'Lainnya',
}
