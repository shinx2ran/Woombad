import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { MemberRole, Organization, Property } from '../types/db'
import { getRepo, bindOrg, LocalRepo, NotMemberError, type OrgRepo } from '../lib/repo'
import { JoinOrganization } from '../features/auth/JoinOrganization'
import { buildDemoDb, DEMO_ORG_ID } from '../lib/repo/demoSeed'
import { useAuth } from './useAuth'
import { ErrorScreen } from '../components/ErrorBoundary'

const SELECTED_PROPERTY_KEY = 'woombad.selectedProperty'

/** "all" means every property in the organisation. */
export type PropertySelection = 'all' | string

interface OrgContextValue {
  org: Organization
  role: MemberRole
  repo: OrgRepo
  properties: Property[]
  /** currently selected property filter for list pages / dashboard */
  selectedPropertyId: PropertySelection
  setSelectedPropertyId: (id: PropertySelection) => void
  /** convenience: ids to filter by (all property ids when "all") — for list pages */
  propertyFilterIds: string[]
  /**
   * For src/domain finance/export/occupancy functions: `undefined` when "all" (include shared rows with
   * property_id null), otherwise the single selected id. Never pass `propertyFilterIds` to those functions.
   */
  financePropertyIds: string[] | undefined
  refreshProperties: () => Promise<void>
  /** demo mode only: wipe and reseed demo data */
  resetDemoData: () => Promise<void>
  isLocalMode: boolean
}

const OrgContext = createContext<OrgContextValue | null>(null)

async function loadMembership(userId: string, email: string | null) {
  const repo = getRepo()
  if (repo.mode === 'local') {
    const local = repo as LocalRepo
    if (local.isEmpty()) local.replaceAll(buildDemoDb())
  }
  // Membership is resolved server-side (ensure_membership RPC): the client never creates organisations
  // and never picks an organisation itself, which closes the "invite the owner into my org" attack.
  const orgId = await repo.ensureMembership({ id: userId, email })
  const [org, members] = await Promise.all([
    repo.get('organizations', orgId),
    repo.list('organization_members', { where: { org_id: orgId, user_id: userId } }),
  ])
  if (!org) throw new Error('Organisasi tidak ditemukan.')
  return { org, role: members[0]?.role ?? ('staff' as MemberRole) }
}

export function OrgProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const userId = session?.user.id ?? ''
  const email = session?.user.email ?? null

  const membership = useQuery({
    queryKey: ['membership', userId],
    queryFn: () => loadMembership(userId, email),
    // a non-member is a normal state (join screen), not a transient failure
    retry: (count, err) => !(err instanceof NotMemberError) && count < 1,
    enabled: Boolean(userId),
    staleTime: Infinity,
  })

  const orgId = membership.data?.org.id
  const repo = useMemo(() => (orgId ? bindOrg(getRepo(), orgId) : null), [orgId])

  const propertiesQuery = useQuery({
    queryKey: ['org', orgId, 'properties'],
    queryFn: () => repo!.list('properties', { orderBy: { column: 'name', ascending: true } }),
    enabled: Boolean(repo),
  })

  const [selectedPropertyId, setSelected] = useState<PropertySelection>(() => {
    try {
      return localStorage.getItem(SELECTED_PROPERTY_KEY) ?? 'all'
    } catch {
      return 'all'
    }
  })
  const setSelectedPropertyId = useCallback((id: PropertySelection) => {
    setSelected(id)
    try {
      localStorage.setItem(SELECTED_PROPERTY_KEY, id)
    } catch {
      /* ignore */
    }
  }, [])

  const properties = propertiesQuery.data ?? []
  // Reset selection if the stored property no longer exists.
  useEffect(() => {
    if (selectedPropertyId !== 'all' && propertiesQuery.isSuccess && !properties.some((p) => p.id === selectedPropertyId)) {
      setSelectedPropertyId('all')
    }
  }, [selectedPropertyId, properties, propertiesQuery.isSuccess, setSelectedPropertyId])

  const value = useMemo<OrgContextValue | null>(() => {
    if (!membership.data || !repo) return null
    const propertyFilterIds = selectedPropertyId === 'all' ? properties.map((p) => p.id) : [selectedPropertyId]
    const financePropertyIds = selectedPropertyId === 'all' ? undefined : [selectedPropertyId]
    return {
      org: membership.data.org,
      role: membership.data.role,
      repo,
      properties,
      selectedPropertyId,
      setSelectedPropertyId,
      propertyFilterIds,
      financePropertyIds,
      refreshProperties: async () => {
        await queryClient.invalidateQueries({ queryKey: ['org', orgId, 'properties'] })
      },
      resetDemoData: async () => {
        if (repo.mode !== 'local') return
        ;(repo.raw as LocalRepo).replaceAll(buildDemoDb())
        await queryClient.invalidateQueries()
      },
      isLocalMode: repo.mode === 'local',
    }
  }, [membership.data, repo, properties, selectedPropertyId, setSelectedPropertyId, queryClient, orgId])

  if (membership.isError && membership.error instanceof NotMemberError) {
    return <JoinOrganization onJoined={() => void queryClient.invalidateQueries({ queryKey: ['membership', userId] })} />
  }
  if (membership.isError) return <ErrorScreen error={membership.error} />
  if (!value || propertiesQuery.isPending) return <>{fallback}</>
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be used inside <OrgProvider>')
  return ctx
}

/** Shortcut for the org-bound repository. */
export function useRepo(): OrgRepo {
  return useOrg().repo
}

// Re-export for convenience in feature modules.
export { DEMO_ORG_ID }
