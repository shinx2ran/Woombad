import { useEffect, useState } from 'react'
import { Download, Smartphone } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, useToast } from '../../components/ui'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// ---------------------------------------------------------------- Install (PWA)

export function InstallCard() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const toast = useToast()

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const { outcome } = await installEvent.userChoice
    if (outcome === 'accepted') toast.success('Aplikasi dipasang di layar utama.')
    setInstallEvent(null)
  }

  return (
    <Card>
      <CardHeader title="Pasang di HP" subtitle="Buka seperti aplikasi biasa, tanpa Play Store / App Store" action={<Smartphone className="h-5 w-5 text-slate-400" />} />
      <CardBody className="space-y-3 text-sm text-slate-700">
        {installed ? (
          <Badge tone="success">Sudah terpasang</Badge>
        ) : installEvent ? (
          <Button onClick={install} icon={<Download className="h-4 w-4" />}>
            Pasang sekarang
          </Button>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="font-medium text-slate-900">Android (Chrome)</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-slate-600">
              <li>Buka alamat aplikasi ini di Chrome</li>
              <li>Ketuk menu ⋮ di kanan atas</li>
              <li>Pilih <em>Tambahkan ke layar utama</em> / <em>Instal aplikasi</em></li>
            </ol>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="font-medium text-slate-900">iPhone (Safari)</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-slate-600">
              <li>Buka alamat aplikasi ini di Safari</li>
              <li>Ketuk tombol <em>Bagikan</em> (kotak dengan panah)</li>
              <li>Pilih <em>Tambahkan ke Layar Utama</em></li>
            </ol>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
