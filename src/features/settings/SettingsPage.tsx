import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Download, LogOut, RefreshCw, Smartphone, Trash2, Upload, UserPlus, Users, Info } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  useToast,
} from '../../components/ui'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate, useRemove, useTable } from '../../hooks/useTable'
import { LocalRepo, type LocalDb } from '../../lib/repo/localRepo'
import { TABLE_NAMES, MEMBER_ROLE_LABEL, type MemberRole } from '../../types/db'
import { formatDate } from '../../lib/format'

const APP_VERSION = 'v0.1'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function SettingsPage() {
  const { org, role, repo, isLocalMode } = useOrg()
  const { auth, session } = useAuth()
  const isAdmin = role === 'owner' || role === 'admin'

  return (
    <>
      <PageHeader title="Pengaturan" subtitle={isLocalMode ? 'Mode Demo: data hanya di perangkat ini' : 'Mode Online: data tersinkron lewat Supabase'} />
      <div className="grid gap-4 lg:grid-cols-2">
        <OrganizationCard orgId={org.id} orgName={org.name} role={role} isAdmin={isAdmin} isLocalMode={isLocalMode} />
        <MembersCard isAdmin={isAdmin} currentUserId={session?.user.id ?? ''} />
        <DataCard isLocalMode={isLocalMode} isAdmin={isAdmin} />
        <InstallCard />
        <AboutCard onSignOut={() => auth.signOut()} email={session?.user.email ?? null} repoMode={repo.mode} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Organisation

function OrganizationCard({ orgId, orgName, role, isAdmin, isLocalMode }: { orgId: string; orgName: string; role: MemberRole; isAdmin: boolean; isLocalMode: boolean }) {
  const { repo } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(orgName)
  const [saving, setSaving] = useState(false)

  useEffect(() => setName(orgName), [orgName])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return toast.error('Nama organisasi tidak boleh kosong.')
    setSaving(true)
    try {
      await repo.raw.update('organizations', orgId, { name: trimmed })
      await qc.invalidateQueries({ queryKey: ['membership'] })
      toast.success('Nama organisasi disimpan.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Organisasi" subtitle="Satu organisasi dapat memiliki banyak kos" action={<Building2 className="h-5 w-5 text-slate-400" />} />
      <CardBody>
        <form onSubmit={save} className="space-y-3">
          <Input label="Nama organisasi" value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} maxLength={80} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Peran Anda:</span>
            <Badge tone="brand">{MEMBER_ROLE_LABEL[role]}</Badge>
            <span className="text-slate-500">Mode:</span>
            <Badge tone={isLocalMode ? 'warning' : 'success'}>{isLocalMode ? 'Demo (lokal)' : 'Online'}</Badge>
          </div>
          {isAdmin && (
            <Button type="submit" loading={saving} disabled={name.trim() === orgName}>
              Simpan
            </Button>
          )}
        </form>
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------- Members

function MembersCard({ isAdmin, currentUserId }: { isAdmin: boolean; currentUserId: string }) {
  const { repo } = useOrg()
  const toast = useToast()
  const invalidate = useInvalidate()
  const members = useTable('organization_members', { orderBy: { column: 'created_at', ascending: true } })
  const invitations = useTable('invitations', { where: { accepted_at: null }, orderBy: { column: 'created_at', ascending: true } })
  const removeInvitation = useRemove('invitations')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'staff'>('admin')
  const [inviting, setInviting] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; label: string } | null>(null)
  const [removing, setRemoving] = useState(false)

  const invite = async (e: FormEvent) => {
    e.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return toast.error('Format email tidak valid.')
    setInviting(true)
    try {
      const result = await repo.addMemberByEmail(normalized, inviteRole)
      toast.success(result.message)
      await invalidate('organization_members', 'invitations')
      setInviteOpen(false)
      setEmail('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengundang.')
    } finally {
      setInviting(false)
    }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      await repo.removeMember(removeTarget.userId)
      toast.success('Anggota dihapus.')
      await invalidate('organization_members')
      setRemoveTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus anggota.')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Anggota"
        subtitle="Siapa saja yang bisa masuk ke organisasi ini"
        action={
          isAdmin ? (
            <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
              Undang
            </Button>
          ) : (
            <Users className="h-5 w-5 text-slate-400" />
          )
        }
      />
      <CardBody className="space-y-3">
        {members.isPending ? (
          <LoadingState />
        ) : (
          <ul className="divide-y divide-slate-100">
            {(members.data ?? []).map((m) => {
              const isSelf = m.user_id === currentUserId
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {m.email ?? m.user_id}
                      {isSelf && <span className="ml-1 text-xs text-slate-500">(Anda)</span>}
                    </p>
                    <p className="text-xs text-slate-500">Bergabung {formatDate(m.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={m.role === 'owner' ? 'brand' : m.role === 'admin' ? 'info' : 'neutral'}>{MEMBER_ROLE_LABEL[m.role]}</Badge>
                    {isAdmin && !isSelf && (
                      <button
                        type="button"
                        onClick={() => setRemoveTarget({ userId: m.user_id, label: m.email ?? m.user_id })}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Hapus ${m.email ?? 'anggota'}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {(invitations.data?.length ?? 0) > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Undangan menunggu</p>
            <ul className="divide-y divide-slate-100">
              {invitations.data!.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-slate-800">{inv.email}</p>
                    <p className="text-xs text-slate-500">Belum mendaftar · {MEMBER_ROLE_LABEL[inv.role]}</p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() =>
                        removeInvitation.mutate(inv.id, {
                          onSuccess: () => toast.success('Undangan dibatalkan.'),
                          onError: (err) => toast.error(err instanceof Error ? err.message : 'Gagal membatalkan undangan.'),
                        })
                      }
                      className="text-xs text-slate-500 hover:text-red-600"
                    >
                      Batalkan
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-slate-500">
          Orang yang diundang cukup <strong>Buat akun</strong> dengan email yang sama, lalu otomatis masuk ke organisasi ini.
          Peran <strong>Admin</strong> dapat mengelola semua data; <strong>Staf</strong> dapat mencatat sewa, pembayaran dan pengeluaran
          tetapi tidak melihat Laporan dan tidak dapat menghapus data keuangan.
        </p>
      </CardBody>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Undang anggota"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Batal
            </Button>
            <Button type="submit" form="invite-form" loading={inviting}>
              Kirim undangan
            </Button>
          </>
        }
      >
        <form id="invite-form" onSubmit={invite} className="space-y-3">
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="nama@email.com" autoFocus />
          <Select
            label="Peran"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'admin' | 'staff')}
            options={[
              { value: 'admin', label: 'Admin – akses penuh (cocok untuk pasangan)' },
              { value: 'staff', label: 'Staf – catat transaksi, tanpa laporan & hapus' },
            ]}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
        title="Hapus anggota?"
        message={
          <>
            <strong>{removeTarget?.label}</strong> tidak akan bisa mengakses organisasi ini lagi.
          </>
        }
        loading={removing}
      />
    </Card>
  )
}

// ---------------------------------------------------------------- Data (demo backup / reset)

function isLocalDb(value: unknown): value is LocalDb {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return TABLE_NAMES.every((t) => Array.isArray(obj[t]))
}

function DataCard({ isLocalMode, isAdmin }: { isLocalMode: boolean; isAdmin: boolean }) {
  const { repo, resetDemoData } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<LocalDb | null>(null)

  const exportJson = () => {
    if (!(repo.raw instanceof LocalRepo)) return
    const snapshot = repo.raw.snapshot()
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `woombad-cadangan-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Cadangan diunduh.')
  }

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isLocalDb(parsed)) throw new Error('Format file tidak dikenali.')
      setPendingImport(parsed)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'File tidak valid.')
    }
  }

  const confirmImport = async () => {
    if (!pendingImport || !(repo.raw instanceof LocalRepo)) return
    repo.raw.replaceAll(pendingImport)
    await qc.invalidateQueries()
    setPendingImport(null)
    toast.success('Cadangan dipulihkan.')
  }

  const confirmReset = async () => {
    setResetting(true)
    try {
      await resetDemoData()
      toast.success('Data demo di-reset.')
      setResetOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mereset data demo.')
    } finally {
      setResetting(false)
    }
  }

  const supabaseHost = (() => {
    try {
      const url = import.meta.env.VITE_SUPABASE_URL
      return url ? new URL(url).host : null
    } catch {
      return null
    }
  })()

  return (
    <Card>
      <CardHeader title="Data" subtitle={isLocalMode ? 'Cadangkan atau reset data demo' : 'Penyimpanan online'} action={<RefreshCw className="h-5 w-5 text-slate-400" />} />
      <CardBody className="space-y-3">
        {isLocalMode ? (
          <>
            <p className="text-sm text-slate-600">
              Dalam Mode Demo semua data disimpan di browser ini. Menghapus data situs atau mengganti perangkat akan
              menghilangkannya. Unduh cadangan secara berkala, atau aktifkan mode online (lihat <code>README.md</code>).
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportJson}>
                Unduh cadangan JSON
              </Button>
              <Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
                Pulihkan dari JSON
              </Button>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onPickFile} />
              {isAdmin && (
                <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setResetOpen(true)}>
                  Reset data demo
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2 text-sm text-slate-600">
            <p>
              Data tersimpan di proyek Supabase{supabaseHost ? <> <code className="rounded bg-slate-100 px-1">{supabaseHost}</code></> : null}. Semua
              anggota melihat data yang sama secara langsung.
            </p>
            <p>Cadangan: Supabase menyediakan ekspor database di Dashboard → Database → Backups. Ekspor laporan ke Excel ada di menu Laporan.</p>
          </div>
        )}
      </CardBody>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={confirmReset}
        title="Reset data demo?"
        message="Semua data di perangkat ini akan diganti dengan data contoh. Tindakan ini tidak dapat dibatalkan."
        confirmLabel="Reset"
        loading={resetting}
      />
      <ConfirmDialog
        open={pendingImport !== null}
        onClose={() => setPendingImport(null)}
        onConfirm={confirmImport}
        title="Pulihkan cadangan?"
        message="Data saat ini akan diganti seluruhnya dengan isi file cadangan."
        confirmLabel="Pulihkan"
        danger={false}
      />
    </Card>
  )
}

// ---------------------------------------------------------------- Install (PWA)

function InstallCard() {
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

// ---------------------------------------------------------------- About

function AboutCard({ onSignOut, email, repoMode }: { onSignOut: () => Promise<void>; email: string | null; repoMode: 'supabase' | 'local' }) {
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const signOut = async () => {
    setSigningOut(true)
    await onSignOut()
    navigate('/login', { replace: true })
  }
  return (
    <Card>
      <CardHeader title="Tentang" action={<Info className="h-5 w-5 text-slate-400" />} />
      <CardBody className="space-y-3 text-sm text-slate-700">
        <p>
          <strong>Woombad {APP_VERSION}</strong> — aplikasi manajemen kos gratis: penyewa, sewa, tagihan, pembayaran, pengeluaran, dan
          laporan keuangan. Backend {repoMode === 'supabase' ? 'Supabase' : 'lokal (demo)'}.
        </p>
        <p className="text-slate-500">Masuk sebagai {email ?? '-'}</p>
        <Button variant="outline" icon={<LogOut className="h-4 w-4" />} onClick={signOut} loading={signingOut}>
          Keluar
        </Button>
      </CardBody>
    </Card>
  )
}
