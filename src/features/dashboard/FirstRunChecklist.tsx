import { Link } from 'react-router'
import { clsx } from 'clsx'
import { ArrowRight, Building2, CircleCheck, DoorOpen, FilePlus2 } from 'lucide-react'
import { Card, CardBody } from '../../components/ui'

interface Step {
  title: string
  description: string
  to: string
  cta: string
  icon: typeof Building2
  done: boolean
}

/** Friendly onboarding shown while the organisation has no rooms yet. */
export function FirstRunChecklist({ totals }: { totals: { properties: number; rooms: number; leases: number } }) {
  const steps: Step[] = [
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
        <p className="mt-1 text-sm text-brand-100">Tiga langkah singkat dan dashboard ini akan mulai bekerja untuk Anda.</p>
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
                  {!step.done && (
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
