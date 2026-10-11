import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { MemberRole, Organization, Property } from '../types/db'
import { getRepo, bindOrg, LocalRepo, type OrgRepo } from '../lib/repo'
import { buildDemoDb, DEMO_ORG_ID } from '../lib/repo/demoSeed'
import { useAuth } from './useAuth'

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
    const [org] = await local.list('organizations')
    const members = await local.list('organization_members', { where: { org_id: org.id } })
    const me = members.find((m) => m.user_id === userId) ?? members[0]
    return { org, role: me?.role ?? ('owner' as MemberRole) }
  }
  const memberships = await repo.list('organization_members', { where: { user_id: userId } })
  if (memberships.length === 0) {
    // Fallback if the signup trigger did not run (e.g. schema installed after signup).
    const org = await repo.insert('organizations', { name: 'Kos Saya', created_by: userId })
    await repo.insert('organization_members', { org_id: org.id, user_id: userId, email, role: 'owner' })
    return { org, role: 'owner' as MemberRole }
  }
  // A user who signed up before being invited owns an empty "Kos Saya" org as well as the invited one:
  // prefer an organisation created by someone else, then the oldest membership.
  const sorted = [...memberships].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const orgs = await Promise.all(sorted.map((m) => repo.get('organizations', m.org_id)))
  const idx = Math.max(
    0,
    orgs.findIndex((o) => o && o.created_by !== userId),
  )
  const org = orgs[idx]
  if (!org) throw new Error('Organisasi tidak ditemukan.')
  return { org, role: sorted[idx].role }
}

export function OrgProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const userId = session?.user.id ?? ''
  const email = session?.user.email ?? null

  const membership = useQuery({
    queryKey: ['membership', userId],
    queryFn: () => loadMembership(userId, email),
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

  if (membership.isError) {
    return (
      <div className="p-6 text-center text-red-700">
        Gagal memuat organisasi: {(membership.error as Error).message}
      </div>
    )
  }
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
