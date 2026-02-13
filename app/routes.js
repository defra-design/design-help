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
  next()
})

// Global Authentication Guard
router.use((req, res, next) => {
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
  if (req.isAuthenticated()) {
    return next()
  }
  res.redirect('/login')
}

// Make user available in templates
router.use((req, res, next) => {
  res.locals.user = req.user
  next()
})

// --- AUTH ROUTES ---

router.get('/login', (req, res) => {
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

  // Defra Email Check
  if (!username.endsWith('@defra.gov.uk')) {
    return res.render('register', { error: 'You must use a @defra.gov.uk email address.' })
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10)

    // Generate 6 digit code
    const crypto = require('crypto')
    const verificationCode = crypto.randomInt(100000, 999999).toString()

    // Create User (Unverified)
    const userRes = await db.query(
      'INSERT INTO users (email, password_hash, is_verified, verification_code) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, hashedPassword, false, verificationCode]
    )
    const userId = userRes.rows[0].id

    // Create Profile Stub
    const profileId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    await db.query(
      'INSERT INTO profiles (id, user_id, name, availability_status) VALUES ($1, $2, $3, $4)',
      [profileId, userId, name, 'Available']
    )

    // SIMULATE EMAIL SENDING
    console.log('---------------------------------------------------')
    console.log(`EMAIL SIMULATION: Verification code for ${username} is: ${verificationCode}`)
    console.log('---------------------------------------------------')

    // Store email in session to pre-fill verification page or identify user
    req.session.registrationEmail = username
    req.session.debugCode = verificationCode // For Dev UI display
    res.redirect('/verify-email')

  } catch (err) {
    console.error(err)
    if (err.code === '23505') { // Unique violation
      res.render('register', { error: 'Email already exists.' })
    } else {
      res.render('register', { error: 'An error occurred.' })
    }
  }
})

// Verification Routes
router.get('/verify-email', (req, res) => {
  res.render('verify-email', {
    email: req.session.registrationEmail,
    debugCode: req.session.debugCode, // Pass to view
    error: req.session.messages ? req.session.messages[0] : null
  })
  req.session.messages = []
})

router.post('/verify-email', async (req, res) => {
  const { email, code } = req.body

  try {
    const resDb = await db.query('SELECT * FROM users WHERE email = $1', [email])
    if (resDb.rows.length === 0) {
      return res.render('verify-email', { email, error: 'User not found.' })
    }

    const user = resDb.rows[0]

    if (user.verification_code === code) {
      // Success! Verify user
      await db.query('UPDATE users SET is_verified = TRUE, verification_code = NULL WHERE id = $1', [user.id])

      // Log them in
      req.login(user, (err) => {
        if (err) throw err
        res.redirect('/add-profile')
      })
    } else {
      res.render('verify-email', { email, error: 'Invalid verification code.' })
    }
  } catch (err) {
    console.error(err)
    res.render('verify-email', { email, error: 'An error occurred.' })
  }
})

// --- APP ROUTES ---

// Browse team members page with optional filtering
router.get('/browse', async (req, res) => {
  const filter = req.query.filter
  let filteredMembers = []

  try {
    if (filter) {
      // Simple search query matching JSON logic
      const query = `
         SELECT * FROM profiles 
         WHERE 
           array_to_string(skills, ' ') ILIKE $1 OR
           array_to_string(can_help_with, ' ') ILIKE $1 OR
           array_to_string(interests, ' ') ILIKE $1 OR
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

  res.render('browse', {
    filteredMembers: filteredMembers,
    filterText: filter
  })
})

// Individual profile pages
router.get('/profile/:id', async (req, res) => {
  const memberId = req.params.id
  try {
    const resDb = await db.query('SELECT * FROM profiles WHERE id = $1', [memberId])
    const member = resDb.rows[0]

    if (member) {
      res.render('profile', {
        member: member
      })
    } else {
      res.status(404).send('Profile not found')
    }
  } catch (err) {
    console.error(err)
    res.status(500).send('Error')
  }
})

// Add profile form - GET (Protected)
router.get('/add-profile', ensureAuthenticated, async (req, res) => {
  // If user already has a profile, pre-fill it? 
  // For implemented flow, let's just show the form.
  // Ideally we should fetch their existing profile if they have one.

  let profile = null
  try {
    const resDb = await db.query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id])
    profile = resDb.rows[0]
  } catch (err) {
    console.error(err)
  }

  res.render('add-profile', {
    success: false,
    profile: profile
  })
})

// Add profile form - POST (Protected)
router.post('/add-profile', ensureAuthenticated, async (req, res) => {
  // Parsing lists
  const parseList = (str) => {
    return str ? str.split(',').map(item => item.trim()).filter(item => item) : []
  }

  const {
    name, role, skills, availability, location, experience, bio, canHelpWith, interests
  } = req.body

  let busyUntil = null
  if (availability === 'Busy') {
    const day = req.body['busy-until-day']
    const month = req.body['busy-until-month']
    const year = req.body['busy-until-year']
    if (day && month && year) {
      busyUntil = `${year}-${month}-${day}`
    }
  }

  try {
    const userId = req.user.id
    let profileId = ''

    const existingRes = await db.query('SELECT id FROM profiles WHERE user_id = $1', [userId])

    if (existingRes.rows.length > 0) {
      profileId = existingRes.rows[0].id

      await db.query(`
            UPDATE profiles SET
                name = $1, role = $2, skills = $3, availability_status = $4, location = $5,
                experience = $6, bio = $7, can_help_with = $8, interests = $9, busy_until = $10
            WHERE user_id = $11
          `, [
        name, role, parseList(skills), availability, location,
        experience, bio, parseList(canHelpWith), parseList(interests), busyUntil,
        userId
      ])

    } else {
      // Should not happen if registered via app, but robust fallback
      profileId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      await db.query(`
            INSERT INTO profiles (
                id, user_id, name, role, skills, availability_status, location,
                experience, bio, can_help_with, interests, busy_until
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `, [
        profileId, userId, name, role, parseList(skills), availability, location,
        experience, bio, parseList(canHelpWith), parseList(interests), busyUntil
      ])
    }

    // Fetch the updated profile to display back
    const updatedProfile = {
      ...req.body,
      busy_until: busyUntil,
      availability_status: availability
    }

    res.render('add-profile', {
      success: true,
      newProfileId: profileId,
      profile: updatedProfile
    })

  } catch (err) {
    console.error(err)
    res.render('add-profile', {
      success: false,
      error: 'Error saving profile',
      profile: req.body
    })
  }
})

module.exports = router
