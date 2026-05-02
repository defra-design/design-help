const {
  SKILLS,
  SCORE_LABELS,
  skillFrameworkUrl,
  rolePageExamplesUrl,
  LEVEL_BANDS,
  isGdAdEvidenceApplicableRole
} = require('./constants')
const {
  MAX_EVIDENCE_LENGTH,
  listEvidenceForUser,
  sanitiseEvidencePayloadFullForm,
  sanitiseScorePayload,
  upsertEvidenceForUser,
  upsertScoresForUser
} = require('./evidence-store')

function buildSkillRows (evidenceMap) {
  return SKILLS.map((meta) => {
    const row = evidenceMap.get(meta.key) || {}
    const officialScore = row.official_score != null && row.official_score !== ''
      ? Number(row.official_score)
      : null
    return {
      ...meta,
      frameworkUrl: skillFrameworkUrl(meta.frameworkHash),
      evidence_text: row.evidence_text || '',
      evidence_updated_at: row.evidence_updated_at,
      official_score: officialScore,
      score_label: officialScore ? SCORE_LABELS[officialScore] : null
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

  router.get('/my-gdad-evidence', ensureAuthenticated, ensureGdAdEvidenceApplicable, async (req, res) => {
    try {
      const evidenceMap = await listEvidenceForUser(db, req.user.id)
      const skillRows = buildSkillRows(evidenceMap)
      res.render('my-gdad-evidence', {
        pageName: 'My GDaD evidence',
        skillRows,
        levelBands: LEVEL_BANDS,
        roleExamplesUrl: rolePageExamplesUrl(),
        readOnlyScores: true
      })
    } catch (err) {
      console.error(err)
      res.status(500).send('Could not load GDaD evidence.')
    }
  })

  router.post('/my-gdad-evidence', ensureAuthenticated, ensureGdAdEvidenceApplicable, async (req, res) => {
    try {
      const payload = sanitiseEvidencePayloadFullForm(req.body)
      await upsertEvidenceForUser(db, req.user.id, payload, req.user.id)
      res.redirect('/my-gdad-evidence')
    } catch (err) {
      if (err.message === 'evidence_too_long') {
        const evidenceMap = await listEvidenceForUser(db, req.user.id)
        return res.status(400).render('my-gdad-evidence', {
          pageName: 'My GDaD evidence',
          skillRows: buildSkillRows(evidenceMap),
          levelBands: LEVEL_BANDS,
          roleExamplesUrl: rolePageExamplesUrl(),
          readOnlyScores: true,
          error: `Evidence for one skill is too long (max ${MAX_EVIDENCE_LENGTH} characters).`
        })
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
      const rows = r.rows.filter((row) => isGdAdEvidenceApplicableRole(row.role))
      res.render('review-gdad-index', {
        pageName: 'Review GDaD evidence',
        rows
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
      const skillRows = buildSkillRows(evidenceMap)
      res.render('admin-gdad-evidence', {
        pageName: `GDaD evidence — ${profile.name}`,
        skillRows,
        levelBands: LEVEL_BANDS,
        roleExamplesUrl: rolePageExamplesUrl(),
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
