import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, Input, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { MEMBER_ROLE_LABEL, type MemberRole } from '../../types/db'

// ---------------------------------------------------------------- Organisation

export function OrganizationCard({ orgId, orgName, role, isAdmin, isLocalMode }: { orgId: string; orgName: string; role: MemberRole; isAdmin: boolean; isLocalMode: boolean }) {
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
