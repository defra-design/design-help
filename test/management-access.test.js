const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const managementAccess = require('../app/lib/management-access')

describe('parseLineManagerIdsFromBody', () => {
  it('reads line_manager checkbox array', () => {
    const ids = managementAccess.parseLineManagerIdsFromBody({
      line_manager: ['alice', 'bob']
    })
    assert.deepEqual([...ids].sort(), ['alice', 'bob'])
  })

  it('reads single line_manager value', () => {
    const ids = managementAccess.parseLineManagerIdsFromBody({ line_manager: 'alice' })
    assert.deepEqual([...ids], ['alice'])
  })

  it('reads legacy lm_<id> fields', () => {
    const ids = managementAccess.parseLineManagerIdsFromBody({ lm_pat: 'yes' })
    assert.deepEqual([...ids], ['pat'])
  })

  it('returns empty set for empty body', () => {
    assert.equal(managementAccess.parseLineManagerIdsFromBody(null).size, 0)
  })
})

describe('canReviewGdadEvidenceForTarget', () => {
  const headOfDesignEmails = new Set(['hod@defra.gov.uk'])

  function makeDeps (overrides = {}) {
    const profilesByUserId = overrides.profilesByUserId || {}
    const lineManagers = new Set(overrides.lineManagers || [])
    const allocations = overrides.allocations || {}

    return {
      db: {
        query: async (sql, params) => {
          if (sql.includes('FROM profile_line_manager WHERE profile_id')) {
            return { rows: lineManagers.has(params[0]) ? [{ '?': 1 }] : [] }
          }
          if (sql.includes('FROM profile_manager_allocation WHERE staff_profile_id')) {
            const managerId = allocations[params[0]]
            return { rows: managerId ? [{ manager_profile_id: managerId }] : [] }
          }
          throw new Error(`Unexpected query: ${sql}`)
        }
      },
      isAdminUser: (user) => Boolean(user && user.email),
      getProfileByUserId: async (userId) => profilesByUserId[userId] || null,
      headOfDesignEmails
    }
  }

  function makeReq (user) {
    return { user, _gdadReviewerRole: undefined }
  }

  it('allows Head of Design to review anyone', async () => {
    const deps = makeDeps({
      profilesByUserId: {
        1: { id: 'hod', role: 'Head of Design' },
        2: { id: 'staff', role: 'Service Designer' }
      },
      allocations: { staff: 'other-mgr' }
    })
    const req = makeReq({ id: 1, email: 'hod@defra.gov.uk' })
    const ok = await managementAccess.canReviewGdadEvidenceForTarget(req, 2, deps)
    assert.equal(ok, true)
  })

  it('allows line manager only for assigned staff', async () => {
    const deps = makeDeps({
      profilesByUserId: {
        10: { id: 'mgr', role: 'Design Manager' },
        20: { id: 'staff-a', role: 'Service Designer' },
        21: { id: 'staff-b', role: 'Service Designer' }
      },
      lineManagers: new Set(['mgr']),
      allocations: { 'staff-a': 'mgr', 'staff-b': 'other' }
    })
    const req = makeReq({ id: 10, email: 'mgr@defra.gov.uk' })
    assert.equal(await managementAccess.canReviewGdadEvidenceForTarget(req, 20, deps), true)
    assert.equal(await managementAccess.canReviewGdadEvidenceForTarget(req, 21, deps), false)
  })

  it('allows general admin only for unassigned staff', async () => {
    const deps = makeDeps({
      profilesByUserId: {
        1: { id: 'admin', role: 'Design Manager' },
        2: { id: 'unassigned', role: 'Service Designer' },
        3: { id: 'assigned', role: 'Service Designer' }
      },
      allocations: { assigned: 'mgr-x' }
    })
    const req = makeReq({ id: 1, email: 'admin@defra.gov.uk' })
    assert.equal(await managementAccess.canReviewGdadEvidenceForTarget(req, 2, deps), true)
    assert.equal(await managementAccess.canReviewGdadEvidenceForTarget(req, 3, deps), false)
  })

  it('denies non-admin users', async () => {
    const deps = makeDeps()
    const req = makeReq({ id: 9, email: 'user@defra.gov.uk' })
    assert.equal(await managementAccess.canReviewGdadEvidenceForTarget(req, 2, deps), false)
  })
})
