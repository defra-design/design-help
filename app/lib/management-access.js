/**
 * Head of Design "super user" for manager allocations and full GDaD review access.
 * Aligns with GDaD scoring: admin allowlist + GDAD_HEAD_OF_DESIGN_EMAILS + profile job title.
 */

async function isHeadOfDesignSuperUser (req, { isAdminUser, getProfileByUserId, headOfDesignEmails }) {
  if (!isAdminUser(req.user)) return false
  const email = String((req.user && req.user.email) || '').trim().toLowerCase()
  if (!email || !headOfDesignEmails.has(email)) return false
  const myProfile = await getProfileByUserId(req.user.id)
  return Boolean(myProfile && String(myProfile.role || '').trim() === 'Head of Design')
}

/**
 * Admin GDaD review access: Head of Design sees everyone; if a staff member has no
 * responsible manager set, any admin can review; otherwise only that manager (or HoD).
 */
async function canReviewGdadEvidenceForTarget (req, targetUserId, { db, isAdminUser, getProfileByUserId, headOfDesignEmails }) {
  const uid = Number(targetUserId)
  if (!isAdminUser(req.user) || !Number.isInteger(uid) || uid < 1) return false
  if (await isHeadOfDesignSuperUser(req, { isAdminUser, getProfileByUserId, headOfDesignEmails })) {
    return true
  }
  const targetProfile = await getProfileByUserId(uid)
  if (!targetProfile) return false
  const allocRes = await db.query(
    'SELECT manager_profile_id FROM profile_manager_allocation WHERE staff_profile_id = $1',
    [targetProfile.id]
  )
  const row = allocRes.rows[0]
  if (!row || !row.manager_profile_id) return true
  const me = await getProfileByUserId(req.user.id)
  if (!me) return false
  return row.manager_profile_id === me.id
}

module.exports = {
  isHeadOfDesignSuperUser,
  canReviewGdadEvidenceForTarget
}
