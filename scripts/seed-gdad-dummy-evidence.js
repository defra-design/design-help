/**
 * Populate local PostgreSQL with dummy designer profiles and placeholder GDaD evidence
 * so you can exercise the admin review screens. Uses DATABASE_URL from .env.
 *
 * Creates several @defra.gov.uk dummy accounts (local only) with varied job titles:
 * - full evidence (7 skills), partial (3 skills), none (eligible but empty)
 * - plus your existing eligible users get full evidence unless --email filters to one.
 *
 * Dummy logins (if you need to sign in): password is `password` for each dummy user.
 *
 * Usage: npm run seed:gdad
 *        node scripts/seed-gdad-dummy-evidence.js --email=one@defra.gov.uk
 */

require('dotenv').config()
const bcrypt = require('bcrypt')
const db = require('../app/db')
const { ensureGdadTable } = require('../app/gdad/evidence-store')
const { SKILLS, isGdAdEvidenceApplicableRole } = require('../app/gdad/constants')

/**
 * Profiles created/updated for local GDaD admin testing.
 * evidenceSkills: 'all' | 'none' | array of skill_key strings (partial submission).
 */
const DUMMY_DESIGNER_ACCOUNTS = [
  {
    email: 'gdad.dummy.full@defra.gov.uk',
    name: 'Alex River',
    role: 'Service Designer',
    profileId: 'gdad-dummy-alex-river',
    evidenceSkills: 'all'
  },
  {
    email: 'gdad.dummy.partial@defra.gov.uk',
    name: 'Blake Moor',
    role: 'Senior Service Designer',
    profileId: 'gdad-dummy-blake-moor',
    evidenceSkills: ['design_communication', 'evidence_based_design', 'leading_design']
  },
  {
    email: 'gdad.dummy.empty@defra.gov.uk',
    name: 'Casey Vale',
    role: 'Interaction Designer',
    profileId: 'gdad-dummy-casey-vale',
    evidenceSkills: 'none'
  },
  {
    email: 'gdad.dummy.principal@defra.gov.uk',
    name: 'Drew Peak',
    role: 'Principal Service Designer',
    profileId: 'gdad-dummy-drew-peak',
    evidenceSkills: 'all'
  },
  {
    email: 'gdad.dummy.senior-ix@defra.gov.uk',
    name: 'Eden Brook',
    role: 'Senior Interaction Designer',
    profileId: 'gdad-dummy-eden-brook',
    evidenceSkills: ['designing_strategically', 'designing_together', 'iterative_design', 'designing_for_everyone']
  }
]

const DUMMY_PASSWORD_PLAINTEXT = 'password'

const evidencePlanByEmail = new Map(
  DUMMY_DESIGNER_ACCOUNTS.map((d) => [d.email.toLowerCase(), d.evidenceSkills])
)

const dummyEmailSet = new Set(DUMMY_DESIGNER_ACCOUNTS.map((d) => d.email.toLowerCase()))

/** ~150–220 words each — under the 400-word guidance */
const DUMMY_TEXT = {
  design_communication: `Situation: Our service team was split on whether to launch a minimal journey or wait for full policy sign-off. Stakeholders were receiving conflicting messages from design and delivery.

Task: I needed to align everyone on a single narrative before the governance board, without delaying the private beta date.

Action: I ran a 45-minute walkthrough of the prototype for policy and operations, using annotated screens and a one-page decision record. I translated technical constraints into outcomes for users and recorded agreed wording in Confluence. I followed up with a short film for people who could not attend live.

Result: The board approved the scoped release. Policy used our language in their briefings and we avoided a two-week slip. Two teams reused the decision record as a template for their own services.`,

  designing_for_everyone: `Situation: User research showed that farmers using assistive technology were skipping a critical declaration step in the rural grants journey.

Task: I was asked to improve completion rates while keeping the legal wording intact.

Action: I paired with our accessibility specialist to retest with three participants who use screen readers. We simplified heading structure, exposed error summaries in a single landmark, and checked colour contrast on every state. I documented patterns in our design system backlog and raised two bugs with the component library team.

Result: Task completion in the research rounds went from four out of six to six out of six. The changes shipped in the next release and were picked up by a sister service without extra design time.`,

  designing_strategically: `Situation: Leadership wanted a clearer link between our quarterly roadmap and the organisation’s environmental outcomes targets.

Task: I needed to show how our product work supported wider strategy without creating another slide deck nobody would read.

Action: I mapped our epics to outcome measures we already report to GDS and added a thin “strategy line” on the roadmap board. I ran a workshop with service owners to stress-test priorities against risk and dependency data we already hold.

Result: Portfolio planning dropped one low-impact initiative and reallocated a designer to a higher-risk dependency. Directors cited the map in a cross-government forum.`,

  designing_together: `Situation: Content, policy, and development were iterating separately on the same forms, causing rework every sprint.

Task: I needed a lightweight rhythm so we could review flows together without blocking delivery.

Action: I introduced a weekly design crit open to all disciplines, with a shared Miro board and a rotating facilitator. I agreed entry criteria so only flows with a hypothesis and user need attended. I captured actions in Jira with clear owners.

Result: Duplicate work fell sharply; three services adopted the same format. Policy said they understood design constraints earlier in the cycle.`,

  evidence_based_design: `Situation: Analytics showed a sharp drop-off on a postcode step, but we had no qualitative insight into why.

Task: Prove whether the problem was comprehension, validation, or something environmental (e.g. mobile signal).

Action: I drafted hypotheses and ran five short interviews plus a pop-up survey on the live service. I combined findings with funnel data and a quick unmoderated test of two label variants. I shared a one-page summary with recommendations and confidence levels.

Result: We changed the hint text and error pattern; completion improved by nine percentage points over four weeks. The research pack was reused for a related service assessment.`,

  iterative_design: `Situation: The team wanted to move from static wireframes to testable flows in two sprints.

Task: Balance fidelity so we could learn quickly without misleading users about what was built.

Action: I used the prototype kit to ship thin slices in review, then increased fidelity only where we had open questions. I time-boxed research rounds and fed changes back into the backlog with clear “learn vs build” labels. I retired outdated screens so the repo stayed trustworthy.

Result: We ran three rounds of testing in six weeks and cut scope on one feature that failed to meet user needs. Delivery had fewer surprises at sprint reviews.`,

  leading_design: `Situation: Junior designers were duplicating research plans and unsure when to escalate ethics or recruitment issues.

Task: Establish light-touch guidance without adding heavy process.

Action: I created a short checklist and ran two lunch-and-learn sessions. I paired on two research plans and gave written feedback within a day. I connected people with the central user research operations team when studies needed panel access.

Result: Plans reached a consistent standard; ethics questions surfaced earlier. One designer presented at community show-and-tell and two others shadowed senior sessions.`
}

function wordCount (s) {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

function parseArgs () {
  const out = { email: null }
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--email=')) out.email = a.slice('--email='.length).trim().toLowerCase()
  }
  return out
}

function getSkillKeysToSeed (userEmail) {
  const plan = evidencePlanByEmail.get(String(userEmail).toLowerCase())
  if (plan === undefined) {
    return SKILLS.map((s) => s.key)
  }
  if (plan === 'all') {
    return SKILLS.map((s) => s.key)
  }
  if (plan === 'none') {
    return []
  }
  return plan
}

async function ensureDummyDesignerAccounts (passwordHash) {
  for (const d of DUMMY_DESIGNER_ACCOUNTS) {
    let userId
    const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [d.email])
    if (existing.rows.length > 0) {
      userId = existing.rows[0].id
      await db.query(
        'UPDATE users SET password_hash = $1, is_verified = TRUE, verification_code = NULL WHERE id = $2',
        [passwordHash, userId]
      )
    } else {
      const created = await db.query(
        `INSERT INTO users (email, password_hash, is_verified, verification_code)
         VALUES ($1, $2, TRUE, NULL) RETURNING id`,
        [d.email, passwordHash]
      )
      userId = created.rows[0].id
    }

    await db.query(
      'INSERT INTO approved_emails (email) VALUES (LOWER($1)) ON CONFLICT (email) DO NOTHING',
      [d.email]
    )

    const prof = await db.query('SELECT id FROM profiles WHERE user_id = $1', [userId])
    if (prof.rows.length === 0) {
      await db.query(
        `INSERT INTO profiles (id, user_id, name, role, location, experience, availability_status, contact_email, can_help_with)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[])`,
        [
          d.profileId,
          userId,
          d.name,
          d.role,
          'York',
          'Dummy profile for local GDaD admin review testing',
          'Some capacity',
          d.email,
          []
        ]
      )
    } else {
      await db.query(
        `UPDATE profiles SET name = $1, role = $2, location = $3, experience = $4, contact_email = $5
         WHERE user_id = $6`,
        [d.name, d.role, 'York', 'Dummy profile for local GDaD admin review testing', d.email, userId]
      )
    }
    console.log(`Ensured dummy profile: ${d.email} (${d.name}, ${d.role})`)
  }
}

async function main () {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to .env (e.g. postgres://localhost:5432/design_help).')
    process.exit(1)
  }

  const { email: filterEmail } = parseArgs()

  await ensureGdadTable(db)

  const passwordHash = await bcrypt.hash(DUMMY_PASSWORD_PLAINTEXT, 10)
  await ensureDummyDesignerAccounts(passwordHash)

  const res = await db.query(
    `SELECT u.id AS user_id, u.email, p.name, p.role
     FROM users u
     INNER JOIN profiles p ON p.user_id = u.id
     ORDER BY u.id`
  )

  let rows = res.rows.filter((r) => isGdAdEvidenceApplicableRole(r.role))
  if (filterEmail) {
    rows = rows.filter((r) => String(r.email).toLowerCase() === filterEmail)
  }

  if (rows.length === 0) {
    console.error(
      filterEmail
        ? `No GDaD-eligible profile found for ${filterEmail}.`
        : 'No users with GDaD-eligible job titles found.'
    )
    process.exit(1)
  }

  const now = new Date()
  let totalUpserts = 0

  for (const user of rows) {
    const emailLower = String(user.email).toLowerCase()
    const skillKeys = getSkillKeysToSeed(user.email)

    if (dummyEmailSet.has(emailLower)) {
      await db.query('DELETE FROM gdad_evidence_items WHERE user_id = $1', [user.user_id])
    }

    if (skillKeys.length === 0) {
      console.log(`Skipped evidence (none): ${user.email} (${user.name}, ${user.role})`)
      continue
    }

    for (const key of skillKeys) {
      const text = DUMMY_TEXT[key]
      if (!text) continue
      const wc = wordCount(text)
      if (wc > 400) {
        console.warn(`Warning: ${key} dummy text is ${wc} words (target under 400).`)
      }
      await db.query(
        `INSERT INTO gdad_evidence_items (user_id, skill_key, evidence_text, evidence_updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, skill_key)
         DO UPDATE SET evidence_text = EXCLUDED.evidence_text, evidence_updated_at = EXCLUDED.evidence_updated_at`,
        [user.user_id, key, text, now]
      )
      totalUpserts++
    }
    console.log(`Seeded ${skillKeys.length} skill(s) for ${user.email} (${user.name}, ${user.role})`)
  }

  console.log(`Done. ${totalUpserts} evidence row(s) upserted across ${rows.length} user(s).`)
  console.log(`Dummy accounts use password: ${DUMMY_PASSWORD_PLAINTEXT}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => {
    db.pool.end()
  })
