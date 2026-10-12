import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ScanLine, X } from 'lucide-react'
import { Button, Input, Modal, Select, Textarea, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInsert, useInvalidate, useUpdate } from '../../hooks/useTable'
import { GENDER_LABEL, GENDERS, ID_TYPE_LABEL, ID_TYPES, type Tenant } from '../../types/db'
import { isValidNik } from '../../domain/ktp'
import { DocumentScanner } from '../scanner/DocumentScanner'
import {
  applyScanPrefill,
  formToScanPrefill,
  formToTenantPayload,
  initialTenantForm,
  tenantToForm,
  validateTenantForm,
  type TenantFormErrors,
  type TenantFormValues,
} from './tenantUtils'

const RELIGION_OPTIONS = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu', 'Lainnya']
const MARITAL_OPTIONS = ['Belum Kawin', 'Kawin', 'Cerai Hidup', 'Cerai Mati']

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</legend>
      {children}
    </fieldset>
  )
}

/** Free-text field with suggestions (datalist) so OCR values like "Islam" or "Kawin" still fit. */
function SuggestInput({
  label,
  value,
  onChange,
  options,
  listId,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  listId: string
}) {
  return (
    <>
      <Input label={label} value={value} onChange={(e) => onChange(e.target.value)} list={listId} autoComplete="off" />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  )
}

/**
 * Create / edit tenant form in a Modal (bottom sheet on phones). Includes the optional "Scan KTP / Paspor"
 * panel (shared DocumentScanner), which prefills fields via OCR and switches the identity type to the
 * detected document; in Supabase mode the scanned photo can be uploaded to the `ktp` bucket.
 */
export function TenantFormModal({
  open,
  onClose,
  tenant,
  onSaved,
  autoScan = false,
}: {
  open: boolean
  onClose: () => void
  /** existing row when editing; null/undefined when creating */
  tenant?: Tenant | null
  onSaved?: (saved: Tenant) => void
  /** open the scanner panel (and the camera) as soon as the form opens: check-in shortcut */
  autoScan?: boolean
}) {
  const { properties, selectedPropertyId, repo, isLocalMode } = useOrg()
  const toast = useToast()
  const insert = useInsert('tenants')
  const update = useUpdate('tenants')
  const invalidate = useInvalidate()

  const [values, setValues] = useState<TenantFormValues>(() => initialTenantForm(selectedPropertyId, properties))
  const [errors, setErrors] = useState<TenantFormErrors>({})
  const [scannerOpen, setScannerOpen] = useState(false)
  /** autoStart for the scanner (check-in deep link); true only until the scanner is first closed */
  const [scanAutoStart, setScanAutoStart] = useState(false)
  const [ktpImage, setKtpImage] = useState<Blob | null>(null)
  const [saveKtpPhoto, setSaveKtpPhoto] = useState(true)
  const [saving, setSaving] = useState(false)

  const isEdit = Boolean(tenant)

  // Reset whenever the modal opens or switches between rows.
  useEffect(() => {
    if (!open) return
    setValues(tenant ? tenantToForm(tenant) : initialTenantForm(selectedPropertyId, properties))
    setErrors({})
    setScannerOpen(autoScan && !tenant)
    setScanAutoStart(autoScan && !tenant)
    setKtpImage(null)
    setSaveKtpPhoto(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenant?.id])

  // The ?scan=1 shortcut opens the file picker only on the scanner's first mount; once the scanner was
  // closed (manual entry, applied, or "Tutup scanner"), reopening it shows the normal panel.
  const closeScanner = () => {
    setScanAutoStart(false)
    setScannerOpen(false)
  }

  const set = <K extends keyof TenantFormValues>(key: K, value: TenantFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const nikDigits = values.nik.replace(/\s+/g, '')
  const nikHint =
    nikDigits === ''
      ? '16 digit, tertera di KTP.'
      : isValidNik(nikDigits)
        ? 'Format NIK valid (16 digit).'
        : `NIK harus 16 digit (saat ini ${nikDigits.length} digit).`
  const isPassport = values.id_type === 'passport'
  const idNumberLabel = isPassport ? 'Nomor paspor' : values.id_type === 'other' ? 'Nomor identitas' : 'NIK'
  const scannerCurrent = formToScanPrefill(values)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validateTenantForm(values)
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      toast.error('Periksa kembali data yang ditandai merah.')
      return
    }
    setSaving(true)
    try {
      const payload = formToTenantPayload(values)
      let saved: Tenant
      if (tenant) {
        const { ktp_image_path: _keep, ...patch } = payload
        saved = await update.mutateAsync({ id: tenant.id, patch })
      } else {
        saved = await insert.mutateAsync(payload)
      }
      if (ktpImage && !isLocalMode && saveKtpPhoto) {
        try {
          const path = await repo.uploadFile('ktp', `${saved.id}.jpg`, ktpImage, 'image/jpeg')
          if (path) {
            saved = await repo.update('tenants', saved.id, { ktp_image_path: path })
            await invalidate('tenants')
          }
        } catch (err) {
          toast.error(`Data penyewa tersimpan, tetapi foto dokumen gagal diunggah: ${err instanceof Error ? err.message : 'kesalahan tak dikenal'}`)
        }
      }
      toast.success(isEdit ? 'Data penyewa diperbarui.' : `Penyewa ${saved.full_name} ditambahkan.`)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan penyewa.')
    } finally {
      setSaving(false)
    }
  }

  const propertyOptions = properties.map((p) => ({ value: p.id, label: p.name }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Ubah Penyewa' : 'Tambah Penyewa'}
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="tenant-form" loading={saving}>
            {isEdit ? 'Simpan perubahan' : 'Simpan'}
          </Button>
        </>
      }
    >
      <form id="tenant-form" onSubmit={submit} className="space-y-6" noValidate>
        {/* Scan KTP / Paspor */}
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant={scannerOpen ? 'ghost' : 'secondary'}
              size="lg"
              className="w-full sm:w-auto"
              icon={scannerOpen ? <X className="h-5 w-5" /> : <ScanLine className="h-5 w-5" />}
              onClick={() => (scannerOpen ? closeScanner() : setScannerOpen(true))}
            >
              {scannerOpen ? 'Tutup scanner' : 'Scan KTP / Paspor'}
            </Button>
            {ktpImage && <span className="text-xs text-emerald-700">Foto dokumen siap</span>}
          </div>
          {scannerOpen && (
            <DocumentScanner
              current={scannerCurrent}
              autoStart={scanAutoStart}
              onCancel={closeScanner}
              onApply={(prefill, image) => {
                setValues((v) => applyScanPrefill(v, prefill))
                setErrors({})
                setKtpImage(image)
                closeScanner()
              }}
            />
          )}
          {ktpImage &&
            (isLocalMode ? (
              <p className="text-xs text-slate-500">Foto hanya tersimpan di mode online.</p>
            ) : (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={saveKtpPhoto} onChange={(e) => setSaveKtpPhoto(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                Simpan foto dokumen
              </label>
            ))}
        </div>

        <Section title="Data diri">
          <Input label="Nama lengkap" required value={values.full_name} onChange={(e) => set('full_name', e.target.value)} error={errors.full_name} autoComplete="name" placeholder={isPassport ? 'Sesuai paspor' : 'Sesuai KTP'} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Nomor HP / WhatsApp"
              type="tel"
              inputMode="tel"
              value={values.phone}
              onChange={(e) => set('phone', e.target.value)}
              error={errors.phone}
              hint="Tidak ada di KTP/paspor, isi manual. Contoh: 0812-3456-7890"
              placeholder="08xx"
            />
            <Select
              label="Jenis kelamin"
              value={values.gender}
              onChange={(e) => set('gender', e.target.value as TenantFormValues['gender'])}
              placeholder="Pilih"
              options={GENDERS.map((g) => ({ value: g, label: GENDER_LABEL[g] }))}
            />
            <Input label="Tempat lahir" value={values.birth_place} onChange={(e) => set('birth_place', e.target.value)} />
            <Input label="Tanggal lahir" type="date" value={values.birth_date} onChange={(e) => set('birth_date', e.target.value)} error={errors.birth_date} max="2100-12-31" />
          </div>
        </Section>

        <Section title="Identitas">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Jenis identitas"
              value={values.id_type}
              onChange={(e) => set('id_type', e.target.value as TenantFormValues['id_type'])}
              options={ID_TYPES.map((t) => ({ value: t, label: ID_TYPE_LABEL[t] }))}
              hint="Paspor untuk penyewa WNA; hasil scan memilihnya otomatis."
            />
            {values.id_type === 'ktp' ? (
              <Input
                label="NIK"
                inputMode="numeric"
                maxLength={20}
                value={values.nik}
                onChange={(e) => set('nik', e.target.value)}
                error={errors.nik}
                hint={nikHint}
                placeholder="16 digit"
              />
            ) : (
              <Input
                label={idNumberLabel}
                autoCapitalize="characters"
                maxLength={30}
                value={values.id_number}
                onChange={(e) => set('id_number', e.target.value)}
                error={errors.id_number}
                hint={isPassport ? 'Tertera di halaman data paspor; hasil scan MRZ diverifikasi digit kontrol.' : 'SIM, KITAS, kartu pelajar, dsb.'}
                placeholder={isPassport ? 'Mis. N1234567' : 'Nomor dokumen'}
              />
            )}
            {isPassport && (
              <Input
                label="Kewarganegaraan"
                autoCapitalize="characters"
                maxLength={40}
                value={values.nationality}
                onChange={(e) => set('nationality', e.target.value)}
                error={errors.nationality}
                hint="Kode 3 huruf dari paspor, mis. AUS, SGP, JPN."
                placeholder="Mis. AUS"
              />
            )}
          </div>
        </Section>

        <Section title="Alamat">
          <Textarea label={isPassport ? 'Alamat (negara asal / tempat tinggal)' : 'Alamat sesuai KTP'} rows={2} value={values.address} onChange={(e) => set('address', e.target.value)} placeholder="Jalan, RT/RW, kelurahan, kecamatan, kota" />
        </Section>

        <Section title="Lainnya">
          <div className="grid gap-3 sm:grid-cols-2">
            <SuggestInput label="Agama" value={values.religion} onChange={(v) => set('religion', v)} options={RELIGION_OPTIONS} listId="tenant-religion-options" />
            <SuggestInput label="Status perkawinan" value={values.marital_status} onChange={(v) => set('marital_status', v)} options={MARITAL_OPTIONS} listId="tenant-marital-options" />
            <Input label="Pekerjaan" value={values.occupation} onChange={(e) => set('occupation', e.target.value)} />
            <Select
              label="Kos"
              required
              value={values.property_id}
              onChange={(e) => set('property_id', e.target.value)}
              placeholder={properties.length === 0 ? 'Belum ada kos' : 'Pilih kos'}
              options={propertyOptions}
              error={errors.property_id}
              hint={selectedPropertyId === 'all' ? 'Kos tempat penyewa terdaftar.' : undefined}
            />
            <Input label="Nama kontak darurat" value={values.emergency_contact_name} onChange={(e) => set('emergency_contact_name', e.target.value)} />
            <Input
              label="Telepon kontak darurat"
              type="tel"
              inputMode="tel"
              value={values.emergency_contact_phone}
              onChange={(e) => set('emergency_contact_phone', e.target.value)}
              error={errors.emergency_contact_phone}
            />
          </div>
          <Textarea label="Catatan" rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Misal: bawa motor, alergi, dsb." />
        </Section>
      </form>
    </Modal>
  )
}
