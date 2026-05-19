/**
 * Head of Design "super user" for manager allocations and full GDaD review access.
 * Aligns with GDaD scoring: admin allowlist + GDAD_HEAD_OF_DESIGN_EMAILS + profile job title.
 */

function pickReviewDeps (deps) {
  return {
    db: deps.db,
    isAdminUser: deps.isAdminUser,
    getProfileByUserId: deps.getProfileByUserId,
    headOfDesignEmails: deps.headOfDesignEmails
  }
}

async function isHeadOfDesignSuperUser (req, deps) {
  const { isAdminUser, getProfileByUserId, headOfDesignEmails } = pickReviewDeps(deps)
  if (!(await isAdminUser(req.user))) return false
  const email = String((req.user && req.user.email) || '').trim().toLowerCase()
  if (!email || !headOfDesignEmails.has(email)) return false
  const myProfile = await getProfileByUserId(req.user.id)
  return Boolean(myProfile && String(myProfile.role || '').trim() === 'Head of Design')
}

async function isProfileLineManager (db, profileId) {
  if (!profileId) return false
  const r = await db.query(
    'SELECT 1 FROM profile_line_manager WHERE profile_id = $1 LIMIT 1',
    [profileId]
  )
  return r.rows.length > 0
}

/**
 * @returns {'none'|'hod'|'line_manager'|'admin'}
 *   none — not an admin reviewer
 *   hod — Head of Design super user (all people)
 *   line_manager — identified line manager (assigned people only)
 *   admin — admin but not a line manager (unassigned people only)
 */
async function getGdadReviewerRole (req, deps) {
  if (req && req._gdadReviewerRole !== undefined) {
    return req._gdadReviewerRole
  }
  const { db, isAdminUser, getProfileByUserId } = pickReviewDeps(deps)
  let role = 'none'
  if (await isAdminUser(req.user)) {
    if (await isHeadOfDesignSuperUser(req, deps)) {
      role = 'hod'
    } else {
      const myProfile = await getProfileByUserId(req.user.id)
      if (myProfile) {
        role = await isProfileLineManager(db, myProfile.id) ? 'line_manager' : 'admin'
      }
    }
  }
  if (req) req._gdadReviewerRole = role
  return role
}

async function getManagerProfileIdForStaff (db, staffProfileId) {
  const allocRes = await db.query(
    'SELECT manager_profile_id FROM profile_manager_allocation WHERE staff_profile_id = $1',
    [staffProfileId]
  )
  const row = allocRes.rows[0]
  return row && row.manager_profile_id ? row.manager_profile_id : null
}

/**
 * Who may open this person's GDaD review (and edit scores when allowed).
 * HoD: everyone. Line manager: only staff assigned to them. Other admins: only unassigned staff.
 */
async function canReviewGdadEvidenceForTarget (req, targetUserId, deps) {
  const { db, isAdminUser, getProfileByUserId } = pickReviewDeps(deps)
  const uid = Number(targetUserId)
  if (!(await isAdminUser(req.user)) || !Number.isInteger(uid) || uid < 1) return false

  const reviewerRole = await getGdadReviewerRole(req, deps)
  if (reviewerRole === 'none') return false
  if (reviewerRole === 'hod') return true

  const targetProfile = await getProfileByUserId(uid)
  if (!targetProfile) return false

  const managerProfileId = await getManagerProfileIdForStaff(db, targetProfile.id)

  if (reviewerRole === 'line_manager') {
    const me = await getProfileByUserId(req.user.id)
    if (!me) return false
    return Boolean(managerProfileId && managerProfileId === me.id)
  }

  // General admin: unassigned staff only
  return !managerProfileId
}

/** Same scope as review: assigned managers may score their people; HoD may score everyone. */
async function canEditGdadScoresForTarget (req, targetUserId, deps) {
  return canReviewGdadEvidenceForTarget(req, targetUserId, deps)
}

/** May open the GDaD review section (list may be empty). */
async function canAccessGdadReviewSection (req, deps) {
  const role = await getGdadReviewerRole(req, deps)
  return role !== 'none'
}

/** Checkbox values from Identify managers (name="line_manager", value=profile id). */
function parseLineManagerIdsFromBody (body) {
  const selected = new Set()
  if (!body || typeof body !== 'object') return selected

  const raw = body.line_manager
  if (raw != null && raw !== '') {
    const list = Array.isArray(raw) ? raw : [raw]
    for (const id of list) {
      const trimmed = String(id).trim()
      if (trimmed) selected.add(trimmed)
    }
  }

  for (const [key, val] of Object.entries(body)) {
    if (!key.startsWith('lm_')) continue
    if (val === 'yes' || val === 'on' || val === true) {
      selected.add(key.slice(3))
    }
  }

  return selected
}

async function listLineManagerProfiles (db) {
  const r = await db.query(`
    SELECT p.id, p.name, p.role
    FROM profiles p
    INNER JOIN profile_line_manager lm ON lm.profile_id = p.id
    ORDER BY LOWER(p.name)
  `)
  return r.rows
}

async function pruneInvalidManagerAllocations (db, client) {
  const run = client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params)
  await run(
    `DELETE FROM profile_manager_allocation a
     WHERE a.manager_profile_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM profile_line_manager lm WHERE lm.profile_id = a.manager_profile_id
     )`
  )
}

async function replaceLineManagers (db, profileIds) {
  const newIds = [...profileIds]
  const newIdSet = new Set(newIds)
  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')

    const previousRes = await client.query('SELECT profile_id FROM profile_line_manager')
    const removedManagerIds = previousRes.rows
      .map((row) => row.profile_id)
      .filter((id) => !newIdSet.has(id))

    await client.query('DELETE FROM profile_line_manager')
    for (const profileId of newIds) {
      await client.query(
        'INSERT INTO profile_line_manager (profile_id) VALUES ($1)',
        [profileId]
      )
    }

    if (removedManagerIds.length > 0) {
      await client.query(
        `DELETE FROM profile_manager_allocation
         WHERE manager_profile_id = ANY($1::varchar[])`,
        [removedManagerIds]
      )
    }

    if (newIds.length === 0) {
      await client.query('DELETE FROM profile_manager_allocation')
    } else {
      await pruneInvalidManagerAllocations(db, client)
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  isHeadOfDesignSuperUser,
  getGdadReviewerRole,
  canReviewGdadEvidenceForTarget,
  canEditGdadScoresForTarget,
  canAccessGdadReviewSection,
  parseLineManagerIdsFromBody,
  listLineManagerProfiles,
  pruneInvalidManagerAllocations,
  replaceLineManagers
}
