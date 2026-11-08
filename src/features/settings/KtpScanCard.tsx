import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { ScanLine, Smartphone, Sparkles } from 'lucide-react'
import { Card, CardBody, CardHeader, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { orgScanEngine, SCAN_ENGINE_DESCRIPTION, SCAN_ENGINE_LABEL, SCAN_ENGINES, type ScanEngine } from '../scanner/engine'

// ---------------------------------------------------------------- Scan KTP (SPEC 7.19, owner/admin)

const TITLE: Record<ScanEngine, string> = { claude: 'Claude (lebih akurat)', tesseract: 'Di HP saja (gratis)' }
const ICON: Record<ScanEngine, typeof Sparkles> = { claude: Sparkles, tesseract: Smartphone }

/**
 * Which reader the document scanner uses by default for every member: Claude through the scan-ktp function (the photo
 * goes to Anthropic, a few cents per scan from the Claude credit) or tesseract.js on the device (free, the photo never
 * leaves the phone, more corrections). Saved on the organisation as soon as it is picked; anyone may still switch for
 * one scan in the scanner panel, and offline the photo is always read on the device (Mode Demo's Claude sample needs no
 * network and stays).
 */
export function KtpScanCard({ isLocalMode }: { isLocalMode: boolean }) {
  const { org, repo } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const saved = orgScanEngine(org.ktp_scan_engine)
  const [saving, setSaving] = useState<ScanEngine | null>(null)

  const choose = async (engine: ScanEngine) => {
    if (engine === saved || saving) return
    setSaving(engine)
    try {
      await repo.raw.update('organizations', org.id, { ktp_scan_engine: engine })
      await qc.invalidateQueries({ queryKey: ['membership'] })
      toast.success(`Scan KTP sekarang memakai ${SCAN_ENGINE_LABEL[engine]}.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card>
      <CardHeader title="Scan KTP" subtitle="Pembaca foto KTP / paspor untuk semua anggota" action={<ScanLine className="h-5 w-5 text-slate-400" />} />
      <CardBody className="space-y-3">
        <div role="radiogroup" aria-label="Pembaca Scan KTP" className="space-y-2">
          {SCAN_ENGINES.map((engine) => {
            const Icon = ICON[engine]
            const selected = engine === saved
            return (
              <label
                key={engine}
                className={clsx(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
                  selected ? 'border-brand-500 bg-brand-50/60' : 'border-slate-200 bg-white hover:bg-slate-50',
                )}
              >
                <input
                  type="radio"
                  name="ktp-scan-engine"
                  value={engine}
                  checked={selected}
                  disabled={saving !== null}
                  onChange={() => void choose(engine)}
                  className="mt-1 h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium text-slate-900">
                    <Icon className="h-4 w-4 text-brand-700" aria-hidden />
                    {TITLE[engine]}
                  </span>
                  <span className="block text-xs text-slate-600">{SCAN_ENGINE_DESCRIPTION[engine]}</span>
                </span>
              </label>
            )
          })}
        </div>
        <p className="text-xs text-slate-500">
          Siapa pun bisa mengganti pembacanya untuk satu scan di panel scan. Tanpa internet, foto selalu dibaca di HP.
          {isLocalMode && ' Mode Demo: Claude menampilkan contoh hasil (juga tanpa internet), foto tidak dikirim.'}
        </p>
      </CardBody>
    </Card>
  )
}
