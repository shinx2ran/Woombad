import { Link } from 'react-router'
import { clsx } from 'clsx'
import { ArrowRight, Building2, CircleCheck, DoorOpen, FilePlus2, Upload } from 'lucide-react'
import { Card, CardBody } from '../../components/ui'

interface Step {
  title: string
  description: string
  to: string
  cta: string
  icon: typeof Building2
  done: boolean
}

/** Opens "Impor dari Mode Demo" in Pengaturan → Data (OnlineBackupSection). */
const DEMO_IMPORT_PATH = '/pengaturan?impor=demo'

/**
 * Friendly onboarding shown while the organisation has no rooms yet. Kos and rooms are added by owners/admins (SPEC 6.2).
 * Online, an owner/admin without any kos is first offered the move from Mode Demo: the import matches rows by id, so
 * a kos typed in again by hand would end up twice.
 */
export function FirstRunChecklist({
  totals,
  isAdmin,
  isOnline = false,
}: {
  totals: { properties: number; rooms: number; leases: number }
  isAdmin: boolean
  isOnline?: boolean
}) {
  const importStep: Step | null =
    isOnline && isAdmin && totals.properties === 0
      ? {
          title: 'Punya data dari Mode Demo? Pindahkan dulu',
          description: 'Impor kos, kamar, penyewa, dan transaksi dari Mode Demo sebelum mengisi data baru. Belum pernah memakai Mode Demo? Lewati langkah ini.',
          to: DEMO_IMPORT_PATH,
          cta: 'Impor dari Mode Demo',
          icon: Upload,
          done: false,
        }
      : null
  const steps: Step[] = [
    ...(importStep ? [importStep] : []),
    {
      title: 'Tambah kos',
      description: 'Daftarkan bangunan kos Anda beserta info rekening untuk pengingat.',
      to: '/kos',
      cta: 'Buka Kos & Kamar',
      icon: Building2,
      done: totals.properties > 0,
    },
    {
      title: 'Tambah kamar',
      description: 'Masukkan nama kamar dan harga sewa harian, mingguan, atau bulanan.',
      to: '/kos',
      cta: 'Tambah kamar',
      icon: DoorOpen,
      done: totals.rooms > 0,
    },
    {
      title: 'Buat sewa',
      description: 'Pilih kamar dan penyewa; tagihan pertama dibuat otomatis.',
      to: '/sewa/baru',
      cta: 'Buat sewa',
      icon: FilePlus2,
      done: totals.leases > 0,
    },
  ]
  const nextIndex = steps.findIndex((s) => !s.done)

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-brand-700 to-brand-900 px-5 py-6 text-white">
        <h2 className="text-lg font-semibold">Selamat datang di Woombad 👋</h2>
        <p className="mt-1 text-sm text-brand-100">
          {isAdmin
            ? `${importStep ? 'Beberapa' : 'Tiga'} langkah singkat dan dashboard ini akan mulai bekerja untuk Anda.`
            : 'Kos dan kamar ditambahkan oleh pemilik atau admin. Setelah itu Anda bisa mencatat sewa di sini.'}
        </p>
      </div>
      <CardBody className="p-0">
        <ol className="divide-y divide-slate-100">
          {steps.map((step, i) => {
            const isNext = i === nextIndex
            return (
              <li key={step.title} className={clsx('flex items-start gap-3 px-4 py-4', isNext && 'bg-brand-50/60')}>
                <span
                  className={clsx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                    step.done ? 'bg-emerald-100 text-emerald-700' : isNext ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {step.done ? <CircleCheck className="h-5 w-5" aria-hidden /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={clsx('text-sm font-semibold', step.done ? 'text-slate-500 line-through' : 'text-slate-900')}>{step.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{step.description}</p>
                  {!step.done && (isAdmin || step.to !== '/kos') && (
                    <Link
                      to={step.to}
                      className={clsx(
                        'mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium',
                        isNext ? 'bg-brand-700 text-white hover:bg-brand-800' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      {step.cta}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </CardBody>
    </Card>
  )
}
