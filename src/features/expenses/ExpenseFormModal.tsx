import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { clsx } from 'clsx'
import { Camera, Trash2 } from 'lucide-react'
import { Button, Field, Input, Modal, MoneyInput, Select, Textarea, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate, useTable } from '../../hooks/useTable'
import { newId } from '../../lib/ids'
import { formatRupiah } from '../../lib/format'
import type { ExpenseCategory } from '../../types/db'
import {
  EXPENSE_TEMPLATES,
  ORDERED_CATEGORIES,
  SHARED_VALUE,
  categoryOptionLabel,
  isRefundCategory,
  leaseLabel,
  saveErrorMessage,
  splitEvenly,
  splitExpenseRows,
  validateExpenseForm,
  type ExpenseDraft,
  type ExpenseFormErrors,
} from './expenseUtils'
import { removeReceiptIfUnused } from './receiptFiles'

export type ExpenseFormMode = 'create' | 'edit' | 'duplicate'

export interface ExpenseFormModalProps {
  mode: ExpenseFormMode
  title: string
  /** prefilled values (for edit / duplicate) */
  initial: ExpenseDraft
  /** row id when mode = 'edit' */
  editingId?: string
  onClose: () => void
  /** Called after a successful save with the expense_date of the saved row(s), before onClose. */
  onSaved?: (expenseDate: string) => void
}

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024

function initialPropertyValue(initial: ExpenseDraft, mode: ExpenseFormMode, selectedPropertyId: string): string {
  // Edit / duplicate keep the row's kos ("Bersama" when null); a brand-new row follows the global filter when
  // it is one kos and otherwise forces an explicit choice.
  if (mode !== 'create') return initial.property_id ?? SHARED_VALUE
  return selectedPropertyId !== 'all' ? selectedPropertyId : ''
}

/**
 * Create / edit / duplicate form. Mounted fresh for every open (the page gives it a new `key`),
 * so state can be initialised from props without sync effects.
 */
export function ExpenseFormModal({ mode, title, initial, editingId, onClose, onSaved }: ExpenseFormModalProps) {
  const { repo, properties, selectedPropertyId, isLocalMode } = useOrg()
  const invalidate = useInvalidate()
  const toast = useToast()
  const leasesQuery = useTable('leases')
  const tenantsQuery = useTable('tenants')
  const roomsQuery = useTable('rooms')

  const [expenseDate, setExpenseDate] = useState(initial.expense_date)
  const [property, setProperty] = useState(() => initialPropertyValue(initial, mode, selectedPropertyId))
  const [category, setCategory] = useState<ExpenseCategory>(initial.category)
  const [leaseId, setLeaseId] = useState(initial.lease_id ?? '')
  const [amount, setAmount] = useState(initial.amount)
  const [description, setDescription] = useState(initial.description)
  const [vendor, setVendor] = useState(initial.vendor ?? '')
  const [split, setSplit] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [removeReceipt, setRemoveReceipt] = useState(false)
  const [errors, setErrors] = useState<ExpenseFormErrors>({})
  const [saving, setSaving] = useState(false)

  const clearError = (field: keyof ExpenseFormErrors) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const isRefund = isRefundCategory(category)
  const propertyId = property && property !== SHARED_VALUE ? property : null
  const isEdit = mode === 'edit'
  const canSplit = !isEdit && property === SHARED_VALUE && properties.length > 1 && !isRefund

  const leaseOptions = useMemo(() => {
    const leases = leasesQuery.data ?? []
    const tenants = tenantsQuery.data ?? []
    const rooms = roomsQuery.data ?? []
    const scoped = propertyId ? leases.filter((l) => l.property_id === propertyId) : leases
    const order = { active: 0, ended: 1, cancelled: 2 }
    return [...scoped]
      .sort((a, b) => order[a.status] - order[b.status] || (a.start_date < b.start_date ? 1 : -1))
      .map((l) => ({
        value: l.id,
        label: leaseLabel(l, tenants, rooms, propertyId ? undefined : properties.find((p) => p.id === l.property_id)?.name),
      }))
  }, [leasesQuery.data, tenantsQuery.data, roomsQuery.data, propertyId, properties])

  const propertyOptions = [
    { value: SHARED_VALUE, label: 'Bersama (semua kos)' },
    ...properties.map((p) => ({ value: p.id, label: p.name })),
  ]

  const applyTemplate = (templateId: string) => {
    const t = EXPENSE_TEMPLATES.find((x) => x.id === templateId)
    if (!t) return
    setCategory(t.category)
    setDescription(t.description)
    clearError('description')
  }

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null
    if (picked && picked.size > MAX_RECEIPT_BYTES) {
      toast.error('Ukuran foto maksimal 8 MB.')
      e.target.value = ''
      return
    }
    setFile(picked)
    if (picked) setRemoveReceipt(false)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const values = { expense_date: expenseDate, property, category, lease_id: isRefund ? leaseId : '', amount, description }
    const nextErrors = validateExpenseForm(values)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSaving(true)
    try {
      // A refund always belongs to the kos of the lease it goes back to.
      const lease = isRefund ? (leasesQuery.data ?? []).find((l) => l.id === leaseId) : undefined
      const draft: ExpenseDraft = {
        expense_date: expenseDate,
        property_id: lease ? lease.property_id : propertyId,
        lease_id: isRefund ? leaseId : null,
        category,
        amount,
        description: description.trim(),
        vendor: vendor.trim() || null,
        receipt_path: removeReceipt ? null : initial.receipt_path,
      }

      // 1) Persist the row(s) first. A write the database refuses (e.g. staff editing someone else's row under
      //    the `expenses_update` policy) fails here, before any file reaches the bucket, so nothing is orphaned.
      let savedIds: string[]
      let successMessage: string
      if (isEdit && editingId) {
        await repo.update('expenses', editingId, draft)
        savedIds = [editingId]
        successMessage = 'Pengeluaran diperbarui.'
      } else if (canSplit && split) {
        const rows = await repo.insertMany(
          'expenses',
          splitExpenseRows(
            draft,
            properties.map((p) => p.id),
          ),
        )
        savedIds = rows.map((r) => r.id)
        successMessage = `${rows.length} pengeluaran dicatat (dibagi rata ke semua kos).`
      } else {
        const row = await repo.insert('expenses', draft)
        savedIds = [row.id]
        successMessage = 'Pengeluaran dicatat.'
      }

      // 2) Receipt: upload only once the row exists, then attach it. A failed upload keeps the saved row.
      let receiptWarning: string | null = null
      let receiptPath = draft.receipt_path
      if (file) {
        let uploaded: string | null = null
        try {
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
          uploaded = await repo.uploadFile('receipts', `${newId()}.${ext}`, file, file.type || undefined)
          if (uploaded) {
            const path = uploaded
            await Promise.all(savedIds.map((id) => repo.update('expenses', id, { receipt_path: path })))
            receiptPath = uploaded
          }
        } catch {
          receiptWarning = 'Pengeluaran tersimpan, tetapi foto struk gagal diunggah. Coba unggah lagi lewat "Ubah".'
          // Not attached to any row: do not leave the new file behind (several rows may hold it after a partial split).
          if (uploaded && savedIds.length === 1) await repo.removeFile('receipts', uploaded).catch(() => undefined)
        }
      }
      // 3) Only after the row no longer points at it (removed or replaced) is the old file deleted (SPEC 6.4).
      if (isEdit && initial.receipt_path && initial.receipt_path !== receiptPath) {
        try {
          await removeReceiptIfUnused(repo, initial.receipt_path)
        } catch {
          receiptWarning ??= 'Pengeluaran tersimpan, tetapi foto struk lama gagal dihapus dari penyimpanan.'
        }
      }

      await invalidate('expenses')
      if (receiptWarning) toast.error(receiptWarning)
      else toast.success(successMessage)
      onSaved?.(draft.expense_date)
      onClose()
    } catch (err) {
      toast.error(saveErrorMessage(err, 'Gagal menyimpan pengeluaran.'))
    } finally {
      setSaving(false)
    }
  }

  const splitParts = canSplit && split ? splitEvenly(amount, properties.length) : null
  const hasStoredReceipt = Boolean(initial.receipt_path) && !removeReceipt && !file

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="expense-form" loading={saving}>
            {isEdit ? 'Simpan perubahan' : 'Simpan'}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} className="space-y-4" noValidate>
        {!isEdit && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">Template cepat</p>
            <div className="flex flex-wrap gap-1.5">
              {EXPENSE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t.id)}
                  className={clsx(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    description === t.description && category === t.category
                      ? 'border-brand-600 bg-brand-50 text-brand-800'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Tanggal"
            type="date"
            required
            value={expenseDate}
            onChange={(e) => {
              setExpenseDate(e.target.value)
              clearError('expense_date')
            }}
            error={errors.expense_date}
          />
          <Select
            label="Kos"
            required
            value={property}
            onChange={(e) => {
              const next = e.target.value
              setProperty(next)
              // keep the chosen lease unless it belongs to another kos than the one just picked
              if (leaseId && next !== SHARED_VALUE) {
                const lease = (leasesQuery.data ?? []).find((l) => l.id === leaseId)
                if (lease && lease.property_id !== next) setLeaseId('')
              }
              setSplit(false)
              clearError('property')
            }}
            options={propertyOptions}
            placeholder="— Pilih kos —"
            error={errors.property}
            hint={
              !errors.property && selectedPropertyId === 'all' && mode === 'create' && !property
                ? isRefund
                  ? 'Boleh dikosongkan: kos mengikuti sewa yang dipilih di bawah.'
                  : 'Filter kos sedang "Semua kos": pilih kos secara eksplisit.'
                : undefined
            }
          />
        </div>

        <Select
          label="Kategori"
          required
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as ExpenseCategory)
            setSplit(false)
          }}
          options={ORDERED_CATEGORIES.map((c) => ({ value: c, label: categoryOptionLabel(c) }))}
          hint={isRefund ? 'Pengembalian uang ke penyewa: bukan biaya operasional, tidak masuk laba rugi sebagai biaya.' : undefined}
        />

        {isRefund && (
          <Select
            label="Sewa yang menerima pengembalian"
            required
            value={leaseId}
            onChange={(e) => {
              const nextLeaseId = e.target.value
              setLeaseId(nextLeaseId)
              clearError('lease_id')
              // the hint promises "kos follows the lease": reflect it in the kos select straight away
              const lease = (leasesQuery.data ?? []).find((l) => l.id === nextLeaseId)
              if (lease && property !== lease.property_id) {
                setProperty(lease.property_id)
                clearError('property')
              }
            }}
            options={leaseOptions}
            placeholder={leasesQuery.isPending ? 'Memuat sewa…' : leaseOptions.length === 0 ? 'Tidak ada sewa di kos ini' : '— Pilih sewa —'}
            error={errors.lease_id}
            hint={!errors.lease_id && !propertyId ? 'Kolom Kos akan terisi otomatis mengikuti kos dari sewa yang dipilih.' : undefined}
          />
        )}

        <MoneyInput
          label="Jumlah"
          required
          value={amount}
          onChange={(v) => {
            setAmount(v)
            clearError('amount')
          }}
          error={errors.amount}
          min={0}
        />

        {canSplit && (
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={split} onChange={(e) => setSplit(e.target.checked)} />
            <span>
              <span className="font-medium">Bagi rata ke semua kos</span>
              <span className="block text-xs text-slate-500">
                {splitParts
                  ? `${properties.length} baris: ${formatRupiah(splitParts[0])}${splitParts[0] !== splitParts[1] ? ` + ${properties.length - 1} × ${formatRupiah(splitParts[1])}` : ` per kos`}; deskripsi diberi akhiran (1/${properties.length}) dst.`
                  : `Buat ${properties.length} baris, satu per kos, dengan jumlah dibagi rata.`}
              </span>
            </span>
          </label>
        )}

        <Textarea
          label="Deskripsi"
          required
          rows={2}
          placeholder="Contoh: Gaji penjaga kos bulan Oktober"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value)
            clearError('description')
          }}
          error={errors.description}
        />

        <Input label="Vendor / penerima" placeholder="Contoh: PLN, Pak Udin" value={vendor} onChange={(e) => setVendor(e.target.value)} />

        <Field label="Foto struk" hint={isLocalMode ? 'Mode Demo: foto tidak disimpan (butuh Supabase Storage, bucket "receipts").' : 'Opsional, maks. 8 MB.'}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Camera className="h-4 w-4" />
              {file ? 'Ganti foto' : hasStoredReceipt ? 'Ganti struk' : 'Pilih / ambil foto'}
              <input type="file" accept="image/*" className="sr-only" onChange={onPickFile} data-testid="receipt-input" />
            </label>
            {previewUrl && <img src={previewUrl} alt="Pratinjau struk" className="h-12 w-12 rounded-md border border-slate-200 object-cover" />}
            {file && (
              <span className="max-w-[12rem] truncate text-xs text-slate-500" title={file.name}>
                {file.name}
              </span>
            )}
            {hasStoredReceipt && (
              <>
                <span className="text-xs text-slate-500">Struk tersimpan</span>
                <button type="button" onClick={() => setRemoveReceipt(true)} className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline">
                  <Trash2 className="h-3.5 w-3.5" /> Hapus foto
                </button>
              </>
            )}
            {removeReceipt && !file && <span className="text-xs text-amber-700">Foto akan dihapus saat disimpan.</span>}
          </div>
        </Field>
      </form>
    </Modal>
  )
}
