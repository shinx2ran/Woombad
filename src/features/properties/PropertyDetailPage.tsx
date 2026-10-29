import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { BackLink } from '../../app/BackLink'
import { clsx } from 'clsx'
import { ArrowLeft, Building2, MapPin, Pencil, Wallet } from 'lucide-react'
import { Button, EmptyState, PageHeader } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useKosLogo } from '../invoices/useKosLogo'
import { PropertyFormModal } from './PropertyFormModal'
import { RoomsTab } from './RoomsTab'
import { AddonsTab } from './AddonsTab'

type Tab = 'kamar' | 'addon'

export function PropertyDetailPage() {
  const { propertyId = '' } = useParams()
  const { properties, role } = useOrg()
  const isAdmin = role === 'owner' || role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const [editOpen, setEditOpen] = useState(false)
  const property = properties.find((p) => p.id === propertyId) ?? null
  const { logoUrl } = useKosLogo(property)
  const tab: Tab = searchParams.get('tab') === 'addon' ? 'addon' : 'kamar'

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'kamar') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  if (!property) {
    return (
      <>
        <PageHeader title="Kos tidak ditemukan" />
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title="Kos tidak ditemukan"
          description="Kos ini mungkin sudah dihapus atau tautannya salah."
          action={
            <Link to="/kos">
              <Button variant="outline" icon={<ArrowLeft className="h-4 w-4" />}>
                Kembali ke daftar kos
              </Button>
            </Link>
          }
        />
      </>
    )
  }

  return (
    <>
      <BackLink to="/kos" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Semua kos
      </BackLink>
      {/* the kos logo (SPEC 7.2) sits beside the title block */}
      <div className="flex items-start gap-3">
        {logoUrl && <img src={logoUrl} alt="Logo kos" className="mt-0.5 h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-0.5" />}
        <div className="min-w-0 flex-1">
          <PageHeader
            title={property.name}
            subtitle={
              <span className="flex flex-col gap-0.5">
                <span className="inline-flex items-start gap-1">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {property.address ?? 'Alamat belum diisi'}
                </span>
                {property.payment_info && (
                  <span className="inline-flex items-start gap-1">
                    <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {property.payment_info}
                  </span>
                )}
              </span>
            }
            actions={
              isAdmin ? (
                <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
                  Ubah kos
                </Button>
              ) : undefined
            }
          />
        </div>
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200" role="tablist" aria-label="Bagian kos">
        {(
          [
            { id: 'kamar', label: 'Kamar' },
            { id: 'addon', label: 'Add-on' },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t.id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'kamar' ? <RoomsTab property={property} isAdmin={isAdmin} /> : <AddonsTab property={property} isAdmin={isAdmin} />}

      {isAdmin && <PropertyFormModal open={editOpen} property={property} onClose={() => setEditOpen(false)} />}
    </>
  )
}
