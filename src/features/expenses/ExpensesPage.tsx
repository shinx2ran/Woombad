import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { CalendarRange, ChevronLeft, ChevronRight, Copy, Paperclip, Pencil, Plus, Trash2, Undo2, Wallet } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  useToast,
  type Column,
} from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate, useTable } from '../../hooks/useTable'
import { formatDate, formatRupiah, todayISO } from '../../lib/format'
import { comparableRanges, inRange, rangeForPreset, shiftRange, type DateRange } from '../../domain/period'
import { expensesByCategory, operatingExpensesInRange } from '../../domain/finance'
import { EXPENSE_CATEGORY_LABEL, type Expense, type ExpenseCategory } from '../../types/db'
import { ExpenseFormModal, type ExpenseFormMode } from './ExpenseFormModal'
import { ReceiptModal } from './ReceiptModal'
import { removeReceiptIfUnused } from './receiptFiles'
import {
  CATEGORY_COLOR,
  CATEGORY_TONE,
  DELETE_DENIED_MESSAGE,
  EDIT_DENIED_HINT,
  ORDERED_CATEGORIES,
  canEditExpenses,
  dateHeading,
  expenseDeltaText,
  filterExpenses,
  groupByDate,
  isExpenseVisible,
  isRefundCategory,
  operatingExpenseRows,
  rangeLabel,
  sameDayInMonth,
  shortRupiah,
  sumAmounts,
  type ExpenseDraft,
} from './expenseUtils'

const NO_EXPENSES: Expense[] = []

interface FormState {
  key: number
  mode: ExpenseFormMode
  title: string
  initial: ExpenseDraft
  editingId?: string
}

function emptyDraft(): ExpenseDraft {
  return {
    expense_date: todayISO(),
    property_id: null,
    lease_id: null,
    category: 'utilities',
    amount: 0,
    description: '',
    vendor: null,
    receipt_path: null,
  }
}

function draftFrom(e: Expense): ExpenseDraft {
  return {
    expense_date: e.expense_date,
    property_id: e.property_id,
    lease_id: e.lease_id,
    category: e.category,
    amount: e.amount,
    description: e.description,
    vendor: e.vendor,
    receipt_path: e.receipt_path,
  }
}

/** Height of the sticky app header, so in-page sticky date headers stack below it instead of sliding under. */
function useHeaderOffset(): number {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return
    const update = () => setOffset(Math.round(header.getBoundingClientRect().height))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(header)
    return () => ro.disconnect()
  }, [])
  return offset
}

export function ExpensesPage() {
  const { role, repo, properties, selectedPropertyId, propertyFilterIds, financePropertyIds } = useOrg()
  const invalidate = useInvalidate()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  // SPEC 6.2: staff record expenses but never edit or delete them (admin-only policies), so a denied write is
  // never attempted; the server still refuses it if the UI is bypassed.
  const canEdit = canEditExpenses(role)
  const canDelete = canEdit
  const today = todayISO()

  const expensesQuery = useTable('expenses')
  const leasesQuery = useTable('leases')
  const tenantsQuery = useTable('tenants')

  // ---- period ----
  const [isMonth, setIsMonth] = useState(true)
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('monthly', today))
  const [customStart, setCustomStart] = useState(range.start)
  const [customEnd, setCustomEnd] = useState(range.end)
  const customError = customStart && customEnd && customStart > customEnd ? 'Tanggal akhir harus setelah tanggal mulai.' : null

  const applyCustom = (start: string, end: string) => {
    setCustomStart(start)
    setCustomEnd(end)
    if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end) setRange({ start, end })
  }
  const toggleCustom = () => {
    if (isMonth) {
      setCustomStart(range.start)
      setCustomEnd(range.end)
      setIsMonth(false)
    } else {
      setIsMonth(true)
      setRange(rangeForPreset('monthly', range.start))
    }
  }

  // ---- category filter ----
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const toggleCategory = (c: ExpenseCategory) =>
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))

  // ---- modals ----
  const [form, setForm] = useState<FormState | null>(null)
  const formCounter = useRef(0)
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [receiptPath, setReceiptPath] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Expense | null>(null)

  const openForm = (mode: ExpenseFormMode, title: string, initial: ExpenseDraft, editingId?: string) => {
    formCounter.current += 1
    setForm({ key: formCounter.current, mode, title, initial, editingId })
    setSheet(null)
  }
  const openCreate = () => openForm('create', 'Catat pengeluaran', emptyDraft())
  const openEdit = (e: Expense) => openForm('edit', 'Ubah pengeluaran', draftFrom(e), e.id)
  const openDuplicate = (e: Expense) =>
    openForm('duplicate', 'Duplikat ke bulan ini', { ...draftFrom(e), expense_date: sameDayInMonth(e.expense_date, today), receipt_path: null })

  // After a save whose date falls outside the visible period (e.g. "Duplikat ke bulan ini" from a past month),
  // jump to that month so the new row is on screen instead of silently living in another period.
  const onSaved = (savedDate: string) => {
    if (inRange(savedDate, range)) return
    setIsMonth(true)
    setRange(rangeForPreset('monthly', savedDate))
    toast.toast(`Menampilkan ${rangeLabel(rangeForPreset('monthly', savedDate), true)}.`, 'info')
  }

  // Dashboard links here with ?new=1 to open the form straight away.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    openCreate()
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      // Row first, file second (SPEC 6.4): a refused delete must never lose the receipt.
      await repo.remove('expenses', deleting.id)
      // A delete that RLS filters out affects 0 rows without an error: confirm the row is really gone before
      // reporting success (and before touching its receipt file).
      if (await repo.get('expenses', deleting.id)) throw new Error(DELETE_DENIED_MESSAGE)
      let fileWarning = false
      if (deleting.receipt_path) {
        try {
          await removeReceiptIfUnused(repo, deleting.receipt_path)
        } catch {
          fileWarning = true
        }
      }
      await invalidate('expenses')
      if (fileWarning) toast.error('Pengeluaran dihapus, tetapi foto struk gagal dihapus dari penyimpanan.')
      else toast.success('Pengeluaran dihapus.')
      setDeleting(null)
      setSheet(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus pengeluaran.')
    } finally {
      setDeleteBusy(false)
    }
  }

  // ---- derived data ----
  const all = expensesQuery.data ?? NO_EXPENSES
  const showShared = selectedPropertyId === 'all'

  /** rows in range for the kos scope, before the category filter (drives the chips) */
  const inScope = useMemo(
    () => all.filter((e) => inRange(e.expense_date, range) && isExpenseVisible(e, propertyFilterIds, showShared)),
    [all, range, propertyFilterIds, showShared],
  )
  const presentCategories = useMemo(() => {
    const set = new Set(inScope.map((e) => e.category))
    return ORDERED_CATEGORIES.filter((c) => set.has(c) || categories.includes(c))
  }, [inScope, categories])

  const rows = useMemo(
    () => filterExpenses(all, { range, propertyFilterIds, showShared, categories }),
    [all, range, propertyFilterIds, showShared, categories],
  )
  const groups = useMemo(() => groupByDate(rows), [rows])

  // Summary via src/domain/finance on the category-scoped set; property scope always financePropertyIds.
  // Only operating rows go in (SPEC §2a: no deposit_refund, no rent_refund) - see operatingExpenseRows.
  const summary = useMemo(() => {
    const operating = operatingExpenseRows(all)
    const scoped = categories.length ? operating.filter((e) => categories.includes(e.category)) : operating
    const total = operatingExpensesInRange(scoped, range, financePropertyIds)
    const cmp = comparableRanges(range, today, isMonth ? 'monthly' : undefined)
    const current = operatingExpensesInRange(scoped, cmp.current, financePropertyIds)
    const previous = operatingExpensesInRange(scoped, cmp.previous, financePropertyIds)
    const delta = expenseDeltaText(current, previous, isMonth ? 'bulan lalu' : 'periode sebelumnya', cmp.isPartial)
    const byCategory = expensesByCategory(scoped, range, financePropertyIds)
    const refunds = sumAmounts(rows.filter((e) => isRefundCategory(e.category)))
    const sharedExcluded = showShared ? 0 : sumAmounts(all.filter((e) => e.property_id === null && inRange(e.expense_date, range)))
    return { total, delta, byCategory, refunds, sharedExcluded, listTotal: sumAmounts(rows) }
  }, [all, rows, categories, range, financePropertyIds, today, isMonth, showShared])

  const propertyName = (id: string | null) => (id === null ? 'Bersama' : properties.find((p) => p.id === id)?.name ?? '?')
  const refundTarget = (e: Expense) => {
    if (!e.lease_id) return null
    const lease = (leasesQuery.data ?? []).find((l) => l.id === e.lease_id)
    const tenant = lease ? (tenantsQuery.data ?? []).find((t) => t.id === lease.tenant_id) : undefined
    return tenant?.full_name ?? null
  }

  const headerOffset = useHeaderOffset()

  const columns: Column<Expense>[] = [
    { key: 'date', header: 'Tanggal', render: (e) => <span className="whitespace-nowrap">{formatDate(e.expense_date)}</span> },
    {
      key: 'kos',
      header: 'Kos',
      render: (e) => (e.property_id === null ? <Badge tone="info">Bersama</Badge> : <span>{propertyName(e.property_id)}</span>),
    },
    { key: 'cat', header: 'Kategori', render: (e) => <CategoryBadge category={e.category} /> },
    {
      key: 'desc',
      header: 'Deskripsi',
      className: 'max-w-[22rem]',
      render: (e) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{e.description}</p>
          {isRefundCategory(e.category) && refundTarget(e) && (
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <Undo2 className="h-3 w-3" /> ke {refundTarget(e)}
            </p>
          )}
        </div>
      ),
    },
    { key: 'vendor', header: 'Vendor', render: (e) => <span className="text-slate-600">{e.vendor ?? '–'}</span> },
    {
      key: 'amount',
      header: 'Jumlah',
      align: 'right',
      render: (e) => <span className={clsx('font-semibold', isRefundCategory(e.category) ? 'text-slate-600' : 'text-rose-700')}>{formatRupiah(e.amount)}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Aksi</span>,
      align: 'right',
      className: 'w-0 whitespace-nowrap',
      render: (e) => (
        <div className="flex items-center justify-end gap-0.5" onClick={(ev) => ev.stopPropagation()}>
          {e.receipt_path && <IconButton label="Lihat struk" onClick={() => setReceiptPath(e.receipt_path)} icon={<Paperclip className="h-4 w-4" />} />}
          <IconButton label="Duplikat ke bulan ini" onClick={() => openDuplicate(e)} icon={<Copy className="h-4 w-4" />} />
          {canEdit && <IconButton label="Ubah" onClick={() => openEdit(e)} icon={<Pencil className="h-4 w-4" />} />}
          {canDelete && <IconButton label="Hapus" onClick={() => setDeleting(e)} icon={<Trash2 className="h-4 w-4" />} danger />}
        </div>
      ),
    },
  ]

  const scopeLabel = showShared ? 'Semua kos (termasuk biaya Bersama)' : propertyName(selectedPropertyId)

  return (
    <>
      <PageHeader
        title="Pengeluaran"
        subtitle={scopeLabel}
        actions={
          <Button onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
            Catat pengeluaran
          </Button>
        }
      />

      {/* Period navigator */}
      <Card className="mb-3">
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Bulan sebelumnya"
              disabled={!isMonth}
              onClick={() => setRange((r) => shiftRange(r, 'monthly', -1))}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-semibold text-slate-900">{rangeLabel(range, isMonth)}</p>
              {isMonth && (
                <p className="text-[11px] text-slate-500">
                  {formatDate(range.start)} – {formatDate(range.end)}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label="Bulan berikutnya"
              disabled={!isMonth}
              onClick={() => setRange((r) => shiftRange(r, 'monthly', 1))}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <Button
              variant={isMonth ? 'outline' : 'secondary'}
              size="sm"
              onClick={toggleCustom}
              icon={<CalendarRange className="h-4 w-4" />}
              aria-pressed={!isMonth}
              aria-label={isMonth ? 'Rentang kustom' : 'Bulanan'}
              className="shrink-0"
            >
              <span className="hidden sm:inline">{isMonth ? 'Rentang kustom' : 'Bulanan'}</span>
            </Button>
          </div>
          {!isMonth && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Dari tanggal" type="date" value={customStart} onChange={(e) => applyCustom(e.target.value, customEnd)} error={customError ?? undefined} />
              <Input label="Sampai tanggal" type="date" value={customEnd} onChange={(e) => applyCustom(customStart, e.target.value)} />
            </div>
          )}
          {presentCategories.length > 0 && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Filter kategori">
              <Chip active={categories.length === 0} onClick={() => setCategories([])}>
                Semua
              </Chip>
              {presentCategories.map((c) => (
                <Chip key={c} active={categories.includes(c)} onClick={() => toggleCategory(c)} color={CATEGORY_COLOR[c]}>
                  {EXPENSE_CATEGORY_LABEL[c]}
                </Chip>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {expensesQuery.isPending ? (
        <LoadingState />
      ) : expensesQuery.isError ? (
        <ErrorState error={expensesQuery.error} />
      ) : (
        <>
          <SummaryStrip
            total={summary.total}
            delta={summary.delta}
            byCategory={summary.byCategory}
            refunds={summary.refunds}
            listTotal={summary.listTotal}
            sharedExcluded={summary.sharedExcluded}
            count={rows.length}
            categoryFiltered={categories.length > 0}
          />

          {rows.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-10 w-10" />}
              title="Belum ada pengeluaran"
              description={
                categories.length
                  ? 'Tidak ada pengeluaran untuk kategori yang dipilih pada periode ini.'
                  : `Tidak ada pengeluaran yang tercatat pada ${rangeLabel(range, isMonth)} untuk ${showShared ? 'semua kos' : propertyName(selectedPropertyId)}.`
              }
              action={
                <Button onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
                  Catat pengeluaran
                </Button>
              }
            />
          ) : (
            <>
              {/* Mobile: grouped by date with sticky headings */}
              <div className="space-y-1 md:hidden">
                {groups.map((g) => (
                  <section key={g.date}>
                    <h2
                      className="sticky z-10 -mx-4 flex items-baseline justify-between bg-slate-50/95 px-4 py-1.5 text-xs font-semibold text-slate-600 backdrop-blur"
                      style={{ top: headerOffset }}
                    >
                      <span>{dateHeading(g.date)}</span>
                      <span className="tabular-nums text-slate-500">{formatRupiah(g.total)}</span>
                    </h2>
                    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {g.rows.map((e) => (
                        <li key={e.id}>
                          <button type="button" onClick={() => setSheet(e)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 active:bg-slate-100">
                            <span className="h-9 w-1 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[e.category] }} aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-slate-900">{e.description}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
                                <span>{EXPENSE_CATEGORY_LABEL[e.category]}</span>
                                <span aria-hidden>·</span>
                                <span className={clsx(e.property_id === null && 'text-sky-700')}>{propertyName(e.property_id)}</span>
                                {e.vendor && (
                                  <>
                                    <span aria-hidden>·</span>
                                    <span className="truncate">{e.vendor}</span>
                                  </>
                                )}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end">
                              <span className={clsx('text-sm font-semibold tabular-nums', isRefundCategory(e.category) ? 'text-slate-600' : 'text-rose-700')}>
                                {formatRupiah(e.amount)}
                              </span>
                              {e.receipt_path && <Paperclip className="mt-0.5 h-3.5 w-3.5 text-slate-400" aria-label="Ada struk" />}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block">
                <DataTable
                  columns={columns}
                  rows={rows}
                  rowKey={(e) => e.id}
                  onRowClick={(e) => (canEdit ? openEdit(e) : setSheet(e))}
                  footer={
                    <tr>
                      <td colSpan={5} className="px-3 py-2.5 text-slate-600">
                        {rows.length} transaksi · Total daftar
                        {summary.refunds > 0 && <span className="text-slate-500"> (termasuk pengembalian {formatRupiah(summary.refunds)}; operasional {formatRupiah(summary.total)})</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{formatRupiah(summary.listTotal)}</td>
                      <td />
                    </tr>
                  }
                />
              </div>
            </>
          )}
        </>
      )}

      {/* Mobile row action sheet */}
      <Modal open={sheet !== null} onClose={() => setSheet(null)} title={sheet?.description ?? ''} size="sm">
        {sheet && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Jumlah</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{formatRupiah(sheet.amount)}</dd>
              <dt className="text-slate-500">Tanggal</dt>
              <dd className="text-slate-900">{formatDate(sheet.expense_date)}</dd>
              <dt className="text-slate-500">Kos</dt>
              <dd className="text-slate-900">{propertyName(sheet.property_id)}</dd>
              <dt className="text-slate-500">Kategori</dt>
              <dd>
                <CategoryBadge category={sheet.category} />
              </dd>
              {sheet.vendor && (
                <>
                  <dt className="text-slate-500">Vendor</dt>
                  <dd className="text-slate-900">{sheet.vendor}</dd>
                </>
              )}
              {isRefundCategory(sheet.category) && refundTarget(sheet) && (
                <>
                  <dt className="text-slate-500">Dikembalikan ke</dt>
                  <dd className="text-slate-900">{refundTarget(sheet)}</dd>
                </>
              )}
            </dl>
            <div className="grid gap-2">
              {canEdit ? (
                <Button variant="outline" fullWidth icon={<Pencil className="h-4 w-4" />} onClick={() => openEdit(sheet)}>
                  Ubah
                </Button>
              ) : (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{EDIT_DENIED_HINT}</p>
              )}
              <Button variant="outline" fullWidth icon={<Copy className="h-4 w-4" />} onClick={() => openDuplicate(sheet)}>
                Duplikat ke bulan ini
              </Button>
              {sheet.receipt_path && (
                <Button variant="outline" fullWidth icon={<Paperclip className="h-4 w-4" />} onClick={() => setReceiptPath(sheet.receipt_path)}>
                  Lihat struk
                </Button>
              )}
              {canDelete && (
                <Button variant="danger" fullWidth icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(sheet)}>
                  Hapus
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {form && (
        <ExpenseFormModal key={form.key} mode={form.mode} title={form.title} initial={form.initial} editingId={form.editingId} onSaved={onSaved} onClose={() => setForm(null)} />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        title="Hapus pengeluaran?"
        message={
          deleting && (
            <>
              <strong>{deleting.description}</strong> sebesar {formatRupiah(deleting.amount)} pada {formatDate(deleting.expense_date)} akan dihapus permanen.
            </>
          )
        }
      />

      <ReceiptModal path={receiptPath} onClose={() => setReceiptPath(null)} />
    </>
  )
}

// ---------------------------------------------------------------- pieces

function CategoryBadge({ category }: { category: ExpenseCategory }) {
  return <Badge tone={CATEGORY_TONE[category]}>{EXPENSE_CATEGORY_LABEL[category]}</Badge>
}

function Chip({ active, onClick, color, children }: { active: boolean; onClick: () => void; color?: string; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors',
        active ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
      )}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: active ? '#fff' : color }} aria-hidden />}
      {children}
    </button>
  )
}

function IconButton({ label, onClick, icon, danger, disabled }: { label: string; onClick?: () => void; icon: ReactNode; danger?: boolean; disabled?: boolean }) {
  // The wrapping span carries the tooltip too: disabled buttons do not get hover events in every browser.
  return (
    <span title={label} className="inline-flex">
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={clsx(
          'rounded-md p-1.5 transition-colors',
          disabled ? 'cursor-not-allowed text-slate-300' : danger ? 'text-slate-400 hover:bg-red-50 hover:text-red-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-800',
        )}
      >
        {icon}
      </button>
    </span>
  )
}

function SummaryStrip({
  total,
  delta,
  byCategory,
  refunds,
  listTotal,
  sharedExcluded,
  count,
  categoryFiltered,
}: {
  total: number
  delta: { text: string; tone: 'positive' | 'negative' | 'neutral' }
  byCategory: ReturnType<typeof expensesByCategory>
  /** refunds in the visible list (not part of `total`) */
  refunds: number
  /** sum of every visible row, refunds included */
  listTotal: number
  sharedExcluded: number
  count: number
  categoryFiltered: boolean
}) {
  const toneClass = { positive: 'text-emerald-700', negative: 'text-rose-700', neutral: 'text-slate-500' }[delta.tone]
  return (
    <Card className="mb-3">
      <CardBody className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Total pengeluaran operasional{categoryFiltered ? ' (kategori terpilih)' : ''}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-rose-700">{formatRupiah(total)}</p>
          <p className={clsx('mt-1 text-xs font-medium', toneClass)}>{delta.text}</p>
          <p className="mt-1 text-xs text-slate-500">{count} transaksi dalam daftar</p>
          {refunds > 0 && (
            <p className="mt-2 flex items-start gap-1 text-xs text-slate-500">
              <Undo2 className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Daftar juga memuat pengembalian ke penyewa {formatRupiah(refunds)} yang <strong className="font-medium">tidak</strong> dihitung dalam total operasional
                (total daftar {formatRupiah(listTotal)}).
              </span>
            </p>
          )}
          {sharedExcluded > 0 && (
            <p className="mt-2 text-xs text-amber-700">Biaya Bersama {formatRupiah(sharedExcluded)} tidak dihitung saat satu kos dipilih. Pilih "Semua kos" untuk melihatnya.</p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Per kategori</p>
          {byCategory.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Belum ada data pada periode ini.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {byCategory.map((row) => (
                <li key={row.category} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-slate-700">{row.label}</span>
                    <span className="shrink-0 tabular-nums text-slate-600">
                      {shortRupiah(row.amount)} <span className="text-slate-400">· {Math.round(row.share * 100)}%</span>
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, row.share * 100)}%`, backgroundColor: CATEGORY_COLOR[row.category] }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
