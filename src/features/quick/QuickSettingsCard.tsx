import { Zap } from 'lucide-react'
import { Card, CardBody, CardHeader } from '../../components/ui'
import { useQuickButtons } from './quickFlag'

/** Pengaturan → Fitur percobaan (SPEC 7.4): the per-device switch for Tombol cepat. */
export function QuickSettingsCard({ isLocalMode }: { isLocalMode: boolean }) {
  const quick = useQuickButtons(isLocalMode)
  return (
    <Card>
      <CardHeader title="Fitur percobaan" subtitle="Hanya di perangkat ini; bisa dimatikan kapan saja" />
      <CardBody className="space-y-2">
        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-1"
            checked={quick.enabled}
            disabled={isLocalMode}
            onChange={(e) => quick.setStored(e.target.checked)}
            aria-label="Tombol cepat"
          />
          <span>
            <span className="flex items-center gap-1.5 font-medium text-slate-900">
              <Zap className="h-4 w-4 text-brand-700" aria-hidden /> Tombol cepat
            </span>
            <span className="block text-xs text-slate-500">
              Papan kamar di Dashboard: ketuk kamar untuk Bayar, Perpanjang, Check-out, atau Check-in cepat (harian).
              {isLocalMode ? ' Selalu aktif di Mode Demo, untuk dicoba dengan data contoh.' : ''}
            </span>
          </span>
        </label>
      </CardBody>
    </Card>
  )
}
