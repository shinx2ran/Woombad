import { describe, expect, it } from 'vitest'
import type { MemberRole } from '../../../types/db'
import { canChangeRole, canRemoveMember, isInvitationExpired } from './permissions'

const m = (user_id: string, role: MemberRole) => ({ user_id, role })

describe('canChangeRole', () => {
  const owner = m('me', 'owner')
  const admin = m('a', 'admin')
  const staff = m('s', 'staff')

  it('is for owners only', () => {
    const members = [owner, admin, staff]
    expect(canChangeRole('owner', admin, 'me', members)).toBe(true)
    expect(canChangeRole('owner', staff, 'me', members)).toBe(true)
    expect(canChangeRole('admin', staff, 'a', members)).toBe(false)
    expect(canChangeRole('staff', admin, 's', members)).toBe(false)
  })

  it('hides it for yourself while you are the only owner', () => {
    expect(canChangeRole('owner', owner, 'me', [owner, admin])).toBe(false)
    expect(canChangeRole('owner', owner, 'me', [owner, m('o2', 'owner')])).toBe(true)
  })
})

describe('canRemoveMember', () => {
  it('never offers removing yourself', () => {
    expect(canRemoveMember('owner', m('me', 'owner'), 'me')).toBe(false)
    expect(canRemoveMember('admin', m('me', 'admin'), 'me')).toBe(false)
  })

  it('lets owners remove anyone else and admins only staff', () => {
    expect(canRemoveMember('owner', m('o2', 'owner'), 'me')).toBe(true)
    expect(canRemoveMember('owner', m('a', 'admin'), 'me')).toBe(true)
    expect(canRemoveMember('admin', m('s', 'staff'), 'me')).toBe(true)
    expect(canRemoveMember('admin', m('a', 'admin'), 'me')).toBe(false)
    expect(canRemoveMember('admin', m('o', 'owner'), 'me')).toBe(false)
    expect(canRemoveMember('staff', m('s2', 'staff'), 'me')).toBe(false)
  })
})

describe('isInvitationExpired', () => {
  const now = new Date('2026-10-12T10:00:00Z')
  it('compares the expiry timestamp with now', () => {
    expect(isInvitationExpired({ expires_at: '2026-10-19T10:00:00Z' }, now)).toBe(false)
    expect(isInvitationExpired({ expires_at: '2026-10-12T10:00:00Z' }, now)).toBe(true)
    expect(isInvitationExpired({ expires_at: '2026-10-05T10:00:00+00:00' }, now)).toBe(true)
  })
})
