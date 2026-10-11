import { useEffect, useState, type FormEvent } from 'react'
import { Button, Modal, MoneyInput, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import type { Room, Update } from '../../types/db'
import { sortRoomsNatural, zeroToNull } from './roomUtils'

type PriceKey = 'price_monthly' | 'price_weekly' | 'price_daily'

const FIELDS: { key: PriceKey; label: string }[] = [
  { key: 'price_monthly', label: 'Harga bulanan' },
  { key: 'price_weekly', label: 'Harga mingguan' },
  { key: 'price_daily', label: 'Harga harian' },
]

/** Set the monthly / weekly / daily price for several rooms at once. Unchecked prices are left untouched. */
export function BulkPriceModal({
  open,
  rooms,
  onClose,
  onDone,
}: {
  open: boolean
  rooms: Room[]
  onClose: () => void
  onDone: () => void
}) {
  const { repo } = useOrg()
  const invalidate = useInvalidate()
  const toast = useToast()
  const [enabled, setEnabled] = useState<Record<PriceKey, boolean>>({ price_monthly: true, price_weekly: false, price_daily: false })
  const [prices, setPrices] = useState<Record<PriceKey, number>>({ price_monthly: 0, price_weekly: 0, price_daily: 0 })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setEnabled({ price_monthly: true, price_weekly: false, price_daily: false })
      setPrices({ price_monthly: 0, price_weekly: 0, price_daily: 0 })
      setError(null)
    }
  }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const patch: Update<'rooms'> = {}
    for (const f of FIELDS) if (enabled[f.key]) patch[f.key] = zeroToNull(prices[f.key])
    if (Object.keys(patch).length === 0) return setError('Centang minimal satu harga yang ingin diubah.')
    if (rooms.length === 0) return setError('Pilih minimal satu kamar.')
    setError(null)
    setSaving(true)
    try {
      await Promise.all(rooms.map((r) => repo.update('rooms', r.id, patch)))
      await invalidate('rooms')
      toast.success(`Harga ${rooms.length} kamar diperbarui.`)
      onDone()
    } catch (err) {
      await invalidate('rooms')
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui harga.')
    } finally {
      setSaving(false)
    }
  }

  const names = sortRoomsNatural(rooms).map((r) => r.name)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Ubah harga ${rooms.length} kamar`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="bulk-price-form" loading={saving}>
            Terapkan
          </Button>
        </>
      }
    >
      <form id="bulk-price-form" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-slate-600">
          Kamar: <span className="font-medium text-slate-800">{names.join(', ')}</span>
        </p>
        <p className="text-xs text-slate-500">
          Hanya harga yang dicentang akan diubah. Kosongkan (Rp 0) untuk menghapus harga tersebut. Sewa yang sudah berjalan tidak terpengaruh.
        </p>
        <div className="space-y-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="rounded-lg border border-slate-200 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-400"
                  checked={enabled[f.key]}
                  onChange={(e) => setEnabled((s) => ({ ...s, [f.key]: e.target.checked }))}
                />
                {f.label}
              </label>
              {enabled[f.key] && (
                <div className="mt-2">
                  <MoneyInput value={prices[f.key]} onChange={(v) => setPrices((p) => ({ ...p, [f.key]: v }))} min={0} />
                </div>
              )}
            </div>
          ))}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  )
}
