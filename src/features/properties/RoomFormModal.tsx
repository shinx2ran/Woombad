import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { clsx } from 'clsx'
import { Button, Input, Modal, MoneyInput, Select, Textarea, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInsert, useInvalidate, useUpdate } from '../../hooks/useTable'
import { ROOM_STATUSES, ROOM_STATUS_LABEL, type OrgInsert, type Property, type Room } from '../../types/db'
import {
  BULK_ROOM_LIMIT,
  blankToNull,
  buildBulkRoomNames,
  findDuplicateRoomNames,
  validateRoomForm,
  zeroToNull,
  type RoomFormValues,
} from './roomUtils'

type Mode = 'single' | 'bulk'

const EMPTY: RoomFormValues = { name: '', floor: '', price_daily: 0, price_weekly: 0, price_monthly: 0, status: 'active', notes: '' }

function toValues(room: Room | null): RoomFormValues {
  if (!room) return EMPTY
  return {
    name: room.name,
    floor: room.floor ?? '',
    price_daily: room.price_daily ?? 0,
    price_weekly: room.price_weekly ?? 0,
    price_monthly: room.price_monthly ?? 0,
    status: room.status,
    notes: room.notes ?? '',
  }
}

interface BulkValues {
  prefix: string
  from: string
  to: string
  pad: boolean
}

/**
 * Create one room, create many at once ("Tambah banyak"), or edit an existing room. Staff only edit existing
 * rooms and never the prices (the database rejects price changes by staff, SPEC 6.2): those fields are read-only.
 */
export function RoomFormModal({
  open,
  property,
  room,
  existingRooms,
  isAdmin,
  onClose,
}: {
  open: boolean
  property: Property
  room: Room | null
  existingRooms: Room[]
  isAdmin: boolean
  onClose: () => void
}) {
  const { repo } = useOrg()
  const toast = useToast()
  const insert = useInsert('rooms')
  const update = useUpdate('rooms')
  const invalidate = useInvalidate()

  const [mode, setMode] = useState<Mode>('single')
  const [values, setValues] = useState<RoomFormValues>(() => toValues(room))
  const [bulk, setBulk] = useState<BulkValues>({ prefix: '', from: '1', to: '6', pad: false })
  const [errors, setErrors] = useState<Partial<Record<keyof RoomFormValues, string>>>({})
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setValues(toValues(room))
      setMode('single')
      setErrors({})
      setBulkError(null)
    }
  }, [open, room])

  const set = <K extends keyof RoomFormValues>(key: K, value: RoomFormValues[K]) => setValues((v) => ({ ...v, [key]: value }))

  const existingNames = useMemo(
    () => existingRooms.filter((r) => r.id !== room?.id).map((r) => r.name),
    [existingRooms, room?.id],
  )

  /** Preview of bulk names; `error` carries the Indonesian validation message. */
  const bulkPreview = useMemo(() => {
    if (mode !== 'bulk') return { names: [] as string[], duplicates: [] as string[], error: null as string | null }
    const from = Number(bulk.from)
    const to = Number(bulk.to)
    if (bulk.from.trim() === '' || bulk.to.trim() === '') return { names: [], duplicates: [], error: 'Isi nomor awal dan akhir.' }
    try {
      const names = buildBulkRoomNames(bulk.prefix, from, to, bulk.pad)
      return { names, duplicates: findDuplicateRoomNames(names, existingNames), error: null }
    } catch (err) {
      return { names: [], duplicates: [], error: err instanceof Error ? err.message : 'Rentang tidak valid.' }
    }
  }, [mode, bulk, existingNames])

  const pricePatch = () => ({
    price_daily: zeroToNull(values.price_daily),
    price_weekly: zeroToNull(values.price_weekly),
    price_monthly: zeroToNull(values.price_monthly),
  })

  const saving = insert.isPending || update.isPending || bulkSaving

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'bulk') return submitBulk()
    const errs = validateRoomForm(values, { existingNames })
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    const patch = {
      name: values.name.trim(),
      floor: blankToNull(values.floor),
      ...(isAdmin ? pricePatch() : {}),
      status: values.status,
      notes: blankToNull(values.notes),
    }
    try {
      if (room) {
        await update.mutateAsync({ id: room.id, patch })
        toast.success(`Kamar ${patch.name} disimpan.`)
      } else {
        await insert.mutateAsync({ property_id: property.id, ...pricePatch(), ...patch })
        toast.success(`Kamar ${patch.name} ditambahkan.`)
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan kamar.')
    }
  }

  const submitBulk = async () => {
    // Name is taken from the prefix/range; validate the shared fields with a placeholder name.
    const errs = validateRoomForm({ ...values, name: 'x' }, { existingNames: [] })
    delete errs.name
    setErrors(errs)
    if (bulkPreview.error) return setBulkError(bulkPreview.error)
    if (bulkPreview.duplicates.length > 0) {
      return setBulkError(`Nama kamar sudah ada: ${bulkPreview.duplicates.join(', ')}. Ubah awalan atau rentang nomor.`)
    }
    setBulkError(null)
    if (Object.keys(errs).length > 0) return
    const rows: OrgInsert<'rooms'>[] = bulkPreview.names.map((name) => ({
      property_id: property.id,
      name,
      floor: blankToNull(values.floor),
      ...pricePatch(),
      status: values.status,
      notes: blankToNull(values.notes),
    }))
    setBulkSaving(true)
    try {
      await repo.insertMany('rooms', rows)
      await invalidate('rooms')
      toast.success(`${rows.length} kamar ditambahkan (${rows[0].name} s/d ${rows[rows.length - 1].name}).`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menambahkan kamar.')
    } finally {
      setBulkSaving(false)
    }
  }

  const title = room ? `Ubah Kamar ${room.name}` : 'Tambah Kamar'
  const submitLabel = room ? 'Simpan' : mode === 'bulk' ? `Tambah ${bulkPreview.names.length || ''} Kamar`.replace('  ', ' ') : 'Tambah Kamar'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="room-form" loading={saving}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="room-form" onSubmit={submit} className="space-y-4" noValidate>
        {!room && (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Cara menambah kamar">
            {(
              [
                { id: 'single', label: 'Satu kamar' },
                { id: 'bulk', label: 'Tambah banyak' },
              ] as { id: Mode; label: string }[]
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => setMode(m.id)}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  mode === m.id ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {mode === 'single' ? (
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Nama kamar"
              required
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              error={errors.name}
              placeholder="mis. A1"
              autoFocus
            />
            <Input label="Lantai" value={values.floor} onChange={(e) => set('floor', e.target.value)} placeholder="mis. 1" />
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3">
            <p className="text-sm text-slate-700">
              Buat beberapa kamar sekaligus dengan awalan dan rentang nomor. Semua kamar memakai lantai, harga, dan status yang sama.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Awalan" value={bulk.prefix} onChange={(e) => setBulk((b) => ({ ...b, prefix: e.target.value }))} placeholder="A" autoFocus />
              <Input
                label="Dari"
                type="number"
                inputMode="numeric"
                min={0}
                value={bulk.from}
                onChange={(e) => setBulk((b) => ({ ...b, from: e.target.value }))}
              />
              <Input
                label="Sampai"
                type="number"
                inputMode="numeric"
                min={0}
                value={bulk.to}
                onChange={(e) => setBulk((b) => ({ ...b, to: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-400"
                checked={bulk.pad}
                onChange={(e) => setBulk((b) => ({ ...b, pad: e.target.checked }))}
              />
              Nomor dengan nol di depan (A01, A02, …)
            </label>
            <Input label="Lantai (untuk semua)" value={values.floor} onChange={(e) => set('floor', e.target.value)} placeholder="mis. 1" />
            {bulkPreview.error ? (
              <p className="text-xs text-red-600">{bulkPreview.error}</p>
            ) : (
              <p className="text-xs text-slate-600">
                Akan membuat <strong>{bulkPreview.names.length}</strong> kamar (maks. {BULK_ROOM_LIMIT}):{' '}
                <span className="font-mono">
                  {bulkPreview.names.slice(0, 8).join(', ')}
                  {bulkPreview.names.length > 8 ? `, … ${bulkPreview.names[bulkPreview.names.length - 1]}` : ''}
                </span>
              </p>
            )}
            {bulkPreview.duplicates.length > 0 && (
              <p className="text-xs text-red-600">Sudah ada di kos ini: {bulkPreview.duplicates.join(', ')}</p>
            )}
            {bulkError && <p className="text-xs text-red-600">{bulkError}</p>}
          </div>
        )}

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-slate-700">Harga default</legend>
          <MoneyInput label="Bulanan" value={values.price_monthly} onChange={(v) => set('price_monthly', v)} error={errors.price_monthly} min={0} disabled={!isAdmin} />
          <div className="grid grid-cols-2 gap-3">
            <MoneyInput label="Mingguan" value={values.price_weekly} onChange={(v) => set('price_weekly', v)} error={errors.price_weekly} min={0} disabled={!isAdmin} />
            <MoneyInput label="Harian" value={values.price_daily} onChange={(v) => set('price_daily', v)} error={errors.price_daily} min={0} disabled={!isAdmin} />
          </div>
          <p className="text-xs text-slate-500">
            {isAdmin
              ? 'Harga ini menjadi isian awal saat membuat sewa; harga tiap sewa tetap bisa diubah.'
              : 'Hanya pemilik/admin yang dapat mengubah harga kamar.'}
          </p>
        </fieldset>

        <Select
          label="Status kamar"
          value={values.status}
          onChange={(e) => set('status', e.target.value as Room['status'])}
          options={ROOM_STATUSES.map((s) => ({ value: s, label: s === 'maintenance' ? 'Perbaikan (tidak disewakan)' : ROOM_STATUS_LABEL[s] }))}
          hint="Hunian (terisi/kosong) dihitung otomatis dari data sewa."
        />
        <Textarea label="Catatan" rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} placeholder="mis. AC, kamar mandi dalam" />
      </form>
    </Modal>
  )
}
