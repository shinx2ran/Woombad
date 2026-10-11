import { useEffect, useState, type FormEvent } from 'react'
import { Button, Input, Modal, MoneyInput, Select, useToast } from '../../components/ui'
import { useInsert, useUpdate } from '../../hooks/useTable'
import { ADDON_BILLINGS, ADDON_BILLING_LABEL, type AddonBilling, type AddonCatalogItem, type Property } from '../../types/db'
import { validateAddonForm, type AddonFormValues } from './roomUtils'

function toValues(addon: AddonCatalogItem | null): AddonFormValues {
  if (!addon) return { name: '', default_price: 0, billing: 'per_period', scope: 'property' }
  return { name: addon.name, default_price: addon.default_price, billing: addon.billing, scope: addon.property_id === null ? 'org' : 'property' }
}

/** Create or edit an addon_catalog row. Scope decides property_id (this kos) vs null (every kos). */
export function AddonFormModal({
  open,
  property,
  addon,
  onClose,
}: {
  open: boolean
  property: Property
  addon: AddonCatalogItem | null
  onClose: () => void
}) {
  const toast = useToast()
  const insert = useInsert('addon_catalog')
  const update = useUpdate('addon_catalog')
  const [values, setValues] = useState<AddonFormValues>(() => toValues(addon))
  const [errors, setErrors] = useState<Partial<Record<keyof AddonFormValues, string>>>({})

  useEffect(() => {
    if (open) {
      setValues(toValues(addon))
      setErrors({})
    }
  }, [open, addon])

  const set = <K extends keyof AddonFormValues>(key: K, value: AddonFormValues[K]) => setValues((v) => ({ ...v, [key]: value }))
  const saving = insert.isPending || update.isPending

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validateAddonForm(values)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    const patch = {
      name: values.name.trim(),
      default_price: Math.round(values.default_price),
      billing: values.billing,
      property_id: values.scope === 'org' ? null : property.id,
    }
    try {
      if (addon) await update.mutateAsync({ id: addon.id, patch })
      else await insert.mutateAsync(patch)
      toast.success(addon ? 'Add-on disimpan.' : `Add-on "${patch.name}" ditambahkan.`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan add-on.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={addon ? 'Ubah Add-on' : 'Tambah Add-on'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="addon-form" loading={saving}>
            {addon ? 'Simpan' : 'Tambah Add-on'}
          </Button>
        </>
      }
    >
      <form id="addon-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Nama add-on"
          required
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          placeholder="mis. Parkir motor"
          autoFocus
        />
        <MoneyInput label="Harga default" value={values.default_price} onChange={(v) => set('default_price', v)} error={errors.default_price} min={0} />
        <Select
          label="Penagihan"
          value={values.billing}
          onChange={(e) => set('billing', e.target.value as AddonBilling)}
          options={ADDON_BILLINGS.map((b) => ({ value: b, label: ADDON_BILLING_LABEL[b] }))}
          hint={values.billing === 'per_period' ? 'Dikalikan jumlah periode pada setiap tagihan.' : 'Hanya ditagihkan pada tagihan pertama sewa.'}
        />
        <Select
          label="Berlaku untuk"
          value={values.scope}
          onChange={(e) => set('scope', e.target.value as AddonFormValues['scope'])}
          options={[
            { value: 'property', label: `Kos ini (${property.name})` },
            { value: 'org', label: 'Semua kos' },
          ]}
        />
        <p className="text-xs text-slate-500">Perubahan katalog tidak mengubah add-on pada sewa yang sudah berjalan.</p>
      </form>
    </Modal>
  )
}
