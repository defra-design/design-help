//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()
const session = require('express-session')
const pgSession = require('connect-pg-simple')(session)
const passport = require('passport')
const LocalStrategy = require('passport-local').Strategy
const bcrypt = require('bcrypt')
const db = require('./db')
const { sendVerificationEmail, isNotifyConfigured } = require('./notify')
const crypto = require('crypto')
const authBypassEnabled = process.env.NODE_ENV !== 'production' && process.env.AUTH_BYPASS !== 'false'
const authBypassUser = {
  id: Number(process.env.AUTH_BYPASS_USER_ID || 16),
  email: process.env.AUTH_BYPASS_EMAIL || 'Pete@defra.gov.uk',
  name: process.env.AUTH_BYPASS_NAME || 'Peter Smith',
  is_verified: true
}
let resolvedAuthBypassUser = null
const hardcodedAdminEmails = [
  'pete.smith@defra.gov.uk',
  'chris.hawker@defra.gov.uk',
  'louise.tudor@defra.gov.uk'
]
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : hardcodedAdminEmails)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
)
const defaultApprovedEmails = [
  'pete.smith@defra.gov.uk',
  'chris.hawker@defra.gov.uk',
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

function verifyEmailPageLocals (req, { email, error = null } = {}) {
  const showDevCode = process.env.NODE_ENV !== 'production' && Boolean(req.session && req.session.debugCode)
  return {
    email,
    error,
    devVerificationCode: showDevCode ? req.session.debugCode : null
  }
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
  if (!raw) {
    return []
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => item && item.trim()).filter(Boolean)
  }
  return String(raw).split(',').map((item) => item.trim()).filter(Boolean)
}

async function getMyProfileFormContext (req) {
  const { name, canHelpWithTags, developmentGoalsTags } = req.body
  const profile = {
    ...req.body,
    can_help_with: Array.isArray(canHelpWithTags) ? canHelpWithTags.map((t) => t && t.trim()).filter(Boolean) : parseTagList(canHelpWithTags),
    development_goals: Array.isArray(developmentGoalsTags) ? developmentGoalsTags.map((t) => t && t.trim()).filter(Boolean) : parseTagList(developmentGoalsTags)
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
    profile.can_help_with = profile.can_help_with || []
    profile.development_goals = profile.development_goals || []
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
    '/public',
    '/assets',
    '/govuk-frontend',
    '/plugin-assets'
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

// Make user available in templates
router.use((req, res, next) => {
  res.locals.user = req.user
  res.locals.isAdmin = isAdminUser(req.user)
  res.locals.currentPath = req.path
  res.locals.isProduction = process.env.NODE_ENV === 'production'
  next()
})

// --- AUTH ROUTES ---

router.get('/login', (req, res) => {
  if (authBypassEnabled) {
    return res.redirect('/browse')
  }

  res.render('login', { error: req.session.messages ? req.session.messages[0] : null })
  req.session.messages = [] // Clear messages
})

router.post('/login', passport.authenticate('local', {
  successRedirect: '/browse',
  failureRedirect: '/login',
  failureMessage: true
}))

router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err) }
    res.redirect('/')
  })
})

router.get('/register', (req, res) => {
  res.render('register')
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
      const approvedRes = await db.query('SELECT 1 FROM approved_emails WHERE email = $1 LIMIT 1', [emailLower])
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

    if (isNotifyConfigured()) {
      try {
        await sendVerificationEmail(emailLower, verificationCode)
      } catch (notifyErr) {
        console.error('Notify send failed', notifyErr)
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
    } else {
      // Local / dev: no API keys; log and optionally show a dev-only code in the verify UI
      console.log('---------------------------------------------------')
      console.log(`EMAIL SIMULATION: Verification code for ${emailLower} is: ${verificationCode}`)
      console.log('---------------------------------------------------')
    }

    req.session.registrationEmail = emailLower
    if (process.env.NODE_ENV !== 'production' && !isNotifyConfigured()) {
      req.session.debugCode = verificationCode
    } else {
      delete req.session.debugCode
    }
    res.redirect('/verify-email')

  } catch (err) {
    console.error(err)
    if (err.code === '23505') { // Unique violation
      res.render('register', { error: 'Email already exists.' })
    } else {
      const hint = (err && err.message) ? ` (${err.message})` : ''
      res.render('register', { error: `An error occurred.${hint}` })
    }
  }
})

// Verification Routes
router.get('/verify-email', (req, res) => {
  res.render('verify-email', verifyEmailPageLocals(req, {
    email: req.session.registrationEmail,
    error: req.session.messages ? req.session.messages[0] : null
  }))
  req.session.messages = []
})

router.post('/verify-email', async (req, res) => {
  const { email, code } = req.body

  try {
    const resDb = await db.query('SELECT * FROM users WHERE email = $1', [email])
    if (resDb.rows.length === 0) {
      return res.render('verify-email', verifyEmailPageLocals(req, { email, error: 'User not found.' }))
    }

    const user = resDb.rows[0]

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
        name: profile.name,
        role: profile.role,
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
          name: null,
          role: null,
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
    return res.render('admin-users', {
      rows,
      changes
    })
  } catch (err) {
    console.error(err)
    return res.status(500).send('Error loading admin users')
  }
})

router.post('/admin/approved-emails', ensureAdmin, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  if (!email || !email.endsWith('@defra.gov.uk')) {
    return res.redirect('/admin/users')
  }
  try {
    await db.query('INSERT INTO approved_emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email])
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
    name, projectTeam, deliveryGroup, role, availabilityStatus, location, experience, about, linkedinProfile, canHelpWithTags, canHelpWithText, developmentGoalsTags, developmentGoalsText
  } = req.body
  const normalisedRole = normaliseAllowedRole(role)
  const normalisedAvailabilityStatus = normaliseAvailabilityStatus(availabilityStatus)
  const profileModel = {
    ...req.body,
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
  try {
    await db.query(`
      UPDATE profiles SET
        name = $1, project_team = $2, delivery_group = $3, role = $4, location = $5,
        experience = $6, bio = $7, linkedin_profile = $8, can_help_with = $9, can_help_with_text = $10,
        development_goals = $11, development_goals_text = $12, availability_status = $13
      WHERE id = $14
    `, [
      name, projectTeam || null, deliveryGroup || null, normalisedRole, location,
      experience, about || null, linkedinProfile || null, parseList(canHelpWithTags), canHelpWithText || null,
      parseList(developmentGoalsTags), developmentGoalsText || null, normalisedAvailabilityStatus, req.params.id
    ])
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
  const wizardStep = getWizardStep(req.query.step)
  const draft = req.session.adminProfileDraft || {}
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
    adminReturnUrl: '/admin/users'
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
    name, projectTeam, deliveryGroup, role, availabilityStatus, location, experience, about, linkedinProfile, canHelpWithTags, canHelpWithText, developmentGoalsTags, developmentGoalsText
  } = req.body
  const step = getWizardStep(req.body.step)
  const action = req.body.action
  const normalisedRole = normaliseAllowedRole(role)
  const normalisedAvailabilityStatus = normaliseAvailabilityStatus(availabilityStatus)
  const updatedDraft = { ...(req.session.adminProfileDraft || {}) }
  if (name !== undefined) updatedDraft.name = name
  if (projectTeam !== undefined) updatedDraft.project_team = projectTeam
  if (deliveryGroup !== undefined) updatedDraft.delivery_group = deliveryGroup
  if (role !== undefined) updatedDraft.role = normalisedRole || role
  if (location !== undefined) updatedDraft.location = location
  if (availabilityStatus !== undefined) updatedDraft.availability_status = normalisedAvailabilityStatus || availabilityStatus
  if (experience !== undefined) updatedDraft.experience = experience
  if (about !== undefined) updatedDraft.bio = about
  if (linkedinProfile !== undefined) updatedDraft.linkedin_profile = linkedinProfile
  if (canHelpWithTags !== undefined) updatedDraft.can_help_with = parseList(canHelpWithTags)
  if (canHelpWithText !== undefined) updatedDraft.can_help_with_text = canHelpWithText
  if (developmentGoalsTags !== undefined) updatedDraft.development_goals = parseList(developmentGoalsTags)
  if (developmentGoalsText !== undefined) updatedDraft.development_goals_text = developmentGoalsText

  if (action === 'previous') {
    req.session.adminProfileDraft = updatedDraft
    const prev = getPreviousStep(step) || 'details'
    return res.redirect(`/admin/add-profile?step=${prev}`)
  }

  const canHelpWithTextWords = wordCount(canHelpWithText)
  const developmentGoalsTextWords = wordCount(developmentGoalsText)
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
      error: 'Additional details must be 150 words or fewer for both "Can help with" and "Development goals".',
      profile: updatedDraft
    })
  }
  if (step === 'details' && !normalisedRole) {
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
      error: 'Select a valid GDaD job title from the list.',
      profile: updatedDraft
    })
  }
  if (step === 'details' && !normalisedAvailabilityStatus) {
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
      error: 'Select a valid availability status from the list.',
      profile: updatedDraft
    })
  }
  if (step === 'details' && (!name || !location || !experience)) {
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
      error: 'Name, job title, location and experience are required.',
      profile: updatedDraft
    })
  }

  req.session.adminProfileDraft = updatedDraft
  const nextStep = getNextStep(step)
  if (nextStep) {
    return res.redirect(`/admin/add-profile?step=${nextStep}`)
  }

  try {
    const profileId = `${updatedDraft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}`
    await db.query(`
      INSERT INTO profiles (
        id, user_id, name, project_team, delivery_group, role, location, experience, bio,
        linkedin_profile, can_help_with, can_help_with_text, development_goals, development_goals_text, availability_status
      ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
      profileId, updatedDraft.name, updatedDraft.project_team || null, updatedDraft.delivery_group || null, normaliseAllowedRole(updatedDraft.role), updatedDraft.location, updatedDraft.experience, updatedDraft.bio || null,
      updatedDraft.linkedin_profile || null, updatedDraft.can_help_with, updatedDraft.can_help_with_text || null, updatedDraft.development_goals, updatedDraft.development_goals_text || null, normaliseAvailabilityStatus(updatedDraft.availability_status) || 'Some capacity'
    ])
    req.session.adminProfileDraft = null
    trackAdminChange(req, 'added', profileId)
    return res.redirect('/admin/users')
  } catch (err) {
    console.error(err)
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
      error: 'Error saving profile',
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
  let matchedHelpers = []
  let userDevelopmentGoals = []
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
    if (req.user && req.user.id) {
      const myProfileRes = await db.query('SELECT id, development_goals FROM profiles WHERE user_id = $1 LIMIT 1', [req.user.id])
      const myProfile = myProfileRes.rows[0]
      if (myProfile && Array.isArray(myProfile.development_goals) && myProfile.development_goals.length > 0) {
        userDevelopmentGoals = myProfile.development_goals
        const helperRes = await db.query(`
          SELECT * FROM profiles
          WHERE id != $1
            AND can_help_with && $2::text[]
          ORDER BY name ASC
          LIMIT 12
        `, [myProfile.id, myProfile.development_goals])

        matchedHelpers = helperRes.rows.map((member) => {
          const helperTags = Array.isArray(member.can_help_with) ? member.can_help_with : []
          const sharedTags = helperTags.filter((tag) => myProfile.development_goals.includes(tag))
          return {
            ...member,
            shared_tags: sharedTags
          }
        })
      }
    }

    if (filter) {
      // Simple search query matching JSON logic
      const query = `
         SELECT * FROM profiles 
         WHERE 
           array_to_string(can_help_with, ' ') ILIKE $1 OR
           COALESCE(can_help_with_text, '') ILIKE $1 OR
           array_to_string(development_goals, ' ') ILIKE $1 OR
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
    matchedHelpers: matchedHelpers,
    userDevelopmentGoals: userDevelopmentGoals,
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
  // Parsing lists
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
        experience, about || null, linkedinProfile || null, parseList(canHelpWithTags), canHelpWithText || null,
        parseList(developmentGoalsTags), developmentGoalsText || null, normalisedAvailabilityStatus,
        userId
      ])
    } else {
      profileId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      await db.query(`
            INSERT INTO profiles (
                id, user_id, name, project_team, delivery_group, role, location, experience, bio,
                linkedin_profile, can_help_with, can_help_with_text, development_goals, development_goals_text, availability_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          `, [
        profileId, userId, name, projectTeam || null, deliveryGroup || null, normalisedRole, location, experience, about || null,
        linkedinProfile || null, parseList(canHelpWithTags), canHelpWithText || null, parseList(developmentGoalsTags), developmentGoalsText || null, normalisedAvailabilityStatus
      ])
    }

    const fresh = await getProfileForUser(userId)

    res.render('add-profile', {
      success: true,
      newProfileId: profileId,
      profile: fresh || { ...req.body },
      isAdminMode: false,
      isWizardMode: false,
      formAction: '/my-profile/edit'
    })
  } catch (err) {
    console.error(err)
    const ctx = await getMyProfileFormContext(req)
    return res.render('add-profile', {
      success: false,
      isAdminMode: false,
      isWizardMode: false,
      formAction: '/my-profile/edit',
      error: 'Error saving profile',
      ...ctx
    })
  }
})

module.exports = router
