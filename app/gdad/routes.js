const path = require('path')
const {
  SKILLS,
  SCORE_LABELS,
  SKILL_KEY_SET,
  skillFrameworkUrl,
  roleFrameworkPageUrl,
  GDAD_SKILLS_MATRIX_URL,
  getFrameworkRolePageLabel,
  getExpectedBandForSkillAndRole,
  isGdAdEvidenceApplicableRole
} = require('./constants')

const GDAD_MATRIX_PNG = path.join(__dirname, '..', '..', 'reference', 'GDaD_2026-05-02_07-40-08.png')
const {
  MAX_EVIDENCE_LENGTH,
  listEvidenceForUser,
  sanitiseEvidencePayloadSingleSkill,
  sanitiseScorePayload,
  upsertEvidenceForUser,
  upsertScoresForUser
} = require('./evidence-store')

function formatGdadEvidenceTimestamp (value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function buildSkillRows (evidenceMap, profileJobRole) {
  return SKILLS.map((meta) => {
    const row = evidenceMap.get(meta.key) || {}
    const officialScore = row.official_score != null && row.official_score !== ''
      ? Number(row.official_score)
      : null
    const expectedBand = getExpectedBandForSkillAndRole(meta.key, profileJobRole)
    return {
      ...meta,
      frameworkUrl: skillFrameworkUrl(meta.frameworkHash),
      evidence_text: row.evidence_text || '',
      evidence_updated_at: row.evidence_updated_at,
      official_score: officialScore,
      score_label: officialScore ? SCORE_LABELS[officialScore] : null,
      expectedBand
    }
  })
}

function registerGdAdRoutes (router, deps) {
  const {
    db,
    ensureAuthenticated,
    isAdminUser,
    isGdAdScorer,
    getProfileByUserId
  } = deps

  function ensureGdAdEvidenceApplicable (req, res, next) {
    if (!req.user) {
      return res.redirect('/login')
    }
    const role = res.locals.profileJobRole
    if (!role) {
      return res.redirect('/my-profile/edit')
    }
    if (!isGdAdEvidenceApplicableRole(role)) {
      return res.status(403).render('gdad-not-applicable', {
        pageName: 'GDaD evidence'
      })
    }
    next()
  }

  function ensureScorerOrAdmin (req, res, next) {
    if (isAdminUser(req.user) || isGdAdScorer(req.user)) {
      return next()
    }
    return res.status(403).send('You do not have permission to set GDaD scores.')
  }

  router.get('/gdad-reference/skills-matrix.png', (req, res) => {
    res.type('png')
    res.sendFile(GDAD_MATRIX_PNG, (err) => {
      if (err) {
        console.error(err)
        if (!res.headersSent) res.status(404).send('Skills matrix image not found')
      }
    })
  })

  router.get('/my-gdad-evidence', ensureAuthenticated, ensureGdAdEvidenceApplicable, async (req, res) => {
    try {
      const evidenceMap = await listEvidenceForUser(db, req.user.id)
      const skillRows = buildSkillRows(evidenceMap, res.locals.profileJobRole)
      res.render('my-gdad-evidence-summary', {
        pageName: 'My GDaD evidence',
        skillRows,
        gdadSkillsMatrixUrl: GDAD_SKILLS_MATRIX_URL,
        frameworkRolePageUrl: roleFrameworkPageUrl(res.locals.profileJobRole),
        frameworkRoleLabel: getFrameworkRolePageLabel(res.locals.profileJobRole)
      })
    } catch (err) {
      console.error(err)
      res.status(500).send('Could not load GDaD evidence.')
    }
  })

  router.get('/my-gdad-evidence/:skillKey', ensureAuthenticated, ensureGdAdEvidenceApplicable, async (req, res) => {
    const skillKey = String(req.params.skillKey || '').trim()
    if (!SKILL_KEY_SET.has(skillKey)) {
      return res.status(404).send('Not found')
    }
    try {
      const evidenceMap = await listEvidenceForUser(db, req.user.id)
      const skillRows = buildSkillRows(evidenceMap, res.locals.profileJobRole)
      const skill = skillRows.find((s) => s.key === skillKey)
      if (!skill) {
        return res.status(500).send('Could not load skill.')
      }
      res.render('my-gdad-evidence-skill', {
        pageName: `${skill.label} — GDaD evidence`,
        skill,
        gdadSkillsMatrixUrl: GDAD_SKILLS_MATRIX_URL,
        frameworkRolePageUrl: roleFrameworkPageUrl(res.locals.profileJobRole),
        frameworkRoleLabel: getFrameworkRolePageLabel(res.locals.profileJobRole),
        error: null,
        justSaved: req.query.saved === '1'
      })
    } catch (err) {
      console.error(err)
      res.status(500).send('Could not load GDaD evidence.')
    }
  })

  router.post('/my-gdad-evidence/:skillKey', ensureAuthenticated, ensureGdAdEvidenceApplicable, async (req, res) => {
    const skillKey = String(req.params.skillKey || '').trim()
    if (!SKILL_KEY_SET.has(skillKey)) {
      return res.status(404).send('Not found')
    }
    try {
      const payload = sanitiseEvidencePayloadSingleSkill(req.body, skillKey)
      await upsertEvidenceForUser(db, req.user.id, payload, req.user.id)
      res.redirect(`/my-gdad-evidence/${encodeURIComponent(skillKey)}?saved=1`)
    } catch (err) {
      if (err.message === 'evidence_too_long') {
        const evidenceMap = await listEvidenceForUser(db, req.user.id)
        const skillRows = buildSkillRows(evidenceMap, res.locals.profileJobRole)
        const skill = skillRows.find((s) => s.key === skillKey)
        if (!skill) {
          return res.status(500).send('Could not load skill.')
        }
        return res.status(400).render('my-gdad-evidence-skill', {
          pageName: `${skill.label} — GDaD evidence`,
          skill,
          gdadSkillsMatrixUrl: GDAD_SKILLS_MATRIX_URL,
          frameworkRolePageUrl: roleFrameworkPageUrl(res.locals.profileJobRole),
          frameworkRoleLabel: getFrameworkRolePageLabel(res.locals.profileJobRole),
          error: `Evidence is too long (max ${MAX_EVIDENCE_LENGTH} characters).`,
          justSaved: false
        })
      }
      if (err.message === 'invalid_skill') {
        return res.status(404).send('Not found')
      }
      console.error(err)
      res.status(500).send('Could not save evidence.')
    }
  })

  router.get('/review/gdad-evidence', ensureAuthenticated, ensureScorerOrAdmin, async (req, res) => {
    try {
      const r = await db.query(`
        SELECT u.id AS user_id, p.name, p.role
        FROM profiles p
        INNER JOIN users u ON u.id = p.user_id
        ORDER BY LOWER(p.name)
      `)
      const eligible = r.rows.filter((row) => isGdAdEvidenceApplicableRole(row.role))

      const statsRes = await db.query(`
        SELECT user_id,
               COUNT(*)::int AS skills_with_evidence,
               MAX(evidence_updated_at) AS last_evidence_at
        FROM gdad_evidence_items
        WHERE evidence_text IS NOT NULL AND LENGTH(TRIM(evidence_text)) > 0
        GROUP BY user_id
      `)
      const statsByUser = new Map(statsRes.rows.map((row) => [row.user_id, row]))

      const rowsWithEvidence = eligible
        .filter((row) => statsByUser.has(row.user_id))
        .map((row) => {
          const s = statsByUser.get(row.user_id)
          return {
            ...row,
            skills_with_evidence: s.skills_with_evidence,
            last_evidence_at: s.last_evidence_at,
            last_evidence_label: formatGdadEvidenceTimestamp(s.last_evidence_at)
          }
        })
        .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }))

      const rowsNoEvidenceYet = eligible
        .filter((row) => !statsByUser.has(row.user_id))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }))

      res.render('review-gdad-index', {
        pageName: 'Review GDaD evidence',
        rowsWithEvidence,
        rowsNoEvidenceYet,
        skillCount: SKILLS.length
      })
    } catch (err) {
      console.error(err)
      res.status(500).send('Could not load list.')
    }
  })

  router.get('/review/gdad-evidence/:targetUserId', ensureAuthenticated, ensureScorerOrAdmin, async (req, res) => {
    const targetUserId = Number(req.params.targetUserId)
    if (!Number.isInteger(targetUserId) || targetUserId < 1) {
      return res.status(404).send('Not found')
    }
    try {
      const profile = await getProfileByUserId(targetUserId)
      if (!profile) {
        return res.status(404).send('No profile for this user.')
      }
      if (!isGdAdEvidenceApplicableRole(profile.role)) {
        return res.status(403).render('gdad-not-applicable', {
          pageName: 'GDaD evidence',
          adminContext: true,
          targetName: profile.name
        })
      }
      const evidenceMap = await listEvidenceForUser(db, targetUserId)
      const skillRows = buildSkillRows(evidenceMap, profile.role)
      res.render('admin-gdad-evidence', {
        pageName: `GDaD evidence — ${profile.name}`,
        skillRows,
        gdadSkillsMatrixUrl: GDAD_SKILLS_MATRIX_URL,
        roleExamplesUrl: roleFrameworkPageUrl(profile.role),
        frameworkRoleLabel: getFrameworkRolePageLabel(profile.role),
        targetUserId,
        targetName: profile.name,
        targetRole: profile.role,
        readOnlyScores: false
      })
    } catch (err) {
      console.error(err)
      res.status(500).send('Could not load evidence.')
    }
  })

  router.post('/review/gdad-evidence/:targetUserId', ensureAuthenticated, ensureScorerOrAdmin, async (req, res) => {
    const targetUserId = Number(req.params.targetUserId)
    if (!Number.isInteger(targetUserId) || targetUserId < 1) {
      return res.status(404).send('Not found')
    }
    try {
      const profile = await getProfileByUserId(targetUserId)
      if (!profile || !isGdAdEvidenceApplicableRole(profile.role)) {
        return res.status(403).send('Not applicable')
      }
      let scores
      try {
        scores = sanitiseScorePayload(req.body)
      } catch (e) {
        if (e.message === 'invalid_score') {
          return res.redirect(`/review/gdad-evidence/${targetUserId}?err=invalid`)
        }
        throw e
      }
      await upsertScoresForUser(db, targetUserId, scores, req.user.id)
      res.redirect(`/review/gdad-evidence/${targetUserId}`)
    } catch (err) {
      console.error(err)
      res.status(500).send('Could not save scores.')
    }
  })
}

module.exports = { registerGdAdRoutes, buildSkillRows }
