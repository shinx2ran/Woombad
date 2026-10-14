import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { clsx } from 'clsx'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Button, Input, Modal, Textarea, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInsert, useUpdate } from '../../hooks/useTable'
import type { Property } from '../../types/db'
import { newId } from '../../lib/ids'
import { clearKosLogoCache, useKosLogo } from '../invoices/useKosLogo'
import { LOGO_ACCEPT, isLogoType, logoExtension, shrinkLogoImage } from './logoImage'
import { blankToNull, validatePropertyForm, type PropertyFormValues } from './roomUtils'

const EMPTY: PropertyFormValues = { name: '', address: '', notes: '', payment_info: '' }
/** the logos bucket accepts 1 MB; shrinkLogoImage keeps the upload far below that */
const MAX_LOGO_BYTES = 1024 * 1024

function toValues(p: Property | null): PropertyFormValues {
  if (!p) return EMPTY
  return { name: p.name, address: p.address ?? '', notes: p.notes ?? '', payment_info: p.payment_info ?? '' }
}

interface PickedLogo {
  blob: Blob
  /** object URL of `blob`, for the preview */
  url: string
}

/**
 * Create (property = null) or edit a kos, including the logo shown on invoices (SPEC 7.2): the row is saved
 * first, then a newly picked logo is uploaded to the `logos` bucket and `logo_path` updated (the old file is
 * removed best-effort, see SPEC 6.4). Calls refreshProperties() so the global switcher updates.
 */
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
  const { refreshProperties, repo, isLocalMode } = useOrg()
  const toast = useToast()
  const insert = useInsert('properties')
  const update = useUpdate('properties')
  const { logoUrl: currentLogoUrl } = useKosLogo(open ? property : null)
  const [values, setValues] = useState<PropertyFormValues>(() => toValues(property))
  const [errors, setErrors] = useState<Partial<Record<keyof PropertyFormValues, string>>>({})
  const [picked, setPicked] = useState<PickedLogo | null>(null)
  const [removeLogo, setRemoveLogo] = useState(false)
  const [preparingLogo, setPreparingLogo] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (open) {
      setValues(toValues(property))
      setErrors({})
      setPicked(null)
      setRemoveLogo(false)
    }
  }, [open, property])

  // the preview URL of a picked file is released when it is replaced, dropped or the modal unmounts
  useEffect(() => {
    if (!picked) return
    return () => URL.revokeObjectURL(picked.url)
  }, [picked])

  const set = <K extends keyof PropertyFormValues>(key: K, value: PropertyFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const saving = insert.isPending || update.isPending || uploading
  const hasLogo = Boolean(picked) || (Boolean(property?.logo_path) && !removeLogo)
  const previewUrl = picked ? picked.url : property?.logo_path && !removeLogo ? currentLogoUrl : null

  const onPickLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (!isLogoType(file.type)) {
      toast.error('Logo harus berupa gambar PNG, JPEG, atau WebP.')
      return
    }
    setPreparingLogo(true)
    try {
      const blob = await shrinkLogoImage(file)
      if (blob.size > MAX_LOGO_BYTES) {
        toast.error('Ukuran logo maksimal 1 MB.')
        return
      }
      setPicked({ blob, url: URL.createObjectURL(blob) })
      setRemoveLogo(false)
    } catch {
      toast.error('Gambar logo tidak dapat dibaca.')
    } finally {
      setPreparingLogo(false)
    }
  }

  const onRemoveLogo = () => {
    setPicked(null)
    setRemoveLogo(true)
  }

  /** Uploads the picked logo / removes the old one after the row is saved; returns the row as stored. */
  const syncLogo = async (saved: Property): Promise<Property> => {
    const oldPath = property?.logo_path ?? null
    if (picked) {
      let path: string | null = null
      try {
        // A fresh name per logo: the old file stays intact until the row points at the new one (SPEC 6.4),
        // and a cached link to the old logo can never show up as the new one.
        path = await repo.uploadFile('logos', `${saved.id}-${newId().slice(0, 8)}.${logoExtension(picked.blob.type)}`, picked.blob, picked.blob.type)
        if (path) saved = await repo.update('properties', saved.id, { logo_path: path })
      } catch (err) {
        if (path && saved.logo_path !== path) await repo.removeFile('logos', path).catch(() => undefined)
        path = null
        toast.error(`Data kos tersimpan, tetapi logo gagal diunggah: ${err instanceof Error ? err.message : 'kesalahan tak dikenal'}`)
      }
      if (path && oldPath && oldPath !== path) {
        await repo.removeFile('logos', oldPath).catch(() => toast.error('Logo lama gagal dihapus dari penyimpanan.'))
        clearKosLogoCache(oldPath)
      }
    } else if (removeLogo && oldPath) {
      try {
        saved = await repo.update('properties', saved.id, { logo_path: null })
        await repo.removeFile('logos', oldPath).catch(() => toast.error('Berkas logo gagal dihapus dari penyimpanan.'))
        clearKosLogoCache(oldPath)
      } catch (err) {
        toast.error(`Data kos tersimpan, tetapi logo gagal dihapus: ${err instanceof Error ? err.message : 'kesalahan tak dikenal'}`)
      }
    }
    return saved
  }

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
      // the logo is uploaded separately; an update never touches it, a new kos starts without one
      let saved = property ? await update.mutateAsync({ id: property.id, patch }) : await insert.mutateAsync({ ...patch, logo_path: null })
      if (!isLocalMode && (picked || removeLogo)) {
        setUploading(true)
        try {
          saved = await syncLogo(saved)
        } finally {
          setUploading(false)
        }
      }
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
          hint="Disisipkan ke pesan WhatsApp pengingat dan gambar tagihan."
        />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Logo kos</span>
          <div className="flex items-center gap-3">
            {previewUrl ? (
              <img src={previewUrl} alt="Logo kos" className="h-16 w-16 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1" />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-300" aria-hidden>
                <ImagePlus className="h-6 w-6" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <label
                className={clsx(
                  'inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800',
                  isLocalMode || preparingLogo ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-50',
                )}
              >
                <input type="file" accept={LOGO_ACCEPT} className="sr-only" onChange={onPickLogo} disabled={isLocalMode || preparingLogo} aria-label="Pilih logo" />
                <ImagePlus className="h-4 w-4" aria-hidden />
                {preparingLogo ? 'Menyiapkan…' : 'Pilih logo'}
              </label>
              {hasLogo && !isLocalMode && (
                <Button type="button" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={onRemoveLogo}>
                  Hapus logo
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500">{isLocalMode ? 'Logo hanya tersimpan di mode online.' : 'Tampil di tagihan yang dikirim ke penyewa. PNG transparan paling bagus.'}</p>
        </div>
        <Textarea label="Catatan" rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} />
      </form>
    </Modal>
  )
}
