const { SKILL_KEY_SET } = require('./constants')

const MAX_EVIDENCE_LENGTH = 12000

async function ensureGdadTable (db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS gdad_evidence_items (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skill_key VARCHAR(64) NOT NULL,
      evidence_text TEXT,
      evidence_updated_at TIMESTAMPTZ,
      official_score SMALLINT,
      scored_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      scored_at TIMESTAMPTZ,
      UNIQUE (user_id, skill_key),
      CONSTRAINT gdad_official_score_range CHECK (official_score IS NULL OR official_score IN (1, 2, 3))
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_gdad_evidence_user_id ON gdad_evidence_items (user_id)`)
}

async function listEvidenceForUser (db, userId) {
  const res = await db.query(
    `SELECT skill_key, evidence_text, evidence_updated_at, official_score, scored_by_user_id, scored_at
     FROM gdad_evidence_items WHERE user_id = $1`,
    [userId]
  )
  const map = new Map()
  res.rows.forEach((row) => map.set(row.skill_key, row))
  return map
}

function sanitiseEvidencePayload (body) {
  const out = {}
  if (!body || typeof body !== 'object') return out
  for (const key of SKILL_KEY_SET) {
    const raw = body[`evidence_${key}`]
    if (raw === undefined) continue
    const s = String(raw || '').trim()
    if (s.length > MAX_EVIDENCE_LENGTH) {
      const err = new Error('evidence_too_long')
      err.skillKey = key
      throw err
    }
    out[key] = s
  }
  return out
}

/** Save every skill key (use when submitting the full form so empty fields clear stored text). */
function sanitiseEvidencePayloadFullForm (body) {
  const out = {}
  if (!body || typeof body !== 'object') return out
  for (const key of SKILL_KEY_SET) {
    const raw = body[`evidence_${key}`]
    const s = String(raw == null ? '' : raw).trim()
    if (s.length > MAX_EVIDENCE_LENGTH) {
      const err = new Error('evidence_too_long')
      err.skillKey = key
      throw err
    }
    out[key] = s
  }
  return out
}

/** One skill only — for POST /my-gdad-evidence/:skillKey */
function sanitiseEvidencePayloadSingleSkill (body, skillKey) {
  if (!SKILL_KEY_SET.has(skillKey)) {
    const err = new Error('invalid_skill')
    err.skillKey = skillKey
    throw err
  }
  const raw = body && body[`evidence_${skillKey}`]
  const s = String(raw == null ? '' : raw).trim()
  if (s.length > MAX_EVIDENCE_LENGTH) {
    const err = new Error('evidence_too_long')
    err.skillKey = skillKey
    throw err
  }
  return { [skillKey]: s }
}

function sanitiseScorePayload (body) {
  const out = {}
  if (!body || typeof body !== 'object') return out
  for (const key of SKILL_KEY_SET) {
    const raw = body[`score_${key}`]
    if (raw === undefined || raw === '' || raw === null) {
      out[key] = null
      continue
    }
    const n = Number(raw)
    if (![1, 2, 3].includes(n)) {
      const err = new Error('invalid_score')
      err.skillKey = key
      throw err
    }
    out[key] = n
  }
  return out
}

async function upsertEvidenceForUser (db, userId, evidenceBySkill, actorUserId) {
  const now = new Date()
  for (const [skillKey, text] of Object.entries(evidenceBySkill)) {
    if (!SKILL_KEY_SET.has(skillKey)) continue
    await db.query(
      `INSERT INTO gdad_evidence_items (user_id, skill_key, evidence_text, evidence_updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, skill_key)
       DO UPDATE SET evidence_text = EXCLUDED.evidence_text, evidence_updated_at = EXCLUDED.evidence_updated_at`,
      [userId, skillKey, text || null, now]
    )
  }
}

async function upsertScoresForUser (db, targetUserId, scoresBySkill, scorerUserId) {
  const now = new Date()
  for (const key of SKILL_KEY_SET) {
    if (!Object.prototype.hasOwnProperty.call(scoresBySkill, key)) continue
    const score = scoresBySkill[key]
    await db.query(
      `INSERT INTO gdad_evidence_items (user_id, skill_key, official_score, scored_by_user_id, scored_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, skill_key)
       DO UPDATE SET official_score = EXCLUDED.official_score,
                     scored_by_user_id = EXCLUDED.scored_by_user_id,
                     scored_at = EXCLUDED.scored_at`,
      [targetUserId, key, score, score === null || score === undefined ? null : scorerUserId, score === null || score === undefined ? null : now]
    )
  }
}

module.exports = {
  MAX_EVIDENCE_LENGTH,
  ensureGdadTable,
  listEvidenceForUser,
  sanitiseEvidencePayload,
  sanitiseEvidencePayloadFullForm,
  sanitiseEvidencePayloadSingleSkill,
  sanitiseScorePayload,
  upsertEvidenceForUser,
  upsertScoresForUser
}
