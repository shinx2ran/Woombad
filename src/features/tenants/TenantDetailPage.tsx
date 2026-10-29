import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { BackLink } from '../../app/BackLink'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, MessageCircle, Pencil, Plus, Trash2, UserX } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  LeaseStatusBadge,
  LoadingState,
  PageHeader,
  useToast,
  type Column,
} from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate, useRemove, useRow, useTable } from '../../hooks/useTable'
import { useRestoreDeleted } from '../settings/audit/useRestoreDeleted'
import { formatDate, formatRupiah, todayISO, whatsappLink } from '../../lib/format'
import { GENDER_LABEL, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL, PERIOD_TYPE_LABEL, type Lease, type Payment } from '../../types/db'
import { TenantFormModal } from './TenantFormModal'
import { currentStayFor, describeIdentity, describeRoom, initials, leaseStayText, leasesOfTenant, paymentsOfLeases } from './tenantUtils'

function InfoList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900">{it.value ?? <span className="text-slate-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

function dash(value: string | null | undefined): ReactNode {
  return value && value.trim() ? value : null
}

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const undo = useRestoreDeleted()
  const { properties, role, repo } = useOrg()
  const tenant = useRow('tenants', id)
  const leases = useTable('leases')
  const rooms = useTable('rooms')
  const payments = useTable('payments')
  const remove = useRemove('tenants')
  const invalidate = useInvalidate()
  // ?isi=hp (a missing-phone WhatsApp button): open the form at Nomor HP right away
  const [searchParams, setSearchParams] = useSearchParams()
  const askPhone = searchParams.get('isi') === 'hp'
  const [editOpen, setEditOpen] = useState(askPhone)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const closeEdit = () => {
    setEditOpen(false)
    if (askPhone) {
      const next = new URLSearchParams(searchParams)
      next.delete('isi')
      setSearchParams(next, { replace: true })
    }
  }

  const today = todayISO()
  const canDelete = role === 'owner' || role === 'admin'

  const myLeases = useMemo(() => (tenant.data ? leasesOfTenant(tenant.data.id, leases.data ?? []) : []), [tenant.data, leases.data])
  const myPayments = useMemo(() => paymentsOfLeases(myLeases.map((l) => l.id), payments.data ?? []), [myLeases, payments.data])
  const stay = tenant.data ? currentStayFor(tenant.data.id, leases.data ?? [], today) : null

  const ktpUrl = useQuery({
    queryKey: ['file-url', 'ktp', tenant.data?.ktp_image_path ?? null],
    queryFn: () => repo.getFileUrl('ktp', tenant.data?.ktp_image_path),
    enabled: Boolean(tenant.data?.ktp_image_path),
    staleTime: 5 * 60 * 1000,
  })

  if (tenant.isPending || leases.isPending || rooms.isPending || payments.isPending) return <LoadingState label="Memuat penyewa…" />
  if (tenant.isError) return <ErrorState error={tenant.error} />
  if (!tenant.data) {
    return (
      <EmptyState
        icon={<UserX className="h-10 w-10" />}
        title="Penyewa tidak ditemukan"
        description="Data mungkin sudah dihapus."
        action={
          <Button variant="outline" onClick={() => navigate('/penyewa')}>
            Kembali ke daftar
          </Button>
        }
      />
    )
  }

  const t = tenant.data
  const roomList = rooms.data ?? []
  const kos = t.property_id ? properties.find((p) => p.id === t.property_id) : null
  const wa = whatsappLink(t.phone, `Halo ${t.full_name}, `)
  const identity = describeIdentity(t)

  const confirmDelete = async () => {
    try {
      // Row first, photo second (SPEC 6.4): a refused delete (tenant still has leases) must keep the KTP photo.
      // remove() throws when nothing was deleted, so the file is only touched once the row is gone.
      await remove.mutateAsync(t.id)
      let photoKept = false
      if (t.ktp_image_path) {
        try {
          await repo.removeFile('ktp', t.ktp_image_path)
        } catch {
          photoKept = true
        }
      }
      if (photoKept) toast.error(`Penyewa ${t.full_name} dihapus, tetapi foto dokumen gagal dihapus dari penyimpanan.`)
      else undo.offerUndo('tenants', t, `Penyewa ${t.full_name}`)
      navigate('/penyewa', { replace: true })
    } catch (err) {
      // refresh: a tenant already deleted on another device then shows as not found instead of failing again
      void invalidate('tenants')
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus penyewa.')
      setDeleteOpen(false)
    }
  }

  const leaseColumns: Column<Lease>[] = [
    {
      key: 'room',
      header: 'Kamar',
      render: (l) => (
        <div>
          <p className="font-medium text-slate-900">{describeRoom(l, roomList, properties)}</p>
          <p className="text-xs text-slate-500 md:hidden">{leaseStayText(l)}</p>
        </div>
      ),
    },
    { key: 'period', header: 'Periode', hideOnMobile: true, className: 'whitespace-nowrap', render: (l) => `${PERIOD_TYPE_LABEL[l.period_type]} · ${formatRupiah(l.price_per_period)}` },
    { key: 'dates', header: 'Tanggal', hideOnMobile: true, className: 'whitespace-nowrap', render: (l) => leaseStayText(l) },
    { key: 'status', header: 'Status', render: (l) => <LeaseStatusBadge status={l.status} /> },
    {
      key: 'link',
      header: '',
      align: 'right',
      render: (l) => (
        <Link to={`/sewa/${l.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          Detail <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ),
    },
  ]

  const roomOfPayment = (p: Payment): string | null => {
    const lease = myLeases.find((l) => l.id === p.lease_id)
    return lease ? describeRoom(lease, roomList, properties) : null
  }

  const paymentColumns: Column<Payment>[] = [
    { key: 'date', header: 'Tanggal', className: 'whitespace-nowrap', render: (p) => formatDate(p.paid_at) },
    {
      key: 'kind',
      header: 'Jenis',
      render: (p) => (
        <div>
          <p>{PAYMENT_KIND_LABEL[p.kind]}</p>
          <p className="text-xs text-slate-500">
            {PAYMENT_METHOD_LABEL[p.method]}
            <span className="md:hidden">{roomOfPayment(p) ? ` · ${roomOfPayment(p)}` : ''}</span>
          </p>
        </div>
      ),
    },
    { key: 'room', header: 'Kamar', hideOnMobile: true, render: (p) => roomOfPayment(p) ?? '—' },
    { key: 'notes', header: 'Catatan', hideOnMobile: true, render: (p) => <span className="text-slate-500">{p.notes ?? '—'}</span> },
    { key: 'amount', header: 'Jumlah', align: 'right', className: 'whitespace-nowrap', render: (p) => <span className="font-medium">{formatRupiah(p.amount)}</span> },
  ]

  return (
    <>
      <BackLink to="/penyewa" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Semua penyewa
      </BackLink>
      <PageHeader
        title={t.full_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {kos && <span>{kos.name}</span>}
            {stay ? (
              <Badge tone={stay.kind === 'occupied' ? 'success' : 'info'}>
                {stay.kind === 'reserved' ? 'Dipesan: ' : 'Menyewa: '}
                {describeRoom(stay.lease, roomList, properties)}
              </Badge>
            ) : (
              <Badge tone="neutral">Tidak menyewa</Badge>
            )}
          </span>
        }
        actions={
          <>
            {wa && (
              <Button
                variant="secondary"
                icon={<MessageCircle className="h-4 w-4" />}
                onClick={() => window.open(wa, '_blank', 'noopener,noreferrer')}
              >
                WhatsApp
              </Button>
            )}
            <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
              Ubah
            </Button>
            {canDelete && (
              <Button variant="outline" icon={<Trash2 className="h-4 w-4" />} className="text-red-700 hover:bg-red-50" onClick={() => setDeleteOpen(true)}>
                Hapus
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader
              title="Data diri"
              action={
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800" aria-hidden>
                  {initials(t.full_name)}
                </span>
              }
            />
            <CardBody>
              <InfoList
                items={[
                  {
                    label: 'Nomor HP',
                    value: t.phone ? (
                      <a href={wa ?? `tel:${t.phone}`} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                        {t.phone}
                      </a>
                    ) : (
                      <span className="italic text-slate-400">Belum diisi, tidak ada di KTP/paspor</span>
                    ),
                  },
                  {
                    label: `Identitas · ${identity.label}`,
                    value: identity.number ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="tabular-nums">{identity.number}</span>
                        {t.id_type === 'passport' && t.nationality && <Badge tone="info">{t.nationality}</Badge>}
                      </span>
                    ) : null,
                  },
                  { label: 'Jenis kelamin', value: t.gender ? GENDER_LABEL[t.gender] : null },
                  {
                    label: 'Tempat, tanggal lahir',
                    value: [t.birth_place, t.birth_date ? formatDate(t.birth_date) : null].filter(Boolean).join(', ') || null,
                  },
                  { label: 'Agama', value: dash(t.religion) },
                  { label: 'Status perkawinan', value: dash(t.marital_status) },
                  { label: 'Pekerjaan', value: dash(t.occupation) },
                  { label: 'Kos terdaftar', value: kos?.name ?? null },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Alamat & kontak darurat" />
            <CardBody>
              <InfoList
                items={[
                  { label: 'Alamat', value: dash(t.address) },
                  { label: 'Kontak darurat', value: dash(t.emergency_contact_name) },
                  {
                    label: 'Telepon darurat',
                    value: t.emergency_contact_phone ? (
                      <a href={`tel:${t.emergency_contact_phone}`} className="text-brand-700 hover:underline">
                        {t.emergency_contact_phone}
                      </a>
                    ) : null,
                  },
                  { label: 'Catatan', value: dash(t.notes) },
                ]}
              />
            </CardBody>
          </Card>

          {t.ktp_image_path && (
            <Card>
              <CardHeader title={t.id_type === 'passport' ? 'Foto paspor' : 'Foto KTP'} />
              <CardBody>
                {ktpUrl.isPending ? (
                  <LoadingState label="Memuat foto…" />
                ) : ktpUrl.data ? (
                  <a href={ktpUrl.data} target="_blank" rel="noopener noreferrer">
                    <img src={ktpUrl.data} alt={`Foto ${identity.label} ${t.full_name}`} className="w-full rounded-lg border border-slate-200 object-contain" />
                  </a>
                ) : (
                  <p className="text-sm text-slate-500">Foto tidak bisa dimuat.</p>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Riwayat sewa"
              subtitle={`${myLeases.length} sewa`}
              action={
                !stay && (
                  <Link to={`/sewa/baru?tenant=${t.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-sm font-medium text-white hover:bg-brand-800">
                    <Plus className="h-4 w-4" aria-hidden /> Sewa baru
                  </Link>
                )
              }
            />
            <CardBody className="px-0 py-0">
              {myLeases.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-500">Penyewa ini belum pernah menyewa kamar.</p>
              ) : (
                <div className="[&>div]:rounded-none [&>div]:border-0">
                  <DataTable columns={leaseColumns} rows={myLeases} rowKey={(l) => l.id} onRowClick={(l) => navigate(`/sewa/${l.id}`)} />
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Riwayat pembayaran" subtitle={`${myPayments.length} pembayaran · total ${formatRupiah(myPayments.reduce((s, p) => s + p.amount, 0))}`} />
            <CardBody className="px-0 py-0">
              {myPayments.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-500">Belum ada pembayaran tercatat.</p>
              ) : (
                <div className="[&>div]:rounded-none [&>div]:border-0">
                  <DataTable columns={paymentColumns} rows={myPayments} rowKey={(p) => p.id} />
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <TenantFormModal open={editOpen} onClose={closeEdit} tenant={t} focusPhone={askPhone} />

      {myLeases.length === 0 ? (
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          onConfirm={confirmDelete}
          loading={remove.isPending}
          title="Hapus penyewa?"
          message={
            <>
              Data <strong>{t.full_name}</strong> akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
            </>
          }
        />
      ) : (
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => setDeleteOpen(false)}
          title="Tidak bisa dihapus"
          danger={false}
          confirmLabel="Mengerti"
          message={
            <>
              <strong>{t.full_name}</strong> memiliki {myLeases.length} riwayat sewa, sehingga datanya tidak bisa dihapus agar riwayat tagihan dan
              pembayaran tetap utuh. Jika penyewa sudah pindah, lakukan <em>checkout</em> pada sewanya; data penyewa tetap tersimpan sebagai arsip.
            </>
          }
        />
      )}
    </>
  )
}
