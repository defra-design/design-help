const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const adminAccess = require('../app/lib/admin-access')

describe('admin-access', () => {
  beforeEach(() => {
    adminAccess.initAdminAccess(['bootstrap@defra.gov.uk'])
  })

  it('treats bootstrap emails as admin', () => {
    assert.equal(adminAccess.isAdminUser({ email: 'bootstrap@defra.gov.uk' }), true)
    assert.equal(adminAccess.isBootstrapAdminEmail('bootstrap@defra.gov.uk'), true)
  })

  it('uses dynamic list after refresh', async () => {
    const emails = []
    const db = {
      query: async () => ({ rows: emails.map((email) => ({ email })) })
    }
    emails.push('granted@defra.gov.uk')
    await adminAccess.refreshDynamicAdminEmails(db)
    assert.equal(adminAccess.isAdminUser({ email: 'granted@defra.gov.uk' }), true)
    assert.equal(adminAccess.isAdminUser({ email: 'other@defra.gov.uk' }), false)
  })

  it('isAdminUserLive reads database for granted admins', async () => {
    const db = {
      query: async (sql, params) => {
        if (sql.includes('FROM app_administrators') && params[0] === 'granted@defra.gov.uk') {
          return { rows: [{ '?': 1 }] }
        }
        return { rows: [] }
      }
    }
    assert.equal(await adminAccess.isAdminUserLive(db, { email: 'granted@defra.gov.uk' }), true)
    assert.equal(await adminAccess.isAdminUserLive(db, { email: 'other@defra.gov.uk' }), false)
    assert.equal(await adminAccess.isAdminUserLive(db, { email: 'bootstrap@defra.gov.uk' }), true)
  })

  it('blocks revoking bootstrap admin', async () => {
    const db = { query: async () => ({ rows: [] }) }
    await assert.rejects(
      () => adminAccess.revokeAdminEmail(db, 'bootstrap@defra.gov.uk'),
      (err) => err.message === 'bootstrap_admin'
    )
  })
})
