import { PageHeader } from '../../components/ui'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../hooks/useOrg'
import { OrganizationCard } from './OrganizationCard'
import { MembersCard } from './MembersCard'
import { DataCard } from './DataCard'
import { AuditCard } from './AuditCard'
import { InstallCard } from './InstallCard'
import { AboutCard } from './AboutCard'
import { KosShortcutCard } from './KosShortcutCard'

export function SettingsPage() {
  const { org, role, repo, isLocalMode } = useOrg()
  const { auth, session } = useAuth()
  const isAdmin = role === 'owner' || role === 'admin'

  return (
    <>
      <PageHeader title="Pengaturan" subtitle={isLocalMode ? 'Mode Demo: data hanya di perangkat ini' : 'Mode Online: data tersinkron lewat Supabase'} />
      <div className="grid gap-4 lg:grid-cols-2">
        <KosShortcutCard isAdmin={isAdmin} />
        <OrganizationCard orgId={org.id} orgName={org.name} role={role} isAdmin={isAdmin} isLocalMode={isLocalMode} />
        <MembersCard isAdmin={isAdmin} currentUserId={session?.user.id ?? ''} />
        <DataCard isLocalMode={isLocalMode} isAdmin={isAdmin} />
        <InstallCard />
        <AboutCard onSignOut={() => auth.signOut()} email={session?.user.email ?? null} repoMode={repo.mode} />
        {isAdmin && <AuditCard isLocalMode={isLocalMode} />}
      </div>
    </>
  )
}
