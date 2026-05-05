const path = require('path')
const multer = require('multer')
const {
  SKILLS,
  SCORE_LABELS,
  SKILL_KEY_SET,
  skillFrameworkUrl,
  roleFrameworkPageUrl,
  GDAD_SKILLS_MATRIX_URL,
  getFrameworkRolePageLabel,
  getExpectedBandForSkillAndRole,
  getGradedLevelForSkillScore,
  getCapabilityBandFromScores,
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
const { parseGdadTemplateCsv } = require('./csv-import')

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
})

const TEMPLATE_GRADE_CONFIG = {
  seo: { label: 'SEO', role: 'Service Designer' },
  g7: { label: 'G7', role: 'Senior Service Designer' },
  g6: { label: 'G6', role: 'Principal Service Designer' }
}

function csvEscape (value) {
  const s = String(value == null ? '' : value)
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function buildTemplateSkillCell (skill, role, gradeLabel) {
  const expectedBand = getExpectedBandForSkillAndRole(skill.key, role)
  return [
    `${skill.label}`,
    `${expectedBand.label.toUpperCase()} (${gradeLabel})`,
    expectedBand.description,
    `Framework: ${skillFrameworkUrl(skill.frameworkHash)}`
  ].join('\n\n')
}

function buildGradeTemplateCsv (gradeKey) {
  const cfg = TEMPLATE_GRADE_CONFIG[gradeKey]
  if (!cfg) return null

  const lines = ['SKILL,SITUATION,TASK,ACTION,RESULT,SCORES']
  for (const skill of SKILLS) {
    const skillCell = buildTemplateSkillCell(skill, cfg.role, cfg.label)
    const row = [
      skillCell,
      '',
      '',
      '',
      '',
      0
    ].map(csvEscape).join(',')
    lines.push(row)
  }
  return lines.join('\n')
}

const EXPORT_COLUMNS = [
  { key: 'design_communication', header: 'Design communication - E' },
  { key: 'designing_for_everyone', header: 'Designing for everyone - E' },
  { key: 'designing_strategically', header: 'Designing strategically - P' },
  { key: 'designing_together', header: 'Designing together - E' },
  { key: 'evidence_based_design', header: 'Evidence based design - E' },
  { key: 'iterative_design', header: 'Iterative design - E' },
  { key: 'leading_design', header: 'Leading design - P' }
]

function roleToExportGrade (role) {
  const r = String(role || '').trim()
  if (r === 'Interaction Designer' || r === 'Service Designer') return 'SEO'
  if (r === 'Senior Interaction Designer' || r === 'Senior Service Designer') return 'G7'
  if (r === 'Principal Service Designer' || r === 'Design Manager' || r === 'Head of Design') return 'G6'
  return ''
}

function roleToExportLabel (role) {
  const r = String(role || '').trim()
  if (r === 'Principal Service Designer') return 'Lead Service Designer'
  return r
}

function bestSixTotal (scores) {
  const valid = (scores || [])
    .map((s) => Number(s))
    .filter((s) => s === 1 || s === 2 || s === 3)
    .sort((a, b) => b - a)
  if (valid.length < 6) return ''
  return valid.slice(0, 6).reduce((sum, s) => sum + s, 0)
}

function buildAdminExportCsv (rows) {
  const header = [
    'Name',
    'Role',
    'Grade',
    ...EXPORT_COLUMNS.map((c) => c.header),
    'Total',
    'Capability Level',
    'Score Change',
    'Capability Level Change'
  ]
  const out = [header.map(csvEscape).join(',')]
  for (const row of rows) {
    const scoreList = EXPORT_COLUMNS.map((c) => row[c.key])
    const total = bestSixTotal(scoreList)
    const capabilityBand = total === '' ? null : getCapabilityBandFromScores(scoreList)
    const line = [
      row.name || '',
      roleToExportLabel(row.role),
      roleToExportGrade(row.role),
      ...scoreList.map((s) => (s == null ? '' : s)),
      total,
      capabilityBand && capabilityBand.ready && capabilityBand.band ? capabilityBand.band.level : '',
      '',
      ''
    ]
    out.push(line.map(csvEscape).join(','))
  }
  return out.join('\n')
}

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
    const gradedLevel = getGradedLevelForSkillScore(meta.key, profileJobRole, officialScore)
    return {
      ...meta,
      frameworkUrl: skillFrameworkUrl(meta.frameworkHash),
      evidence_text: row.evidence_text || '',
      evidence_updated_at: row.evidence_updated_at,
      official_score: officialScore,
      score_label: officialScore ? SCORE_LABELS[officialScore] : null,
      expectedBand,
      gradedLevel
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

  function isHeadOfDesignSelfReview (req, targetUserId) {
    const isSelf = req.user && Number(req.user.id) === Number(targetUserId)
    const role = String(res.locals.profileJobRole || '').trim()
    return Boolean(isSelf && role === 'Head of Design')
  }

  function canReviewAndScoreUser (req, targetUserId) {
    return Boolean(isAdminUser(req.user) || isGdAdScorer(req.user) || isHeadOfDesignSelfReview(req, targetUserId))
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

  router.get('/gdad-reference/template-:grade.csv', (req, res) => {
    const gradeKey = String(req.params.grade || '').trim().toLowerCase()
    const csv = buildGradeTemplateCsv(gradeKey)
    if (!csv) {
      return res.status(404).send('Template not found')
    }
    res.type('text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="DDAT-GDaD-template-${gradeKey.toUpperCase()}.csv"`)
    return res.send(csv)
  })

  router.get('/my-gdad-evidence', ensureAuthenticated, ensureGdAdEvidenceApplicable, async (req, res) => {
    try {
      const evidenceMap = await listEvidenceForUser(db, req.user.id)
      const skillRows = buildSkillRows(evidenceMap, res.locals.profileJobRole)
      const capabilityBand = getCapabilityBandFromScores(skillRows.map((s) => s.official_score))
      if (capabilityBand.ready) {
        capabilityBand.averageLabel = capabilityBand.average.toFixed(2)
      }
      res.render('my-gdad-evidence-summary', {
        pageName: 'My GDaD evidence',
        skillRows,
        capabilityBand,
        headOfDesignSelfReview: String(res.locals.profileJobRole || '').trim() === 'Head of Design',
        selfUserId: req.user.id,
        gdadSkillsMatrixUrl: GDAD_SKILLS_MATRIX_URL,
        frameworkRolePageUrl: roleFrameworkPageUrl(res.locals.profileJobRole),
        frameworkRoleLabel: getFrameworkRolePageLabel(res.locals.profileJobRole),
        csvImportUpdatedCount: Number(req.query.imported || 0)
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

  router.get('/my-gdad-evidence/import-csv', ensureAuthenticated, ensureGdAdEvidenceApplicable, (req, res) => {
    res.render('my-gdad-evidence-import', {
      pageName: 'Import GDaD evidence from CSV',
      error: null
    })
  })

  router.post('/my-gdad-evidence/import-csv', ensureAuthenticated, ensureGdAdEvidenceApplicable, uploadCsv.single('evidenceCsv'), async (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).render('my-gdad-evidence-import', {
          pageName: 'Import GDaD evidence from CSV',
          error: 'Choose a CSV file to upload.'
        })
      }

      const csvText = String(req.file.buffer || '').trim()
      if (!csvText) {
        return res.status(400).render('my-gdad-evidence-import', {
          pageName: 'Import GDaD evidence from CSV',
          error: 'The uploaded CSV is empty.'
        })
      }

      const { evidenceBySkill, importedSkillKeys } = parseGdadTemplateCsv(csvText)
      if (!importedSkillKeys.length) {
        return res.status(400).render('my-gdad-evidence-import', {
          pageName: 'Import GDaD evidence from CSV',
          error: 'Could not find any matching skills in this CSV template.'
        })
      }

      for (const [skillKey, text] of Object.entries(evidenceBySkill)) {
        if (String(text || '').length > MAX_EVIDENCE_LENGTH) {
          return res.status(400).render('my-gdad-evidence-import', {
            pageName: 'Import GDaD evidence from CSV',
            error: `Imported text for ${skillKey} is too long (max ${MAX_EVIDENCE_LENGTH} characters).`
          })
        }
      }

      await upsertEvidenceForUser(db, req.user.id, evidenceBySkill, req.user.id)
      return res.redirect(`/my-gdad-evidence?imported=${importedSkillKeys.length}`)
    } catch (err) {
      console.error(err)
      return res.status(400).render('my-gdad-evidence-import', {
        pageName: 'Import GDaD evidence from CSV',
        error: 'Could not parse this CSV. Use the reference template format and try again.'
      })
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
               COUNT(*) FILTER (WHERE official_score IS NOT NULL)::int AS skills_scored,
               MAX(evidence_updated_at) AS last_evidence_at
        FROM gdad_evidence_items
        WHERE evidence_text IS NOT NULL AND LENGTH(TRIM(evidence_text)) > 0
        GROUP BY user_id
      `)
      const statsByUser = new Map(statsRes.rows.map((row) => [row.user_id, row]))

      const eligibleWithStats = eligible
        .map((row) => {
          const s = statsByUser.get(row.user_id) || {}
          return {
            ...row,
            skills_with_evidence: Number(s.skills_with_evidence || 0),
            skills_scored: Number(s.skills_scored || 0),
            last_evidence_at: s.last_evidence_at,
            last_evidence_label: formatGdadEvidenceTimestamp(s.last_evidence_at)
          }
        })
        .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }))

      const rowsNoOrIncompleteEvidence = eligibleWithStats
        .filter((row) => row.skills_with_evidence < SKILLS.length)

      const rowsEvidenceUnscored = eligibleWithStats
        .filter((row) => row.skills_with_evidence >= SKILLS.length && row.skills_scored < SKILLS.length)

      const rowsScoredEvidence = eligibleWithStats
        .filter((row) => row.skills_scored >= SKILLS.length)

      res.render('review-gdad-index', {
        pageName: 'Review GDaD evidence',
        rowsNoOrIncompleteEvidence,
        rowsEvidenceUnscored,
        rowsScoredEvidence,
        skillCount: SKILLS.length
      })
    } catch (err) {
      console.error(err)
      res.status(500).send('Could not load list.')
    }
  })

  router.get('/review/gdad-evidence/export.csv', ensureAuthenticated, async (req, res) => {
    if (!isAdminUser(req.user)) {
      return res.status(403).send('Only admin users can export GDaD scores.')
    }
    try {
      const profilesRes = await db.query(`
        SELECT u.id AS user_id, p.name, p.role
        FROM profiles p
        INNER JOIN users u ON u.id = p.user_id
        ORDER BY LOWER(p.name)
      `)
      const eligible = profilesRes.rows.filter((row) => isGdAdEvidenceApplicableRole(row.role))
      const userIds = eligible.map((r) => Number(r.user_id))

      const scoresByUser = new Map()
      if (userIds.length) {
        const scoresRes = await db.query(
          `SELECT user_id, skill_key, official_score
           FROM gdad_evidence_items
           WHERE user_id = ANY($1::int[])`,
          [userIds]
        )
        for (const s of scoresRes.rows) {
          const k = Number(s.user_id)
          const row = scoresByUser.get(k) || {}
          row[s.skill_key] = s.official_score == null ? null : Number(s.official_score)
          scoresByUser.set(k, row)
        }
      }

      const exportRows = eligible.map((u) => {
        const scoreRow = scoresByUser.get(Number(u.user_id)) || {}
        const out = {
          name: u.name,
          role: u.role
        }
        for (const col of EXPORT_COLUMNS) {
          out[col.key] = Object.prototype.hasOwnProperty.call(scoreRow, col.key) ? scoreRow[col.key] : null
        }
        return out
      })

      const csv = buildAdminExportCsv(exportRows)
      res.type('text/csv')
      res.setHeader('Content-Disposition', 'attachment; filename="GDaD-admin-export.csv"')
      return res.send(csv)
    } catch (err) {
      console.error(err)
      return res.status(500).send('Could not export scores.')
    }
  })

  router.get('/review/gdad-evidence/:targetUserId', ensureAuthenticated, async (req, res) => {
    const targetUserId = Number(req.params.targetUserId)
    if (!Number.isInteger(targetUserId) || targetUserId < 1) {
      return res.status(404).send('Not found')
    }
    if (!canReviewAndScoreUser(req, targetUserId)) {
      return res.status(403).send('You do not have permission to set GDaD scores.')
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
        readOnlyScores: false,
        justSaved: req.query.saved === '1',
        error: req.query.err === 'invalid' ? 'Select valid score values (1, 2, 3 or Not set).' : null
      })
    } catch (err) {
      console.error(err)
      res.status(500).send('Could not load evidence.')
    }
  })

  router.post('/review/gdad-evidence/:targetUserId', ensureAuthenticated, async (req, res) => {
    const targetUserId = Number(req.params.targetUserId)
    if (!Number.isInteger(targetUserId) || targetUserId < 1) {
      return res.status(404).send('Not found')
    }
    if (!canReviewAndScoreUser(req, targetUserId)) {
      return res.status(403).send('You do not have permission to set GDaD scores.')
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
      res.redirect(`/review/gdad-evidence/${targetUserId}?saved=1`)
    } catch (err) {
      console.error(err)
      res.status(500).send('Could not save scores.')
    }
  })

  router.get('/review/gdad-evidence/:targetUserId/:skillKey', ensureAuthenticated, async (req, res) => {
    const targetUserId = Number(req.params.targetUserId)
    const skillKey = String(req.params.skillKey || '').trim()
    if (!Number.isInteger(targetUserId) || targetUserId < 1 || !SKILL_KEY_SET.has(skillKey)) {
      return res.status(404).send('Not found')
    }
    if (!canReviewAndScoreUser(req, targetUserId)) {
      return res.status(403).send('You do not have permission to set GDaD scores.')
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
      const skill = skillRows.find((s) => s.key === skillKey)
      if (!skill) return res.status(404).send('Not found')

      res.render('admin-gdad-evidence-skill', {
        pageName: `${skill.label} — ${profile.name} — GDaD evidence`,
        skill,
        targetUserId,
        targetName: profile.name,
        targetRole: profile.role,
        gdadSkillsMatrixUrl: GDAD_SKILLS_MATRIX_URL,
        roleExamplesUrl: roleFrameworkPageUrl(profile.role),
        frameworkRoleLabel: getFrameworkRolePageLabel(profile.role),
        justSaved: req.query.saved === '1',
        error: req.query.err === 'invalid' ? 'Select a valid score (1, 2, 3 or Not set).' : null
      })
    } catch (err) {
      console.error(err)
      res.status(500).send('Could not load skill evidence.')
    }
  })

  router.post('/review/gdad-evidence/:targetUserId/:skillKey', ensureAuthenticated, async (req, res) => {
    const targetUserId = Number(req.params.targetUserId)
    const skillKey = String(req.params.skillKey || '').trim()
    if (!Number.isInteger(targetUserId) || targetUserId < 1 || !SKILL_KEY_SET.has(skillKey)) {
      return res.status(404).send('Not found')
    }
    if (!canReviewAndScoreUser(req, targetUserId)) {
      return res.status(403).send('You do not have permission to set GDaD scores.')
    }
    try {
      const profile = await getProfileByUserId(targetUserId)
      if (!profile || !isGdAdEvidenceApplicableRole(profile.role)) {
        return res.status(403).send('Not applicable')
      }

      const raw = req.body ? req.body[`score_${skillKey}`] : undefined
      let score = null
      if (!(raw === undefined || raw === '' || raw === null)) {
        const n = Number(raw)
        if (![1, 2, 3].includes(n)) {
          return res.redirect(`/review/gdad-evidence/${targetUserId}/${encodeURIComponent(skillKey)}?err=invalid`)
        }
        score = n
      }

      await upsertScoresForUser(db, targetUserId, { [skillKey]: score }, req.user.id)
      res.redirect(`/review/gdad-evidence/${targetUserId}/${encodeURIComponent(skillKey)}?saved=1`)
    } catch (err) {
      console.error(err)
      res.status(500).send('Could not save score.')
    }
  })
}

module.exports = { registerGdAdRoutes, buildSkillRows }
