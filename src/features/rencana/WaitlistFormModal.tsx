import { useState } from 'react'
import { clsx } from 'clsx'
import { Button, CountInput, Input, Modal, MoneyInput, Select, Textarea, useToast } from '../../components/ui'
import type { Property, WaitlistEntry } from '../../types/db'
import { PERIOD_UNIT_LABEL } from '../../types/db'
import { PeriodTypePicker } from '../leases/components'
import { useRencanaActions } from './useRencanaActions'
import { validateWaitlistForm, type WaitlistForm } from './waitlist'

export interface WaitlistFormModalProps {
  /** null = a new entry */
  entry: WaitlistEntry | null
  initial: WaitlistForm
  properties: Property[]
  /** focus the phone field (the missing-phone bubble opens the form there) */
  focusPhone?: boolean
  onClose: () => void
  onSaved?: (entry: WaitlistEntry) => void
}

/** Add or change a daftar tunggu entry (SPEC 7.7): who, from when (or secepatnya), how long, budget and preference. */
export function WaitlistFormModal({ entry, initial, properties, focusPhone, onClose, onSaved }: WaitlistFormModalProps) {
  const actions = useRencanaActions()
  const toast = useToast()
  const [form, setForm] = useState<WaitlistForm>(initial)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const errors = validateWaitlistForm(form)
  const set = <K extends keyof WaitlistForm>(key: K, value: WaitlistForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const unit = PERIOD_UNIT_LABEL[form.periodType]

  const submit = async () => {
    setTouched(true)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    try {
      const saved = entry ? await actions.updateEntry(entry, form) : await actions.addEntry(form)
      toast.success(entry ? 'Daftar tunggu diperbarui.' : `${saved.name} masuk daftar tunggu.`)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan daftar tunggu.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={entry ? 'Ubah daftar tunggu' : 'Tambah ke daftar tunggu'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={onClose}>
            Batal
          </Button>
          <Button size="lg" onClick={submit} loading={saving}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="waitlist-form">
        <Input label="Nama" value={form.name} onChange={(e) => set('name', e.target.value)} required autoComplete="off" autoFocus={!focusPhone} error={touched ? errors.name : undefined} />
        <Input
          label="Nomor HP"
          type="tel"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          autoComplete="off"
          autoFocus={focusPhone}
          error={touched ? errors.phone : undefined}
          hint="Untuk mengabari lewat WhatsApp bila ada kamar."
        />
        {properties.length > 1 && (
          <Select
            label="Kos"
            value={form.propertyId}
            onChange={(e) => set('propertyId', e.target.value)}
            options={[{ value: '', label: 'Kos mana saja' }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
          />
        )}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Mulai</span>
          <div role="radiogroup" aria-label="Mulai" className="grid grid-cols-2 gap-2">
            {[
              { asap: false, label: 'Tanggal' },
              { asap: true, label: 'Secepatnya' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={form.asap === o.asap}
                onClick={() => set('asap', o.asap)}
                className={clsx(
                  'h-11 rounded-lg border text-sm font-medium',
                  form.asap === o.asap ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {!form.asap && (
          <Input label="Tanggal check-in" type="date" value={form.wantedFrom} onChange={(e) => set('wantedFrom', e.target.value)} required error={touched ? errors.wantedFrom : undefined} />
        )}
        <PeriodTypePicker label="Jenis sewa" value={form.periodType} onChange={(t) => set('periodType', t)} />
        <div className="grid grid-cols-2 gap-3">
          <CountInput label={`Jumlah ${unit}`} value={form.quantity} onChange={(n) => set('quantity', n)} required error={touched ? errors.quantity : undefined} />
          <MoneyInput label={`Maks. / ${unit}`} value={form.maxPrice} onChange={(n) => set('maxPrice', n)} error={touched ? errors.maxPrice : undefined} hint="Kosong = bebas" />
        </div>
        <Input label="Preferensi kamar" value={form.roomNote} onChange={(e) => set('roomNote', e.target.value)} placeholder="mis. lantai bawah, kamar mandi dalam" autoComplete="off" />
        <Textarea label="Catatan" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
      </div>
    </Modal>
  )
}
