import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import type { OrgInsert, OrgTableName, Row, Update } from '../types/db'
import type { ListOptions } from '../lib/repo'
import { useOrg } from './useOrg'

/**
 * Query keys: ['org', orgId, table, opts]. Mutations invalidate ['org', orgId, table] so every
 * list of that table refreshes. Dependent tables (e.g. invoices after a payment) must be
 * invalidated explicitly with `useInvalidate()`.
 */
export function tableKey(orgId: string, table: OrgTableName, opts?: unknown) {
  return opts === undefined ? (['org', orgId, table] as const) : (['org', orgId, table, opts] as const)
}

export function useTable<T extends OrgTableName>(
  table: T,
  opts?: ListOptions<Row<T>>,
  queryOpts?: Omit<UseQueryOptions<Row<T>[]>, 'queryKey' | 'queryFn'>,
) {
  const { repo, org } = useOrg()
  return useQuery<Row<T>[]>({
    queryKey: tableKey(org.id, table, opts ?? {}),
    queryFn: () => repo.list(table, opts),
    ...queryOpts,
  })
}

export function useRow<T extends OrgTableName>(table: T, id: string | undefined) {
  const { repo, org } = useOrg()
  return useQuery<Row<T> | null>({
    queryKey: ['org', org.id, table, 'row', id],
    queryFn: () => (id ? repo.get(table, id) : Promise.resolve(null)),
    enabled: Boolean(id),
  })
}

export function useInvalidate() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return (...tables: OrgTableName[]) =>
    Promise.all(tables.map((t) => qc.invalidateQueries({ queryKey: tableKey(org.id, t) })))
}

export function useInsert<T extends OrgTableName>(table: T, alsoInvalidate: OrgTableName[] = []) {
  const { repo } = useOrg()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (row: OrgInsert<T>) => repo.insert(table, row),
    onSuccess: () => invalidate(table, ...alsoInvalidate),
  })
}

export function useUpdate<T extends OrgTableName>(table: T, alsoInvalidate: OrgTableName[] = []) {
  const { repo } = useOrg()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Update<T> }) => repo.update(table, id, patch),
    onSuccess: () => invalidate(table, ...alsoInvalidate),
  })
}

export function useRemove<T extends OrgTableName>(table: T, alsoInvalidate: OrgTableName[] = []) {
  const { repo } = useOrg()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => repo.remove(table, id),
    onSuccess: () => invalidate(table, ...alsoInvalidate),
  })
}
