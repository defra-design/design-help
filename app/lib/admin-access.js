/**
 * Admin access: bootstrap emails (env / hardcoded, always admin) plus
 * HoD-managed rows in app_administrators.
 */

let bootstrapAdminEmails = new Set()
let dynamicAdminEmails = new Set()

function initAdminAccess (bootstrapList) {
  bootstrapAdminEmails = new Set(
    (bootstrapList || [])
      .map((email) => String(email || '').trim().toLowerCase())
      .filter(Boolean)
  )
}

function isBootstrapAdminEmail (email) {
  const e = String(email || '').trim().toLowerCase()
  return Boolean(e && bootstrapAdminEmails.has(e))
}

function isAdminEmailAddress (email) {
  const e = String(email || '').trim().toLowerCase()
  return Boolean(e && (bootstrapAdminEmails.has(e) || dynamicAdminEmails.has(e)))
}

function isAdminUser (user) {
  return isAdminEmailAddress(user && user.email)
}

/** Authoritative check (reads database). Use for access control, especially on multi-dyno hosts. */
async function isAdminUserLive (db, user) {
  if (!user || !user.email) return false
  const e = String(user.email).trim().toLowerCase()
  if (bootstrapAdminEmails.has(e)) return true
  const r = await db.query(
    'SELECT 1 FROM app_administrators WHERE LOWER(TRIM(email)) = $1 LIMIT 1',
    [e]
  )
  return r.rows.length > 0
}

async function loadDynamicAdminEmailSet (db) {
  const r = await db.query('SELECT LOWER(TRIM(email)) AS email FROM app_administrators')
  return new Set(r.rows.map((row) => row.email).filter(Boolean))
}

async function refreshDynamicAdminEmails (db) {
  dynamicAdminEmails = await loadDynamicAdminEmailSet(db)
}

function isAdminEmailAddressFromSet (email, dynamicSet) {
  const e = String(email || '').trim().toLowerCase()
  return Boolean(e && (bootstrapAdminEmails.has(e) || dynamicSet.has(e)))
}

function isDynamicallyGrantedAdmin (email) {
  const e = String(email || '').trim().toLowerCase()
  return Boolean(e && dynamicAdminEmails.has(e))
}

async function grantAdminEmail (db, email, grantedByUserId) {
  const normalised = String(email || '').trim().toLowerCase()
  await db.query(
    `INSERT INTO app_administrators (email, granted_by_user_id)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [normalised, grantedByUserId || null]
  )
  await refreshDynamicAdminEmails(db)
}

async function revokeAdminEmail (db, email) {
  const normalised = String(email || '').trim().toLowerCase()
  if (isBootstrapAdminEmail(normalised)) {
    const err = new Error('bootstrap_admin')
    throw err
  }
  await db.query('DELETE FROM app_administrators WHERE LOWER(TRIM(email)) = $1', [normalised])
  await refreshDynamicAdminEmails(db)
}

module.exports = {
  initAdminAccess,
  isBootstrapAdminEmail,
  isAdminEmailAddress,
  isAdminEmailAddressFromSet,
  isAdminUser,
  isAdminUserLive,
  isDynamicallyGrantedAdmin,
  loadDynamicAdminEmailSet,
  refreshDynamicAdminEmails,
  grantAdminEmail,
  revokeAdminEmail
}
