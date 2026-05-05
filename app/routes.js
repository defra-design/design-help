//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()
const appConfig = require('./config.json')
const session = require('express-session')
const pgSession = require('connect-pg-simple')(session)
const passport = require('passport')
const LocalStrategy = require('passport-local').Strategy
const bcrypt = require('bcrypt')
const db = require('./db')
const {
  sendVerificationEmail,
  isNotifyConfigured,
  sendServiceFeedbackEmail,
  isFeedbackNotifyConfigured
} = require('./notify')
const { registerGdAdRoutes } = require('./gdad/routes')
const { ensureGdadTable } = require('./gdad/evidence-store')
const {
  isGdAdEvidenceApplicableRole,
  isGdAdScorer: isGdAdScorerUser
} = require('./gdad/constants')
const crypto = require('crypto')
const authBypassEnabled = process.env.NODE_ENV !== 'production' && process.env.AUTH_BYPASS === 'true'
const authBypassUser = {
  id: Number(process.env.AUTH_BYPASS_USER_ID || 16),
  email: process.env.AUTH_BYPASS_EMAIL || 'Pete@defra.gov.uk',
  name: process.env.AUTH_BYPASS_NAME || 'Peter Smith',
  is_verified: true
}
let resolvedAuthBypassUser = null
const hardcodedAdminEmails = [
  'pete.smith@defra.gov.uk',
  'christopher.hawker@defra.gov.uk',
  'louise.tudor@defra.gov.uk'
]
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : hardcodedAdminEmails)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
)
const defaultHeadOfDesignEmails = ['pete.smith@defra.gov.uk']
const headOfDesignEmails = new Set(
  (process.env.GDAD_HEAD_OF_DESIGN_EMAILS ? process.env.GDAD_HEAD_OF_DESIGN_EMAILS.split(',') : defaultHeadOfDesignEmails)
    .map((email) => String(email || '').trim().toLowerCase())
    .filter(Boolean)
)
const defaultApprovedEmails = [
  'pete.smith@defra.gov.uk',
  'christopher.hawker@defra.gov.uk',
  'louise.tudor@defra.gov.uk'
]
const approvedEmailsFallback = new Set(
  (process.env.APPROVED_EMAILS ? process.env.APPROVED_EMAILS.split(',') : defaultApprovedEmails)
    .map((email) => String(email || '').trim().toLowerCase())
    .filter(Boolean)
)
const allowedRoles = [
  // Interaction Design (GDaD-aligned progression)
  'Interaction Designer',
  'Senior Interaction Designer',
  // Service Design (GDaD-aligned progression)
  'Service Designer',
  'Senior Service Designer',
  'Principal Service Designer',
  // Shared leadership title across interaction and service design
  'Head of Design',
  'Design Manager',
  'Senior Resource Manager',
  // Accessibility (using closest GDaD-style specialist titles)
  'Accessibility Specialist (SEO)',
  'Senior Accessibility Specialist (Grade 7)'
]
const allowedAvailabilityStatuses = ['Busy', 'Some capacity', 'Free to help']
const adminProfileWizardSteps = ['details', 'about', 'can-help', 'development-goals']
const codeReleaseVersion = String(appConfig.releaseVersion || '').trim() || 'dev'
const localDemoAdminEmail = String(process.env.LOCAL_ADMIN_EMAIL || 'pete.smith@defra.gov.uk').trim().toLowerCase()
const localDemoAdminPassword = String(process.env.LOCAL_ADMIN_PASSWORD || 'help')
/** Matches homepage /browse shortcuts so seeded local demos return results for each link */
const localBrowseShortcutTags = [
  'Design crits',
  'Prototyping question',
  'Mural support',
  'Figma support',
  'Accessibility questions',
  'Feedback on service design artefact',
  'Heroku',
  'SOP and admin systems',
  'AI tooling and prompts'
]

db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    is_verified BOOLEAN DEFAULT FALSE,
    verification_code VARCHAR(16),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )
`).catch((err) => {
  console.error('Users table setup failed', err)
})

db.query(`
  CREATE TABLE IF NOT EXISTS profiles (
    id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    role VARCHAR(255),
    location VARCHAR(255),
    experience TEXT,
    bio TEXT,
    skills TEXT[],
    can_help_with TEXT[],
    can_help_with_text TEXT,
    development_goals TEXT[],
    development_goals_text TEXT,
    project_team VARCHAR(255),
    delivery_group VARCHAR(255),
    linkedin_profile TEXT,
    interests TEXT[],
    availability_status VARCHAR(50) DEFAULT 'Some capacity',
    busy_until DATE,
    contact_email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )
`).catch((err) => {
  console.error('Profiles table setup failed', err)
})

async function ensureLocalDemoAdminAccount () {
  if (process.env.NODE_ENV === 'production') {
    return
  }
  try {
    const passwordHash = await bcrypt.hash(localDemoAdminPassword, 10)
    let userId = null
    const existingUser = await db.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [localDemoAdminEmail])
    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id
      await db.query(
        'UPDATE users SET password_hash = $1, is_verified = TRUE, verification_code = NULL WHERE id = $2',
        [passwordHash, userId]
      )
    } else {
      const created = await db.query(
        'INSERT INTO users (email, password_hash, is_verified, verification_code) VALUES ($1, $2, TRUE, NULL) RETURNING id',
        [localDemoAdminEmail, passwordHash]
      )
      userId = created.rows[0].id
    }

    await db.query('INSERT INTO approved_emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [localDemoAdminEmail])

    const existingProfile = await db.query('SELECT id FROM profiles WHERE user_id = $1 LIMIT 1', [userId])
    if (existingProfile.rows.length === 0) {
      const preferredProfileId = 'pete-smith-admin'
      const existingId = await db.query('SELECT user_id FROM profiles WHERE id = $1 LIMIT 1', [preferredProfileId])
      const profileId = (existingId.rows.length === 0 || Number(existingId.rows[0].user_id) === Number(userId))
        ? preferredProfileId
        : `pete-smith-admin-${userId}`
      await db.query(
        `INSERT INTO profiles (id, user_id, name, role, location, experience, availability_status, contact_email, can_help_with)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[])`,
        [profileId, userId, 'Pete Smith', 'Design Manager', 'Bristol', '10+ years', 'Some capacity', localDemoAdminEmail, localBrowseShortcutTags]
      )
    }
    await db.query(
      `UPDATE profiles SET can_help_with = $1::text[] WHERE user_id = $2
       AND (can_help_with IS NULL OR cardinality(can_help_with) = 0)`,
      [localBrowseShortcutTags, userId]
    )
  } catch (err) {
    console.error('Local demo admin seed failed', err)
  }
}

ensureLocalDemoAdminAccount()

// Keep profile schema aligned for local iteration.
db.query(`
  ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS project_team VARCHAR(255),
  ADD COLUMN IF NOT EXISTS delivery_group VARCHAR(255),
  ADD COLUMN IF NOT EXISTS experience TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_profile TEXT,
  ADD COLUMN IF NOT EXISTS can_help_with_text TEXT,
  ADD COLUMN IF NOT EXISTS development_goals TEXT[],
  ADD COLUMN IF NOT EXISTS development_goals_text TEXT,
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)
`).catch((err) => {
  console.error('Profile schema update failed', err)
})

db.query(`
  CREATE TABLE IF NOT EXISTS profile_long_term_helping (
    id SERIAL PRIMARY KEY,
    helper_profile_id VARCHAR(255) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    helpee_profile_id VARCHAR(255) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT profile_long_term_helping_not_self CHECK (helper_profile_id <> helpee_profile_id),
    CONSTRAINT profile_long_term_helping_unique_pair UNIQUE (helper_profile_id, helpee_profile_id)
  );
`).catch((err) => {
  console.error('Long-term helping table create failed', err)
})

ensureGdadTable(db).catch((err) => {
  console.error('GDaD evidence table create failed', err)
})

db.query(`
  CREATE TABLE IF NOT EXISTS approved_emails (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )
`).then(async () => {
  try {
    const seededApprovedEmails = (process.env.APPROVED_EMAILS
      ? process.env.APPROVED_EMAILS.split(',')
      : defaultApprovedEmails
    ).map((email) => email.trim().toLowerCase()).filter(Boolean)
    for (const email of seededApprovedEmails) {
      await db.query('INSERT INTO approved_emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email])
    }
  } catch (err) {
    console.error('Approved email seed failed', err)
  }
}).catch((err) => {
  console.error('Approved email table setup failed', err)
})

// Keep user auth schema aligned for production environments.
db.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_code VARCHAR(16)
`).catch((err) => {
  console.error('User auth schema update failed', err)
})

function isAdminUser(user) {
  return Boolean(user && user.email && adminEmails.has(user.email.toLowerCase()))
}

function isAdminEmailAddress(email) {
  return Boolean(email && adminEmails.has(String(email).toLowerCase()))
}

function isHeadOfDesignEmailAddress(email) {
  return Boolean(email && headOfDesignEmails.has(String(email).trim().toLowerCase()))
}

const feedbackInboxEmail = String(process.env.FEEDBACK_INBOX_EMAIL || 'pete.smith@defra.gov.uk').trim()

function sanitiseFeedbackReturnPath (raw) {
  if (raw === undefined || raw === null) {
    return '/'
  }
  const s = String(raw).trim()
  if (!s.startsWith('/') || s.startsWith('//')) return '/'
  if (s.length > 512) return '/'
  return s
}

const feedbackHowEasyOptions = [
  'Very easy',
  'Easy',
  'Neither easy nor difficult',
  'Difficult',
  'Very difficult'
]

function ensureAdmin(req, res, next) {
  if (isAdminUser(req.user)) {
    return next()
  }
  return res.status(403).send('Admin access required')
}

function normaliseAllowedRole(role) {
  return allowedRoles.find((allowedRole) => allowedRole.toLowerCase() === String(role || '').trim().toLowerCase())
}

function normaliseAvailabilityStatus(status) {
  return allowedAvailabilityStatuses.find((allowedStatus) => allowedStatus.toLowerCase() === String(status || '').trim().toLowerCase())
}

function verifyEmailPageLocals (req, { email, error = null, info = null } = {}) {
  const showDevCode = process.env.NODE_ENV !== 'production' && Boolean(req.session && req.session.debugCode)
  return {
    email,
    error,
    info,
    devVerificationCode: showDevCode ? req.session.debugCode : null
  }
}

async function sendVerificationCodeForEmail (req, email, verificationCode) {
  if (isNotifyConfigured()) {
    await sendVerificationEmail(email, verificationCode)
    delete req.session.debugCode
    return
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('notify_not_configured')
  }
  console.log('---------------------------------------------------')
  console.log(`EMAIL SIMULATION: Verification code for ${email} is: ${verificationCode}`)
  console.log('---------------------------------------------------')
  req.session.debugCode = verificationCode
}

function getAdminSessionChanges(req) {
  if (!req.session.adminSessionChanges) {
    req.session.adminSessionChanges = { edited: [], added: [], removed: [] }
  }
  return req.session.adminSessionChanges
}

function trackAdminChange(req, changeType, profileId) {
  const changes = getAdminSessionChanges(req)
  if (!changes[changeType].includes(profileId)) {
    changes[changeType].push(profileId)
  }
}

function getWizardStep(step) {
  return adminProfileWizardSteps.includes(step) ? step : 'details'
}

function getPreviousStep(step) {
  const idx = adminProfileWizardSteps.indexOf(step)
  return idx > 0 ? adminProfileWizardSteps[idx - 1] : null
}

function getNextStep(step) {
  const idx = adminProfileWizardSteps.indexOf(step)
  return idx >= 0 && idx < adminProfileWizardSteps.length - 1 ? adminProfileWizardSteps[idx + 1] : null
}

/** Carry wizard drafts across POSTs without relying solely on Postgres session snapshots (fixes lost carry on Heroku mid-wizard). */
function encodeWizardDraftCarrier (draft) {
  try {
    return Buffer.from(JSON.stringify(draft)).toString('base64')
  } catch (_) {
    return ''
  }
}

function decodeWizardDraftCarrier (raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  if (s.length > 256000) return null
  try {
    return JSON.parse(Buffer.from(s, 'base64').toString('utf8'))
  } catch (_) {
    return null
  }
}

/** Allow registration/sign-in for profile contact addresses added by admins */
async function ensureApprovedEmailInDb (email) {
  const e = String(email || '').trim().toLowerCase()
  if (!e.endsWith('@defra.gov.uk')) {
    return
  }
  await db.query(
    'INSERT INTO approved_emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
    [e]
  )
}

/** Atomically approve email + insert profile created by admin wizard (registration depends on approval row existing). */
async function insertAdminWizardProfileTxn (draft, profileId) {
  const contactForProfile = String(draft.contact_email || '').trim().toLowerCase()
  if (!contactForProfile.endsWith('@defra.gov.uk')) {
    throw new Error('wizard_bad_contact_email')
  }
  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'INSERT INTO approved_emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [contactForProfile]
    )
    await client.query(`
      INSERT INTO profiles (
        id, user_id, name, project_team, delivery_group, role, location, experience, bio,
        linkedin_profile, can_help_with, can_help_with_text, development_goals, development_goals_text, availability_status, contact_email
      ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      profileId,
      draft.name,
      draft.project_team || null,
      draft.delivery_group || null,
      normaliseAllowedRole(draft.role),
      draft.location,
      draft.experience,
      draft.bio || null,
      draft.linkedin_profile || null,
      sanitiseTagArray(draft.can_help_with || []),
      draft.can_help_with_text || null,
      sanitiseTagArray(draft.development_goals || []),
      draft.development_goals_text || null,
      normaliseAvailabilityStatus(draft.availability_status) || 'Some capacity',
      contactForProfile
    ])
    await client.query('COMMIT')
  } catch (e) {
    try {
      await client.query('ROLLBACK')
    } catch (_) { /* noop */ }
    throw e
  } finally {
    client.release()
  }
}

async function getHelpingHelpees (helperProfileId) {
  if (!helperProfileId) {
    return []
  }
  const h = await db.query(
    `SELECT h.helpee_profile_id, p.name AS helpee_name
     FROM profile_long_term_helping h
     JOIN profiles p ON p.id = h.helpee_profile_id
     WHERE h.helper_profile_id = $1
     ORDER BY h.created_at ASC`,
    [helperProfileId]
  )
  return h.rows
}

function parseHelpeeProfileIds (body) {
  const v = body.helpeeProfileId
  if (v == null || v === '') {
    return []
  }
  const arr = Array.isArray(v) ? v : [v]
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))]
}

function parseTagList (raw) {
  const items = !raw
    ? []
    : (Array.isArray(raw)
        ? raw.map((item) => item && item.trim())
        : String(raw).split(',').map((item) => item.trim()))
  return items.filter((item) => item && item !== '_unchecked')
}

function sanitiseTagArray (raw) {
  if (raw == null || raw === '') {
    return []
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item || '').trim())
      .filter((item) => item && item !== '_unchecked')
  }
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const parsed = JSON.parse(s)
        return sanitiseTagArray(parsed)
      } catch (_) {
        /* fall through */
      }
    }
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1)
      if (inner.trim() === '') {
        return []
      }
      return inner.split(',').map((item) => {
        let chunk = item.trim()
        if (chunk.startsWith('"') && chunk.endsWith('"')) {
          chunk = chunk.slice(1, -1).replace(/""/g, '"')
        }
        return chunk.trim()
      }).filter((item) => item && item !== '_unchecked')
    }
    return parseTagList(s)
  }
  return []
}

async function getMyProfileFormContext (req) {
  const { name, canHelpWithTags, developmentGoalsTags } = req.body
  const profile = {
    ...req.body,
    can_help_with: Array.isArray(canHelpWithTags) ? sanitiseTagArray(canHelpWithTags) : parseTagList(canHelpWithTags),
    development_goals: Array.isArray(developmentGoalsTags) ? sanitiseTagArray(developmentGoalsTags) : parseTagList(developmentGoalsTags)
  }
  return { profile }
}

async function getHelpingJourneyViewData (userId) {
  const profile = await getProfileForUser(userId)
  if (!profile || !profile.id) {
    return { profile: null, designerOptions: [], helpingRows: [] }
  }
  const d = await db.query('SELECT id, name FROM profiles WHERE id != $1 ORDER BY name ASC', [profile.id])
  const helpeeIds = (profile.long_term_helping || []).map((h) => h.helpee_profile_id)
  const n = Math.min(25, Math.max(1, helpeeIds.length + 1))
  const helpingRows = Array.from({ length: n }, (_, i) => ({ index: i, selectedId: helpeeIds[i] || '' }))
  return { profile, designerOptions: d.rows, helpingRows }
}

function buildHelpingRowsFromRequestBody (body) {
  const ar = normaliseAvailabilityStatus(body.availabilityStatus)
  const helpeeIds = ar === 'Free to help' ? [] : parseHelpeeProfileIds(body)
  const n = Math.min(25, Math.max(1, helpeeIds.length + 1))
  return Array.from({ length: n }, (_, i) => ({ index: i, selectedId: helpeeIds[i] || '' }))
}

async function renderHelpingJourneyError (req, res, errorMessage) {
  const { profile, designerOptions } = await getHelpingJourneyViewData(req.user.id)
  if (!profile) {
    return res.redirect('/my-profile/edit')
  }
  const helpingRows = buildHelpingRowsFromRequestBody(req.body)
  return res.render('my-profile-helping', {
    profile,
    designerOptions,
    helpingRows,
    error: errorMessage,
    success: false
  })
}

async function setLongTermHelpingForHelper (helperProfileId, helpeeIds, client) {
  const q = client || db
  const seen = new Set()
  const ids = helpeeIds.filter((id) => {
    if (!id || id === helperProfileId || seen.has(id)) {
      return false
    }
    seen.add(id)
    return true
  })
  await q.query('DELETE FROM profile_long_term_helping WHERE helper_profile_id = $1', [helperProfileId])
  for (const hid of ids) {
    const ok = await q.query('SELECT 1 FROM profiles WHERE id = $1', [hid])
    if (ok.rows.length) {
      await q.query(
        'INSERT INTO profile_long_term_helping (helper_profile_id, helpee_profile_id) VALUES ($1, $2)',
        [helperProfileId, hid]
      )
    }
  }
}

async function getProfileForUser(userId) {
  const resDb = await db.query(
    'SELECT p.*, u.email AS account_email FROM profiles p LEFT JOIN users u ON u.id = p.user_id WHERE p.user_id = $1',
    [userId]
  )
  const profile = resDb.rows[0] || null
  if (profile) {
    profile.can_help_with = sanitiseTagArray(profile.can_help_with)
    profile.development_goals = sanitiseTagArray(profile.development_goals)
    profile.long_term_helping = await getHelpingHelpees(profile.id)
  }
  return profile
}

// Session Configuration
router.use(session({
  store: new pgSession({
    pool: db.pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'keyboard cat',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: process.env.NODE_ENV === 'production' // Secure in production
  }
}))

// Passport Configuration
router.use(passport.initialize())
router.use(passport.session())

// Temporary local testing switch: bypasses auth when AUTH_BYPASS=true.
router.use(async (req, res, next) => {
  if (authBypassEnabled && !req.user) {
    if (!resolvedAuthBypassUser) {
      try {
        const userRes = await db.query('SELECT id, email FROM users WHERE email = $1 LIMIT 1', [authBypassUser.email])
        if (userRes.rows.length > 0) {
          resolvedAuthBypassUser = { ...authBypassUser, id: userRes.rows[0].id, email: userRes.rows[0].email }
        } else {
          resolvedAuthBypassUser = authBypassUser
        }
      } catch (err) {
        console.error('Auth bypass user resolution failed', err)
        resolvedAuthBypassUser = authBypassUser
      }
    }
    req.user = resolvedAuthBypassUser
  }
  next()
})

passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const res = await db.query('SELECT * FROM users WHERE email = $1', [username])
    if (res.rows.length === 0) {
      return done(null, false, { message: 'Incorrect email.' })
    }
    const user = res.rows[0]
    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) {
      return done(null, false, { message: 'Incorrect password.' })
    }
    if (!user.is_verified) {
      return done(null, false, { message: 'Please verify your email address.' })
    }
    return done(null, user)
  } catch (err) {
    return done(err)
  }
}))

passport.serializeUser((user, done) => {
  done(null, user.id)
})

passport.deserializeUser(async (id, done) => {
  try {
    const res = await db.query('SELECT * FROM users WHERE id = $1', [id])
    // If user deleted, return false/null so passport knows they are gone
    if (res.rows.length === 0) {
      return done(null, false)
    }
    done(null, res.rows[0])
  } catch (err) {
    done(err)
  }
})

// --- MIDDLEWARE ---

// Make user available to all views
router.use((req, res, next) => {
  res.locals.user = req.user
  res.locals.isAdmin = isAdminUser(req.user)
  res.locals.currentPath = req.path
  res.locals.isProduction = process.env.NODE_ENV === 'production'
  res.locals.appVersion = codeReleaseVersion
  res.locals.feedbackLinkHref = '/feedback?return=' + encodeURIComponent(req.path || '/')
  res.locals.showFeedbackFooter = !req.path.startsWith('/feedback')
  next()
})

router.use(async (req, res, next) => {
  res.locals.profileJobRole = null
  res.locals.gdadEvidenceApplicable = false
  res.locals.isGdAdScorer = isGdAdScorerUser(req.user)
  if (!req.user || authBypassEnabled) {
    return next()
  }
  try {
    const r = await db.query('SELECT role FROM profiles WHERE user_id = $1 LIMIT 1', [req.user.id])
    const jobRole = r.rows[0] && r.rows[0].role
    res.locals.profileJobRole = jobRole
    res.locals.gdadEvidenceApplicable = Boolean(jobRole && isGdAdEvidenceApplicableRole(jobRole))
  } catch (e) {
    console.error('Profile role for layout failed', e)
  }
  next()
})

// Global Authentication Guard
router.use((req, res, next) => {
  if (authBypassEnabled) {
    return next()
  }

  // Allow public routes
  const publicPaths = [
    '/login',
    '/register',
    '/verify-email',
    '/about',
    '/feedback',
    '/public',
    '/assets',
    '/govuk-frontend',
    '/plugin-assets',
    '/gdad-reference'
  ]

  if (publicPaths.some(path => req.path.startsWith(path)) || req.path === '/' && !req.isAuthenticated()) {
    // Allow / to pass through if not logged in (it typically redirects to /index or /login anyway, but let's be safe)
    // Actually, let's just allow base public assets.
    return next()
  }

  // Allow if authenticated
  if (req.isAuthenticated()) {
    return next()
  }

  // Otherwise redirect to login
  res.redirect('/login')
})

// --- AUTH ROUTES ---

router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) { return next(err) }
    res.redirect('/login')
  })
})


// Middleware to check authentication
function ensureAuthenticated(req, res, next) {
  if (authBypassEnabled || req.isAuthenticated()) {
    return next()
  }
  res.redirect('/login')
}

async function getProfileByUserId (userId) {
  const r = await db.query('SELECT * FROM profiles WHERE user_id = $1 LIMIT 1', [userId])
  return r.rows[0] || null
}

// Make user available in templates
router.use((req, res, next) => {
  res.locals.user = req.user
  res.locals.isAdmin = isAdminUser(req.user)
  res.locals.currentPath = req.path
  res.locals.isProduction = process.env.NODE_ENV === 'production'
  res.locals.appVersion = codeReleaseVersion
  res.locals.feedbackLinkHref = '/feedback?return=' + encodeURIComponent(req.path || '/')
  res.locals.showFeedbackFooter = !req.path.startsWith('/feedback')
  res.locals.isGdAdScorer = isGdAdScorerUser(req.user)
  next()
})

// --- AUTH ROUTES ---

router.get('/login', (req, res) => {
  if (authBypassEnabled) {
    return res.redirect('/browse')
  }

  const error = req.session.messages ? req.session.messages[0] : null
  const lastLoginEmail = req.session.lastLoginEmail
  const verifyEmailLink = (error === 'Please verify your email address.' && lastLoginEmail)
    ? `/verify-email?email=${encodeURIComponent(lastLoginEmail)}`
    : null
  res.render('login', { error, verifyEmailLink })
  req.session.messages = [] // Clear messages
})

router.post('/login', (req, res, next) => {
  req.session.lastLoginEmail = String(req.body.username || '').trim().toLowerCase()
  passport.authenticate('local', {
    successRedirect: '/browse',
    failureRedirect: '/login',
    failureMessage: true
  })(req, res, next)
})

router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err) }
    res.redirect('/')
  })
})

router.get('/register', (req, res) => {
  res.render('register')
})

router.get('/about', (req, res) => {
  res.render('about')
})

router.get('/feedback/thank-you', (req, res) => {
  res.render('feedback-thank-you')
})

router.get('/feedback', (req, res) => {
  const returnPath = sanitiseFeedbackReturnPath(req.query.return)
  res.render('feedback', {
    returnPath,
    errors: null,
    values: {
      details: '',
      contact_email: req.user ? String(req.user.email || '') : '',
      how_easy: ''
    },
    howEasyOptions: feedbackHowEasyOptions
  })
})

router.post('/feedback', async (req, res) => {
  const returnPath = sanitiseFeedbackReturnPath(req.body.return_path)
  const details = String(req.body.details || '').trim()
  const contactEmail = String(req.body.contact_email || '').trim()
  const howEasyRaw = String(req.body.how_easy || '').trim()
  const howEasy = feedbackHowEasyOptions.includes(howEasyRaw) ? howEasyRaw : ''

  const errors = {}
  if (!details) {
    errors.details = 'Enter your feedback'
  } else if (details.length > 4000) {
    errors.details = 'Feedback must be 4000 characters or fewer'
  }
  if (contactEmail.length > 255) {
    errors.contact_email = 'Email address is too long'
  } else if (contactEmail) {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
    if (!emailOk) {
      errors.contact_email = 'Enter an email address in the correct format, or leave this blank'
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.render('feedback', {
      returnPath,
      errors,
      values: { details, contact_email: contactEmail, how_easy: howEasy },
      howEasyOptions: feedbackHowEasyOptions
    })
  }

  const easeLine = howEasy ? `How easy was this service to use: ${howEasy}\n\n` : ''
  const feedbackDetails = easeLine + details
  const signedInAs = req.user && req.user.email ? String(req.user.email) : 'Not signed in'

  if (isFeedbackNotifyConfigured()) {
    try {
      await sendServiceFeedbackEmail(feedbackInboxEmail, {
        feedbackDetails,
        pagePath: returnPath,
        contactEmail: contactEmail || 'Not provided',
        signedInAs
      })
    } catch (err) {
      console.error('Feedback Notify send failed', err)
      return res.render('feedback', {
        returnPath,
        errors: { _form: 'Your feedback could not be sent. Try again in a few minutes.' },
        values: { details, contact_email: contactEmail, how_easy: howEasy },
        howEasyOptions: feedbackHowEasyOptions
      })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return res.render('feedback', {
      returnPath,
      errors: {
        _form: 'Sending feedback is not available yet. Ask the team to add a GOV.UK Notify feedback template (NOTIFY_FEEDBACK_TEMPLATE_ID).'
      },
      values: { details, contact_email: contactEmail, how_easy: howEasy },
      howEasyOptions: feedbackHowEasyOptions
    })
  } else {
    console.log('---------------------------------------------------')
    console.log('[FEEDBACK SIMULATION] Intended recipient:', feedbackInboxEmail)
    console.log(JSON.stringify({ pagePath: returnPath, contactEmail: contactEmail || null, signedInAs, feedbackDetails }, null, 2))
    console.log('---------------------------------------------------')
  }

  res.redirect(303, '/feedback/thank-you')
})

router.post('/register', async (req, res) => {
  const { name, username, password } = req.body
  const emailLower = String(username || '').trim().toLowerCase()

  // Defra Email Check
  if (!emailLower.endsWith('@defra.gov.uk')) {
    return res.render('register', { error: 'You must use a @defra.gov.uk email address.' })
  }

  try {
    let isApproved = false
    try {
      const approvedRes = await db.query(
        'SELECT 1 FROM approved_emails WHERE LOWER(TRIM(email)) = $1 LIMIT 1',
        [emailLower]
      )
      isApproved = approvedRes.rows.length > 0
    } catch (approvedErr) {
      console.error('Approved emails lookup failed, using fallback list', approvedErr)
      isApproved = approvedEmailsFallback.has(emailLower)
    }
    if (!isApproved) {
      return res.render('register', { error: 'This email is not on the approved team list yet. Ask an admin to add it.' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    if (process.env.NODE_ENV === 'production' && !isNotifyConfigured()) {
      return res.render('register', {
        error: 'Registration is not available because email sending is not configured on this service. Contact the team running Design help.'
      })
    }

    // Generate 6 digit code
    const verificationCode = crypto.randomInt(100000, 999999).toString()

    // Create User (Unverified)
    const userRes = await db.query(
      'INSERT INTO users (email, password_hash, is_verified, verification_code) VALUES ($1, $2, $3, $4) RETURNING id',
      [emailLower, hashedPassword, false, verificationCode]
    )
    const userId = userRes.rows[0].id

    // Create profile stub when possible, but do not block account creation if
    // older production schemas reject this lightweight insert.
    try {
      const profileId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `user-${userId}`
      await db.query(
        'INSERT INTO profiles (id, user_id, name, availability_status) VALUES ($1, $2, $3, $4)',
        [profileId, userId, name, 'Some capacity']
      )
    } catch (profileErr) {
      console.error('Profile stub creation skipped during registration', profileErr)
    }

    try {
      await sendVerificationCodeForEmail(req, emailLower, verificationCode)
    } catch (notifyErr) {
      console.error('Verification email failed; registering user rolled back (see preceding GOV.UK Notify log line).', notifyErr.message)
      try {
        await db.query('DELETE FROM profiles WHERE user_id = $1', [userId])
        await db.query('DELETE FROM users WHERE id = $1', [userId])
      } catch (rollbackErr) {
        console.error('Rollback after Notify failure failed', rollbackErr)
      }
      return res.render('register', {
        error: 'We could not send the verification email. Check the address is valid and try again, or try again in a few minutes.'
      })
    }

    req.session.registrationEmail = emailLower
    res.redirect('/verify-email')

  } catch (err) {
    console.error(err)
    if (err.code === '23505') { // Unique violation
      try {
        const existingUserRes = await db.query('SELECT id, is_verified FROM users WHERE email = $1 LIMIT 1', [emailLower])
        const existingUser = existingUserRes.rows[0]
        if (existingUser && !existingUser.is_verified) {
          if (process.env.NODE_ENV === 'production' && !isNotifyConfigured()) {
            return res.render('register', {
              error: 'Registration is not available because email sending is not configured on this service. Contact the team running Design help.'
            })
          }
          const refreshedCode = crypto.randomInt(100000, 999999).toString()
          const refreshedPasswordHash = await bcrypt.hash(password, 10)
          await db.query(
            'UPDATE users SET password_hash = $1, verification_code = $2 WHERE id = $3',
            [refreshedPasswordHash, refreshedCode, existingUser.id]
          )
          await sendVerificationCodeForEmail(req, emailLower, refreshedCode)
          req.session.registrationEmail = emailLower
          return res.redirect('/verify-email')
        }
      } catch (recoverErr) {
        console.error('Unverified account recovery failed', recoverErr)
      }
      return res.render('register', { error: 'Email already exists.' })
    } else {
      const safeError = process.env.NODE_ENV === 'production'
        ? 'An error occurred.'
        : `An error occurred.${(err && err.message) ? ` (${err.message})` : ''}`
      return res.render('register', { error: safeError })
    }
  }
})

// Verification Routes
router.get('/verify-email', (req, res) => {
  const queryEmail = String(req.query.email || '').trim().toLowerCase()
  if (queryEmail) {
    req.session.registrationEmail = queryEmail
  }
  res.render('verify-email', verifyEmailPageLocals(req, {
    email: queryEmail || req.session.registrationEmail,
    error: req.session.messages ? req.session.messages[0] : null,
    info: req.session.verifyInfo || null
  }))
  req.session.messages = []
  delete req.session.verifyInfo
})

router.post('/verify-email', async (req, res) => {
  const { code } = req.body
  const action = String(req.body.action || 'verify').trim().toLowerCase()
  const email = String(req.body.email || '').trim().toLowerCase()

  try {
    if (!email) {
      return res.render('verify-email', verifyEmailPageLocals(req, { email: '', error: 'Enter your email address to continue.' }))
    }
    const resDb = await db.query('SELECT * FROM users WHERE email = $1', [email])
    if (resDb.rows.length === 0) {
      return res.render('verify-email', verifyEmailPageLocals(req, { email, error: 'User not found.' }))
    }

    const user = resDb.rows[0]

    if (action === 'resend') {
      if (user.is_verified) {
        return res.render('verify-email', verifyEmailPageLocals(req, { email, error: 'This email is already verified. You can sign in.' }))
      }
      const refreshedCode = crypto.randomInt(100000, 999999).toString()
      await db.query('UPDATE users SET verification_code = $1 WHERE id = $2', [refreshedCode, user.id])
      await sendVerificationCodeForEmail(req, email, refreshedCode)
      return res.render('verify-email', verifyEmailPageLocals(req, {
        email,
        info: 'We sent a new verification code.'
      }))
    }

    if (String(user.verification_code) === String(code).trim()) {
      await db.query('UPDATE users SET is_verified = TRUE, verification_code = NULL WHERE id = $1', [user.id])
      const verifiedUser = { ...user, is_verified: true, verification_code: null }
      delete req.session.debugCode
      req.login(verifiedUser, (err) => {
        if (err) throw err
        res.redirect('/browse')
      })
    } else {
      res.render('verify-email', verifyEmailPageLocals(req, { email, error: 'Invalid verification code.' }))
    }
  } catch (err) {
    console.error(err)
    res.render('verify-email', verifyEmailPageLocals(req, { email, error: 'An error occurred.' }))
  }
})

// --- APP ROUTES ---

router.get('/admin/users', ensureAdmin, async (req, res) => {
  try {
    const [profilesRes, approvedEmailsRes, usersRes] = await Promise.all([
      db.query('SELECT id, user_id, name, role, contact_email FROM profiles'),
      db.query('SELECT id, email FROM approved_emails'),
      db.query('SELECT id, email FROM users')
    ])

    const usersById = new Map(usersRes.rows.map((user) => [Number(user.id), String(user.email || '').toLowerCase()]))
    const approvedByEmail = new Map(approvedEmailsRes.rows.map((approved) => [String(approved.email || '').toLowerCase(), approved]))
    const usedApprovedIds = new Set()

    const rows = profilesRes.rows.map((profile) => {
      const userEmail = profile.user_id ? usersById.get(Number(profile.user_id)) : null
      const displayEmail = userEmail || (profile.contact_email ? String(profile.contact_email).toLowerCase().trim() : null)
      const approvedMatch = displayEmail ? approvedByEmail.get(displayEmail) : null
      if (approvedMatch) {
        usedApprovedIds.add(approvedMatch.id)
      }
      return {
        approved_email_id: approvedMatch ? approvedMatch.id : null,
        email: displayEmail || (approvedMatch ? approvedMatch.email : null),
        profile_id: profile.id,
        user_id: profile.user_id,
        name: profile.name,
        role: profile.role,
        gdad_applicable: Boolean(profile.user_id && isGdAdEvidenceApplicableRole(profile.role)),
        pending_activation: false,
        is_admin: isAdminEmailAddress(displayEmail)
      }
    })

    // Include approved emails that do not yet have a linked profile.
    approvedEmailsRes.rows.forEach((approved) => {
      if (!usedApprovedIds.has(approved.id)) {
        rows.push({
          approved_email_id: approved.id,
          email: approved.email,
          profile_id: null,
          user_id: null,
          name: null,
          role: null,
          gdad_applicable: false,
          pending_activation: true,
          is_admin: isAdminEmailAddress(approved.email)
        })
      }
    })

    rows.sort((a, b) => {
      const aKey = (a.name || a.email || '').toLowerCase()
      const bKey = (b.name || b.email || '').toLowerCase()
      return aKey.localeCompare(bKey)
    })

    const changes = getAdminSessionChanges(req)
    const adminMsg = req.query.adminMsg === 'not-defra'
      ? 'Only @defra.gov.uk addresses can be added. Check the address and try again.'
      : req.query.adminMsg === 'missing'
        ? 'Enter an email address.'
        : req.query.adminMsg === 'duplicate'
          ? 'That address is already on the allowed list.'
          : null
    return res.render('admin-users', {
      rows,
      changes,
      adminMsg
    })
  } catch (err) {
    console.error(err)
    return res.status(500).send('Error loading admin users')
  }
})

router.post('/admin/approved-emails', ensureAdmin, async (req, res) => {
  const raw = String(req.body.email || '').trim()
  const email = raw.toLowerCase()
  if (!email) {
    return res.redirect('/admin/users?adminMsg=missing')
  }
  if (!email.endsWith('@defra.gov.uk')) {
    return res.redirect('/admin/users?adminMsg=not-defra')
  }
  try {
    const ins = await db.query(
      'INSERT INTO approved_emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING id',
      [email]
    )
    if (ins.rows.length === 0) {
      return res.redirect('/admin/users?adminMsg=duplicate')
    }
    res.redirect('/admin/users')
  } catch (err) {
    console.error(err)
    res.redirect('/admin/users')
  }
})

router.post('/admin/approved-emails/:id/delete', ensureAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM approved_emails WHERE id = $1', [req.params.id])
    res.redirect('/admin/users')
  } catch (err) {
    console.error(err)
    res.redirect('/admin/users')
  }
})

router.get('/admin/users/:id/edit', ensureAdmin, async (req, res) => {
  try {
    const resDb = await db.query('SELECT * FROM profiles WHERE id = $1', [req.params.id])
    const profile = resDb.rows[0]
    if (!profile) {
      return res.status(404).send('Profile not found')
    }
    profile.can_help_with = profile.can_help_with || []
    profile.development_goals = profile.development_goals || []
    return res.render('add-profile', {
      success: false,
      profile,
      isAdminMode: true,
      isWizardMode: false,
      formAction: `/admin/users/${req.params.id}/edit`,
      formTitle: 'Edit team member profile',
      adminReturnUrl: '/admin/users'
    })
  } catch (err) {
    console.error(err)
    return res.status(500).send('Error loading profile')
  }
})

router.post('/admin/users/:id/edit', ensureAdmin, async (req, res) => {
  const parseList = (str) => {
    if (!str) return []
    if (Array.isArray(str)) return str.map(item => item && item.trim()).filter(item => item)
    return str.split(',').map(item => item.trim()).filter(item => item)
  }
  const wordCount = (text) => (!text || !text.trim() ? 0 : text.trim().split(/\s+/).length)
  const {
    name, projectTeam, deliveryGroup, role, availabilityStatus, location, experience, about, linkedinProfile, canHelpWithTags, canHelpWithText, developmentGoalsTags, developmentGoalsText, contactEmail
  } = req.body
  const normalisedRole = normaliseAllowedRole(role)
  const normalisedAvailabilityStatus = normaliseAvailabilityStatus(availabilityStatus)
  const contactEmailNorm = String(contactEmail || '').trim().toLowerCase()
  const profileModel = {
    ...req.body,
    contact_email: contactEmailNorm || '',
    can_help_with: parseList(canHelpWithTags),
    development_goals: parseList(developmentGoalsTags),
    availability_status: availabilityStatus
  }
  if (!normalisedRole || !normalisedAvailabilityStatus) {
    return res.render('add-profile', {
      success: false,
      profile: profileModel,
      isAdminMode: true,
      isWizardMode: false,
      formAction: `/admin/users/${req.params.id}/edit`,
      formTitle: 'Edit team member profile',
      adminReturnUrl: '/admin/users',
      error: 'Select valid job title and availability values from the list.'
    })
  }
  if (normalisedRole === 'Head of Design') {
    const existingProfileRes = await db.query(
      'SELECT p.contact_email, u.email AS account_email FROM profiles p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = $1 LIMIT 1',
      [req.params.id]
    )
    const existingProfile = existingProfileRes.rows[0] || {}
    const candidateEmail = String(contactEmailNorm || existingProfile.account_email || existingProfile.contact_email || '').trim().toLowerCase()
    if (!isHeadOfDesignEmailAddress(candidateEmail)) {
      return res.render('add-profile', {
        success: false,
        profile: profileModel,
        isAdminMode: true,
        isWizardMode: false,
        formAction: `/admin/users/${req.params.id}/edit`,
        formTitle: 'Edit team member profile',
        adminReturnUrl: '/admin/users',
        error: 'Only the designated Head of Design account can use the "Head of Design" job title.'
      })
    }
  }
  if (wordCount(canHelpWithText) > 150 || wordCount(developmentGoalsText) > 150) {
    return res.render('add-profile', {
      success: false,
      profile: profileModel,
      isAdminMode: true,
      isWizardMode: false,
      formAction: `/admin/users/${req.params.id}/edit`,
      formTitle: 'Edit team member profile',
      adminReturnUrl: '/admin/users',
      error: 'Additional details must be 150 words or fewer for both "Can help with" and "Development goals".'
    })
  }
  if (contactEmailNorm && !contactEmailNorm.endsWith('@defra.gov.uk')) {
    return res.render('add-profile', {
      success: false,
      profile: profileModel,
      isAdminMode: true,
      isWizardMode: false,
      formAction: `/admin/users/${req.params.id}/edit`,
      formTitle: 'Edit team member profile',
      adminReturnUrl: '/admin/users',
      error: 'Defra email must be a valid @defra.gov.uk address (or leave blank).'
    })
  }
  try {
    await db.query(`
      UPDATE profiles SET
        name = $1, project_team = $2, delivery_group = $3, role = $4, location = $5,
        experience = $6, bio = $7, linkedin_profile = $8, can_help_with = $9, can_help_with_text = $10,
        development_goals = $11, development_goals_text = $12, availability_status = $13,
        contact_email = $14
      WHERE id = $15
    `, [
      name, projectTeam || null, deliveryGroup || null, normalisedRole, location,
      experience, about || null, linkedinProfile || null, parseList(canHelpWithTags), canHelpWithText || null,
      parseList(developmentGoalsTags), developmentGoalsText || null, normalisedAvailabilityStatus,
      contactEmailNorm || null,
      req.params.id
    ])
    if (contactEmailNorm) {
      await ensureApprovedEmailInDb(contactEmailNorm)
    }
    trackAdminChange(req, 'edited', req.params.id)
    return res.redirect('/admin/users')
  } catch (err) {
    console.error(err)
    return res.render('add-profile', {
      success: false,
      profile: profileModel,
      isAdminMode: true,
      isWizardMode: false,
      formAction: `/admin/users/${req.params.id}/edit`,
      formTitle: 'Edit team member profile',
      adminReturnUrl: '/admin/users',
      error: 'Error saving profile'
    })
  }
})

router.get('/admin/add-profile', ensureAdmin, (req, res) => {
  if (String(req.query.new || '') === '1') {
    delete req.session.adminProfileDraft
  }
  const wizardStep = getWizardStep(req.query.step)
  const draft = req.session.adminProfileDraft || {}
  const adminWizardDraftB64 = encodeWizardDraftCarrier(draft)
  res.render('add-profile', {
    success: false,
    profile: draft,
    isAdminMode: true,
    isWizardMode: true,
    wizardStep: wizardStep,
    wizardStepIndex: adminProfileWizardSteps.indexOf(wizardStep) + 1,
    wizardStepCount: adminProfileWizardSteps.length,
    formAction: '/admin/add-profile',
    formTitle: 'Add team member profile',
    adminReturnUrl: '/admin/users',
    adminWizardDraftB64
  })
})

router.post('/admin/add-profile', ensureAdmin, async (req, res) => {
  const parseList = (str) => {
    if (!str) {
      return []
    }
    if (Array.isArray(str)) {
      return str.map(item => item && item.trim()).filter(item => item)
    }
    return str.split(',').map(item => item.trim()).filter(item => item)
  }
  const wordCount = (text) => {
    if (!text || !text.trim()) {
      return 0
    }
    return text.trim().split(/\s+/).length
  }

  const {
    name, projectTeam, deliveryGroup, role, availabilityStatus, location, experience, about, linkedinProfile, canHelpWithTags, canHelpWithText, developmentGoalsTags, developmentGoalsText, contactEmail,
    adminWizardDraftB64: postedWizardCarrier
  } = req.body
  const step = getWizardStep(req.body.step)
  const action = req.body.action
  const decodedCarrier = decodeWizardDraftCarrier(postedWizardCarrier)
  const updatedDraft = {
    ...(req.session.adminProfileDraft || {}),
    ...(decodedCarrier || {})
  }
  if (name !== undefined) updatedDraft.name = name
  if (projectTeam !== undefined) updatedDraft.project_team = projectTeam
  if (deliveryGroup !== undefined) updatedDraft.delivery_group = deliveryGroup
  if (role !== undefined) {
    const nr = normaliseAllowedRole(role)
    updatedDraft.role = nr || role
  }
  if (location !== undefined) updatedDraft.location = location
  if (availabilityStatus !== undefined) {
    updatedDraft.availability_status = normaliseAvailabilityStatus(availabilityStatus) || availabilityStatus
  }
  if (experience !== undefined) updatedDraft.experience = experience
  if (about !== undefined) updatedDraft.bio = about
  if (linkedinProfile !== undefined) updatedDraft.linkedin_profile = linkedinProfile
  if (canHelpWithTags !== undefined) updatedDraft.can_help_with = parseList(canHelpWithTags)
  if (canHelpWithText !== undefined) updatedDraft.can_help_with_text = canHelpWithText
  if (developmentGoalsTags !== undefined) updatedDraft.development_goals = parseList(developmentGoalsTags)
  if (developmentGoalsText !== undefined) updatedDraft.development_goals_text = developmentGoalsText
  if (contactEmail !== undefined) {
    const trimmed = String(contactEmail || '').trim().toLowerCase()
    if (trimmed) {
      updatedDraft.contact_email = trimmed
    }
  }
  const normalisedRoleForStep = normaliseAllowedRole(updatedDraft.role)
  const normalisedAvailabilityForStep = normaliseAvailabilityStatus(updatedDraft.availability_status)

  if (action === 'previous') {
    req.session.adminProfileDraft = updatedDraft
    const prev = getPreviousStep(step) || 'details'
    return res.redirect(`/admin/add-profile?step=${prev}`)
  }

  const canHelpWithTextWords = wordCount(String(updatedDraft.can_help_with_text || ''))
  const developmentGoalsTextWords = wordCount(String(updatedDraft.development_goals_text || ''))
  if ((step === 'can-help' || step === 'development-goals') && (canHelpWithTextWords > 150 || developmentGoalsTextWords > 150)) {
    req.session.adminProfileDraft = updatedDraft
    return res.render('add-profile', {
      success: false,
      isAdminMode: true,
      isWizardMode: true,
      wizardStep: step,
      wizardStepIndex: adminProfileWizardSteps.indexOf(step) + 1,
      wizardStepCount: adminProfileWizardSteps.length,
      formAction: '/admin/add-profile',
      formTitle: 'Add team member profile',
      adminReturnUrl: '/admin/users',
      adminWizardDraftB64: encodeWizardDraftCarrier(updatedDraft),
      error: 'Additional details must be 150 words or fewer for both "Can help with" and "Development goals".',
      profile: updatedDraft
    })
  }
  if (step === 'details' && !normalisedRoleForStep) {
    req.session.adminProfileDraft = updatedDraft
    return res.render('add-profile', {
      success: false,
      isAdminMode: true,
      isWizardMode: true,
      wizardStep: step,
      wizardStepIndex: adminProfileWizardSteps.indexOf(step) + 1,
      wizardStepCount: adminProfileWizardSteps.length,
      formAction: '/admin/add-profile',
      formTitle: 'Add team member profile',
      adminReturnUrl: '/admin/users',
      adminWizardDraftB64: encodeWizardDraftCarrier(updatedDraft),
      error: 'Select a valid GDaD job title from the list.',
      profile: updatedDraft
    })
  }
  if (step === 'details' && normalisedRoleForStep === 'Head of Design') {
    const ceForHeadRole = String(updatedDraft.contact_email || '').trim().toLowerCase()
    if (!isHeadOfDesignEmailAddress(ceForHeadRole)) {
      req.session.adminProfileDraft = updatedDraft
      return res.render('add-profile', {
        success: false,
        isAdminMode: true,
        isWizardMode: true,
        wizardStep: step,
        wizardStepIndex: adminProfileWizardSteps.indexOf(step) + 1,
        wizardStepCount: adminProfileWizardSteps.length,
        formAction: '/admin/add-profile',
        formTitle: 'Add team member profile',
        adminReturnUrl: '/admin/users',
        adminWizardDraftB64: encodeWizardDraftCarrier(updatedDraft),
        error: 'Only the designated Head of Design account can use the "Head of Design" job title.',
        profile: updatedDraft
      })
    }
  }
  if (step === 'details' && !normalisedAvailabilityForStep) {
    req.session.adminProfileDraft = updatedDraft
    return res.render('add-profile', {
      success: false,
      isAdminMode: true,
      isWizardMode: true,
      wizardStep: step,
      wizardStepIndex: adminProfileWizardSteps.indexOf(step) + 1,
      wizardStepCount: adminProfileWizardSteps.length,
      formAction: '/admin/add-profile',
      formTitle: 'Add team member profile',
      adminReturnUrl: '/admin/users',
      adminWizardDraftB64: encodeWizardDraftCarrier(updatedDraft),
      error: 'Select a valid availability status from the list.',
      profile: updatedDraft
    })
  }
  if (step === 'details' && (!updatedDraft.name || !updatedDraft.location || !updatedDraft.experience)) {
    req.session.adminProfileDraft = updatedDraft
    return res.render('add-profile', {
      success: false,
      isAdminMode: true,
      isWizardMode: true,
      wizardStep: step,
      wizardStepIndex: adminProfileWizardSteps.indexOf(step) + 1,
      wizardStepCount: adminProfileWizardSteps.length,
      formAction: '/admin/add-profile',
      formTitle: 'Add team member profile',
      adminReturnUrl: '/admin/users',
      adminWizardDraftB64: encodeWizardDraftCarrier(updatedDraft),
      error: 'Name, job title, location and experience are required.',
      profile: updatedDraft
    })
  }

  const nextStep = getNextStep(step)

  // Leaving step 1: Defra email is stored on the profile and mirrored to approved_emails so they can register
  if (step === 'details' && nextStep) {
    const ce = String(updatedDraft.contact_email || '').trim()
    if (!ce.endsWith('@defra.gov.uk')) {
      req.session.adminProfileDraft = updatedDraft
      return res.render('add-profile', {
        success: false,
        isAdminMode: true,
        isWizardMode: true,
        wizardStep: step,
        wizardStepIndex: adminProfileWizardSteps.indexOf(step) + 1,
        wizardStepCount: adminProfileWizardSteps.length,
        formAction: '/admin/add-profile',
        formTitle: 'Add team member profile',
        adminReturnUrl: '/admin/users',
        adminWizardDraftB64: encodeWizardDraftCarrier(updatedDraft),
        error: 'Enter the team member\'s @defra.gov.uk email so they can register and appear on the approved list.',
        profile: updatedDraft
      })
    }
  }

  req.session.adminProfileDraft = updatedDraft
  if (nextStep) {
    return res.redirect(`/admin/add-profile?step=${nextStep}`)
  }

  try {
    const ce = String(updatedDraft.contact_email || '').trim()
    if (!ce.endsWith('@defra.gov.uk')) {
      req.session.adminProfileDraft = updatedDraft
      return res.render('add-profile', {
        success: false,
        isAdminMode: true,
        isWizardMode: true,
        wizardStep: step,
        wizardStepIndex: adminProfileWizardSteps.indexOf(step) + 1,
        wizardStepCount: adminProfileWizardSteps.length,
        formAction: '/admin/add-profile',
        formTitle: 'Add team member profile',
        adminReturnUrl: '/admin/users',
        adminWizardDraftB64: encodeWizardDraftCarrier(updatedDraft),
        error: 'Defra email is missing or invalid in the wizard state. Start again from step 1 and include their @defra.gov.uk email.',
        profile: updatedDraft
      })
    }
    const profileId = `${updatedDraft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}`
    await insertAdminWizardProfileTxn(updatedDraft, profileId)
    req.session.adminProfileDraft = null
    trackAdminChange(req, 'added', profileId)
    return res.redirect('/admin/users')
  } catch (err) {
    console.error(err)
    req.session.adminProfileDraft = updatedDraft
    return res.render('add-profile', {
      success: false,
      isAdminMode: true,
      isWizardMode: true,
      wizardStep: step,
      wizardStepIndex: adminProfileWizardSteps.indexOf(step) + 1,
      wizardStepCount: adminProfileWizardSteps.length,
      formAction: '/admin/add-profile',
      formTitle: 'Add team member profile',
      adminReturnUrl: '/admin/users',
      adminWizardDraftB64: encodeWizardDraftCarrier(updatedDraft),
      error: process.env.NODE_ENV === 'production' ? 'Error saving profile' : `Error saving profile (${err.message || err})`,
      profile: updatedDraft
    })
  }
})

async function getProfileDeleteContext (profileId) {
  const resDb = await db.query(
    'SELECT p.*, u.email AS user_account_email FROM profiles p LEFT JOIN users u ON p.user_id = u.id WHERE p.id = $1',
    [profileId]
  )
  const profile = resDb.rows[0]
  if (!profile) {
    return null
  }
  const displayEmail = String(profile.user_account_email || profile.contact_email || '').trim()
  const emailLower = displayEmail.toLowerCase()
  let approvedEmailId = null
  if (emailLower) {
    const ap = await db.query('SELECT id FROM approved_emails WHERE LOWER(email) = $1', [emailLower])
    if (ap.rows[0]) {
      approvedEmailId = ap.rows[0].id
    }
  }
  return { profile, displayEmail, approvedEmailId }
}

router.get('/admin/profile/:id/confirm-delete', ensureAdmin, async (req, res) => {
  try {
    const ctx = await getProfileDeleteContext(req.params.id)
    if (!ctx) {
      return res.status(404).send('Profile not found')
    }
    return res.render('admin-confirm-remove', {
      kind: 'profile',
      profile: ctx.profile,
      displayEmail: ctx.displayEmail,
      approvedEmailId: ctx.approvedEmailId,
      profileId: ctx.profile.id
    })
  } catch (err) {
    console.error(err)
    return res.status(500).send('Error')
  }
})

router.get('/admin/approved-emails/:id/confirm-delete', ensureAdmin, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM approved_emails WHERE id = $1', [req.params.id])
    if (r.rows.length === 0) {
      return res.status(404).send('Not found')
    }
    return res.render('admin-confirm-remove', {
      kind: 'email',
      emailRow: r.rows[0]
    })
  } catch (err) {
    console.error(err)
    return res.status(500).send('Error')
  }
})

router.get('/admin/long-term-helping', ensureAdmin, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT h.id,
              to_char(h.created_at AT TIME ZONE 'UTC', 'DD Mon YYYY') AS since_label,
              h.helper_profile_id, h.helpee_profile_id,
              ph.name AS helper_name, pe.name AS helpee_name
       FROM profile_long_term_helping h
       JOIN profiles ph ON ph.id = h.helper_profile_id
       JOIN profiles pe ON pe.id = h.helpee_profile_id
       ORDER BY h.created_at DESC`
    )
    return res.render('admin-long-term-helping', { relationships: r.rows })
  } catch (err) {
    console.error(err)
    return res.status(500).send('Error loading data')
  }
})

router.post('/admin/profile/:id/delete', ensureAdmin, async (req, res) => {
  const profileId = req.params.id
  try {
    const ctx = await getProfileDeleteContext(profileId)
    if (!ctx) {
      return res.status(404).send('Profile not found')
    }
    const { approvedEmailId: expectedApprovedId } = ctx
    const removeApproved = String(req.body.remove_approved || '') === 'yes'
    const postedId = req.body.approved_email_id != null && req.body.approved_email_id !== ''
      ? parseInt(req.body.approved_email_id, 10)
      : null
    if (removeApproved) {
      if (!expectedApprovedId || !postedId || postedId !== expectedApprovedId) {
        return res.status(400).send('Invalid allowlist remove request')
      }
      await db.query('DELETE FROM approved_emails WHERE id = $1', [expectedApprovedId])
    }
    await db.query('DELETE FROM profiles WHERE id = $1', [profileId])
    trackAdminChange(req, 'removed', profileId)
    res.redirect('/admin/users')
  } catch (err) {
    console.error(err)
    res.status(500).send('Error deleting profile')
  }
})

router.get('/my-profile', ensureAuthenticated, async (req, res) => {
  try {
    const profile = await getProfileForUser(req.user.id)
    res.render('my-profile', { profile })
  } catch (err) {
    console.error(err)
    res.status(500).send('Error loading profile')
  }
})

// Browse team members page with optional filtering
router.get('/browse', async (req, res) => {
  const filter = req.query.filter
  const sort = req.query.sort || 'a-z'
  let filteredMembers = []
  let groupedMembers = []
  const getRoleGroup = (role) => {
    const normalisedRole = String(role || '').toLowerCase()
    if (normalisedRole.includes('accessibility')) {
      return 'Accessibility'
    }
    if (normalisedRole.includes('service')) {
      return 'Service design'
    }
    if (normalisedRole.includes('interaction')) {
      return 'Interaction design'
    }
    if (normalisedRole.includes('head') || normalisedRole.includes('manager') || normalisedRole.includes('resource')) {
      return 'Leadership'
    }
    return 'Other'
  }

  try {
    if (filter) {
      // Simple search query matching JSON logic
      const query = `
         SELECT * FROM profiles 
         WHERE 
           array_to_string(can_help_with, ' ') ILIKE $1 OR
           COALESCE(can_help_with_text, '') ILIKE $1 OR
           COALESCE(development_goals_text, '') ILIKE $1 OR
           role ILIKE $1 OR
           name ILIKE $1
       `
      const resDb = await db.query(query, [`%${filter}%`])
      filteredMembers = resDb.rows
    } else {
      const resDb = await db.query('SELECT * FROM profiles')
      filteredMembers = resDb.rows
    }
  } catch (err) {
    console.error(err)
  }

  filteredMembers = filteredMembers.map((member) => ({
    ...member,
    can_help_with: sanitiseTagArray(member.can_help_with),
    development_goals: sanitiseTagArray(member.development_goals),
    is_own_profile: Boolean(req.user && req.user.id && member.user_id && Number(member.user_id) === Number(req.user.id))
  }))

  if (sort === 'z-a') {
    filteredMembers.sort((a, b) => String(b.name || '').localeCompare(String(a.name || '')))
  } else if (sort === 'profession') {
    const groupOrder = ['Service design', 'Interaction design', 'Leadership', 'Accessibility', 'Other']
    filteredMembers.sort((a, b) => {
      const aGroup = getRoleGroup(a.role)
      const bGroup = getRoleGroup(b.role)
      const groupDiff = groupOrder.indexOf(aGroup) - groupOrder.indexOf(bGroup)
      if (groupDiff !== 0) {
        return groupDiff
      }
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
    groupedMembers = groupOrder.map((groupName) => ({
      groupName,
      members: filteredMembers.filter((member) => getRoleGroup(member.role) === groupName)
    })).filter((group) => group.members.length > 0)
  } else {
    filteredMembers.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  }

  res.render('browse', {
    filteredMembers: filteredMembers,
    groupedMembers: groupedMembers,
    filterText: filter,
    sort: sort
  })
})

function buildFreeTextScanEntries (members, user, freeTextScope, freeTextQuery) {
  const q = String(freeTextQuery || '').trim().toLowerCase()
  return members
    .map((member) => {
      const canHelpWithText = String(member.can_help_with_text || '').trim()
      const developmentGoalsText = String(member.development_goals_text || '').trim()
      return {
        id: member.id,
        name: member.name,
        role: member.role,
        is_own_profile: Boolean(user && user.id && member.user_id && Number(member.user_id) === Number(user.id)),
        can_help_with_text: canHelpWithText,
        development_goals_text: developmentGoalsText
      }
    })
    .filter((entry) => {
      const hasCanHelp = Boolean(entry.can_help_with_text)
      const hasGoals = Boolean(entry.development_goals_text)
      if (freeTextScope === 'can-help') {
        if (!hasCanHelp) return false
      } else if (freeTextScope === 'development-goals') {
        if (!hasGoals) return false
      } else {
        if (!hasCanHelp && !hasGoals) return false
      }

      if (!q) {
        return true
      }
      if (freeTextScope === 'can-help') {
        return String(entry.can_help_with_text || '').toLowerCase().includes(q) || String(entry.name || '').toLowerCase().includes(q)
      }
      if (freeTextScope === 'development-goals') {
        return String(entry.development_goals_text || '').toLowerCase().includes(q) || String(entry.name || '').toLowerCase().includes(q)
      }
      const combinedText = `${entry.can_help_with_text} ${entry.development_goals_text}`.toLowerCase()
      return combinedText.includes(q) || String(entry.name || '').toLowerCase().includes(q)
    })
}

async function renderFreeTextScanPage (req, res, { freeTextScope, pageName, formAction, pageIntro, emptyMessage }) {
  const freeTextQuery = String(req.query.freeTextQuery || '').trim()
  let members = []
  try {
    const resDb = await db.query('SELECT * FROM profiles ORDER BY name ASC')
    members = resDb.rows
  } catch (err) {
    console.error(err)
  }

  const freeTextEntries = buildFreeTextScanEntries(members, req.user, freeTextScope, freeTextQuery)

  res.render('requests-offers', {
    freeTextEntries,
    freeTextScope,
    freeTextQuery,
    pageName,
    formAction,
    pageIntro,
    emptyMessage
  })
}

router.get('/offers', ensureAuthenticated, async (req, res) => {
  await renderFreeTextScanPage(req, res, {
    freeTextScope: 'can-help',
    pageName: 'Offers',
    formAction: '/offers',
    pageIntro: 'What people are offering to help with, in their own words. Use a keyword to narrow the list.',
    emptyMessage: 'No one has added this kind of “can help with” text yet, or your keyword does not match anyone.'
  })
})

router.get('/requests', ensureAuthenticated, async (req, res) => {
  await renderFreeTextScanPage(req, res, {
    freeTextScope: 'development-goals',
    pageName: 'Requests',
    formAction: '/requests',
    pageIntro: 'What people are looking to work on, in their own words. Use a keyword to narrow the list.',
    emptyMessage: 'No one has added development goal text yet, or your keyword does not match anyone.'
  })
})

router.get('/requests-offers', ensureAuthenticated, (req, res) => {
  res.redirect(302, '/offers')
})

// Individual profile pages
router.get('/profile/:id', async (req, res) => {
  const memberId = req.params.id
  try {
    const resDb = await db.query(
      'SELECT p.*, u.email AS account_email FROM profiles p LEFT JOIN users u ON p.user_id = u.id WHERE p.id = $1',
      [memberId]
    )
    const member = resDb.rows[0]

    if (member) {
      member.display_email = member.account_email || member.contact_email
      member.can_help_with = member.can_help_with || []
      member.development_goals = member.development_goals || []
      const isOwnProfile = Boolean(req.user && req.user.id && member.user_id && Number(member.user_id) === Number(req.user.id))
      res.render('profile', {
        member: member,
        isOwnProfile
      })
    } else {
      res.status(404).send('Profile not found')
    }
  } catch (err) {
    console.error(err)
    res.status(500).send('Error')
  }
})

router.get('/add-profile', ensureAuthenticated, (req, res) => {
  res.redirect('/my-profile/edit')
})

// Short journey: who I'm helping + availability (Protected)
router.get('/my-profile/helping', ensureAuthenticated, async (req, res) => {
  try {
    const { profile, designerOptions, helpingRows } = await getHelpingJourneyViewData(req.user.id)
    if (!profile) {
      return res.redirect('/my-profile/edit')
    }
    return res.render('my-profile-helping', {
      profile,
      designerOptions,
      helpingRows,
      error: null,
      success: false
    })
  } catch (err) {
    console.error(err)
    return res.status(500).send('Error loading page')
  }
})

router.post('/my-profile/helping', ensureAuthenticated, async (req, res) => {
  const { availabilityStatus } = req.body
  const normalisedAvailabilityStatus = normaliseAvailabilityStatus(availabilityStatus)
  if (!normalisedAvailabilityStatus) {
    return renderHelpingJourneyError(req, res, 'Select a valid availability status.')
  }
  const pr = await db.query('SELECT id FROM profiles WHERE user_id = $1', [req.user.id])
  if (pr.rows.length === 0) {
    return res.redirect('/my-profile/edit')
  }
  const profileId = pr.rows[0].id
  let helpeeIds = normalisedAvailabilityStatus === 'Free to help' ? [] : parseHelpeeProfileIds(req.body)
  if (normalisedAvailabilityStatus !== 'Free to help' && helpeeIds.length > 0) {
    for (const hid of helpeeIds) {
      const c = await db.query('SELECT id FROM profiles WHERE id = $1', [hid])
        if (c.rows.length === 0) {
        return renderHelpingJourneyError(req, res, 'One of the designer choices is not valid.')
      }
    }
  }
  for (const hid of helpeeIds) {
    if (hid === profileId) {
      return renderHelpingJourneyError(req, res, 'You cannot add yourself as someone you are helping.')
    }
  }
  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('UPDATE profiles SET availability_status = $1 WHERE id = $2', [normalisedAvailabilityStatus, profileId])
    await setLongTermHelpingForHelper(profileId, helpeeIds, client)
    await client.query('COMMIT')
  } catch (e) {
    try { await client.query('ROLLBACK') } catch (err) { /* ignore */ }
    console.error(e)
    return renderHelpingJourneyError(req, res, 'Could not save. Try again.')
  } finally {
    client.release()
  }
  const { profile, designerOptions, helpingRows } = await getHelpingJourneyViewData(req.user.id)
  return res.render('my-profile-helping', {
    profile,
    designerOptions,
    helpingRows,
    error: null,
    success: true
  })
})

// My profile form - GET (Protected)
router.get('/my-profile/edit', ensureAuthenticated, async (req, res) => {
  try {
    const profile = await getProfileForUser(req.user.id)
    res.render('add-profile', {
      success: false,
      profile: profile,
      isAdminMode: false,
      isWizardMode: false,
      formAction: '/my-profile/edit'
    })
  } catch (err) {
    console.error(err)
    res.status(500).send('Error loading profile')
  }
})

// My profile form - POST (Protected)
router.post('/my-profile/edit', ensureAuthenticated, async (req, res) => {
  const wordCount = (text) => {
    if (!text || !text.trim()) {
      return 0
    }
    return text.trim().split(/\s+/).length
  }

  const {
    name, projectTeam, deliveryGroup, role, availabilityStatus, location, experience, about, linkedinProfile, canHelpWithTags, canHelpWithText, developmentGoalsTags, developmentGoalsText
  } = req.body
  const normalisedRole = normaliseAllowedRole(role)
  const normalisedAvailabilityStatus = normaliseAvailabilityStatus(availabilityStatus)

  const canHelpWithTextWords = wordCount(canHelpWithText)
  const developmentGoalsTextWords = wordCount(developmentGoalsText)
  if (canHelpWithTextWords > 150 || developmentGoalsTextWords > 150) {
    const ctx = await getMyProfileFormContext(req)
    return res.render('add-profile', {
      success: false,
      isAdminMode: false,
      isWizardMode: false,
      formAction: '/my-profile/edit',
      error: 'Additional details must be 150 words or fewer for both "Can help with" and "Development goals".',
      ...ctx
    })
  }
  if (!normalisedRole) {
    const ctx = await getMyProfileFormContext(req)
    return res.render('add-profile', {
      success: false,
      isAdminMode: false,
      isWizardMode: false,
      formAction: '/my-profile/edit',
      error: 'Select a valid GDaD job title from the list.',
      ...ctx
    })
  }
  if (normalisedRole === 'Head of Design' && !isHeadOfDesignEmailAddress(req.user && req.user.email)) {
    const ctx = await getMyProfileFormContext(req)
    return res.render('add-profile', {
      success: false,
      isAdminMode: false,
      isWizardMode: false,
      formAction: '/my-profile/edit',
      error: 'The "Head of Design" job title is reserved for a designated account.',
      ...ctx
    })
  }
  if (!normalisedAvailabilityStatus) {
    const ctx = await getMyProfileFormContext(req)
    return res.render('add-profile', {
      success: false,
      isAdminMode: false,
      isWizardMode: false,
      formAction: '/my-profile/edit',
      error: 'Select a valid availability status from the list.',
      ...ctx
    })
  }

  try {
    const userId = req.user.id
    let profileId = ''

    const existingRes = await db.query('SELECT id FROM profiles WHERE user_id = $1', [userId])

    if (existingRes.rows.length > 0) {
      profileId = existingRes.rows[0].id
      await db.query(`
            UPDATE profiles SET
                name = $1, project_team = $2, delivery_group = $3, role = $4, location = $5,
                experience = $6, bio = $7, linkedin_profile = $8, can_help_with = $9, can_help_with_text = $10,
                development_goals = $11, development_goals_text = $12, availability_status = $13
            WHERE user_id = $14
          `, [
        name, projectTeam || null, deliveryGroup || null, normalisedRole, location,
        experience, about || null, linkedinProfile || null, parseTagList(canHelpWithTags), canHelpWithText || null,
        parseTagList(developmentGoalsTags), developmentGoalsText || null, normalisedAvailabilityStatus,
        userId
      ])
    } else {
      profileId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `user-${userId}`
      await db.query(`
            INSERT INTO profiles (
                id, user_id, name, project_team, delivery_group, role, location, experience, bio,
                linkedin_profile, can_help_with, can_help_with_text, development_goals, development_goals_text, availability_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          `, [
        profileId, userId, name, projectTeam || null, deliveryGroup || null, normalisedRole, location, experience, about || null,
        linkedinProfile || null, parseTagList(canHelpWithTags), canHelpWithText || null, parseTagList(developmentGoalsTags), developmentGoalsText || null, normalisedAvailabilityStatus
      ])
    }

    let fresh = null
    try {
      fresh = await getProfileForUser(userId)
    } catch (reloadErr) {
      console.error('Profile saved but reloading failed', reloadErr)
    }
    if (!fresh) {
      try {
        const fallback = await getMyProfileFormContext(req)
        fresh = fallback.profile
      } catch (_) {
        fresh = { ...req.body }
      }
    }

    res.render('add-profile', {
      success: true,
      newProfileId: profileId || (fresh && fresh.id ? fresh.id : ''),
      profile: fresh,
      isAdminMode: false,
      isWizardMode: false,
      formAction: '/my-profile/edit'
    })
  } catch (err) {
    console.error(err)
    const ctx = await getMyProfileFormContext(req)
    const safeMsg = process.env.NODE_ENV === 'production'
      ? 'Could not save your profile. Try again in a moment.'
      : `Could not save your profile. (${err.message})`
    return res.render('add-profile', {
      success: false,
      isAdminMode: false,
      isWizardMode: false,
      formAction: '/my-profile/edit',
      error: safeMsg,
      ...ctx
    })
  }
})

registerGdAdRoutes(router, {
  db,
  ensureAuthenticated,
  isAdminUser,
  isGdAdScorer: isGdAdScorerUser,
  getProfileByUserId
})

module.exports = router
