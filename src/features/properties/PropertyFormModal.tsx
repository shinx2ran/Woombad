import { useEffect, useState, type FormEvent } from 'react'
import { Button, Input, Modal, Textarea, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInsert, useUpdate } from '../../hooks/useTable'
import type { Property } from '../../types/db'
import { blankToNull, validatePropertyForm, type PropertyFormValues } from './roomUtils'

const EMPTY: PropertyFormValues = { name: '', address: '', notes: '', payment_info: '' }

function toValues(p: Property | null): PropertyFormValues {
  if (!p) return EMPTY
  return { name: p.name, address: p.address ?? '', notes: p.notes ?? '', payment_info: p.payment_info ?? '' }
}

/** Create (property = null) or edit a kos. Calls refreshProperties() so the global switcher updates. */
export function PropertyFormModal({
  open,
  property,
  onClose,
  onSaved,
}: {
  open: boolean
  property: Property | null
  onClose: () => void
  onSaved?: (saved: Property) => void
}) {
  const { refreshProperties } = useOrg()
  const toast = useToast()
  const insert = useInsert('properties')
  const update = useUpdate('properties')
  const [values, setValues] = useState<PropertyFormValues>(() => toValues(property))
  const [errors, setErrors] = useState<Partial<Record<keyof PropertyFormValues, string>>>({})

  useEffect(() => {
    if (open) {
      setValues(toValues(property))
      setErrors({})
    }
  }, [open, property])

  const set = <K extends keyof PropertyFormValues>(key: K, value: PropertyFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const saving = insert.isPending || update.isPending

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validatePropertyForm(values)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    const patch = {
      name: values.name.trim(),
      address: blankToNull(values.address),
      notes: blankToNull(values.notes),
      payment_info: blankToNull(values.payment_info),
    }
    try {
      const saved = property ? await update.mutateAsync({ id: property.id, patch }) : await insert.mutateAsync(patch)
      await refreshProperties()
      toast.success(property ? 'Data kos disimpan.' : `Kos "${saved.name}" ditambahkan.`)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan kos.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={property ? 'Ubah Kos' : 'Tambah Kos'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="property-form" loading={saving}>
            {property ? 'Simpan' : 'Tambah Kos'}
          </Button>
        </>
      }
    >
      <form id="property-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Nama kos"
          required
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          placeholder="mis. Kos Melati"
          autoFocus
        />
        <Textarea
          label="Alamat"
          rows={2}
          value={values.address}
          onChange={(e) => set('address', e.target.value)}
          placeholder="Jl. Melati No. 12, Bandung"
        />
        <Textarea
          label="Info rekening / QRIS untuk pengingat"
          rows={2}
          value={values.payment_info}
          onChange={(e) => set('payment_info', e.target.value)}
          placeholder="mis. BCA 1234567890 a.n. Ibu Sari"
          hint="Disisipkan ke pesan WhatsApp pengingat tagihan."
        />
        <Textarea label="Catatan" rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} />
      </form>
    </Modal>
  )
}
