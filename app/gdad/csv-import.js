const { parse } = require('csv-parse/sync')

const SKILL_NAME_TO_KEY = new Map([
  ['design communication', 'design_communication'],
  ['designing for everyone', 'designing_for_everyone'],
  ['designing strategically', 'designing_strategically'],
  ['designing together', 'designing_together'],
  ['evidence-based design', 'evidence_based_design'],
  ['evidence based design', 'evidence_based_design'],
  ['iterative design', 'iterative_design'],
  ['leading design', 'leading_design']
])

function normaliseSkillName (value) {
  return String(value || '')
    .replace(/\uFEFF/g, '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean)
    ?.toLowerCase() || ''
}

function sanitiseField (value) {
  return String(value == null ? '' : value).trim()
}

function buildStarEvidence (situation, task, action, result) {
  const parts = []
  if (situation) parts.push(`Situation: ${situation}`)
  if (task) parts.push(`Task: ${task}`)
  if (action) parts.push(`Action: ${action}`)
  if (result) parts.push(`Result: ${result}`)
  return parts.join('\n\n').trim()
}

function parseGdadTemplateCsv (csvText) {
  const rows = parse(csvText, {
    relax_column_count: true,
    skip_empty_lines: false
  })

  const evidenceBySkill = {}
  const importedSkillKeys = new Set()

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue

    const skillName = normaliseSkillName(row[0])
    const skillKey = SKILL_NAME_TO_KEY.get(skillName)
    if (!skillKey) continue

    const situation = sanitiseField(row[1])
    const task = sanitiseField(row[2])
    const action = sanitiseField(row[3])
    const result = sanitiseField(row[4])
    const evidence = buildStarEvidence(situation, task, action, result)

    evidenceBySkill[skillKey] = evidence
    importedSkillKeys.add(skillKey)
  }

  return {
    evidenceBySkill,
    importedSkillKeys: Array.from(importedSkillKeys)
  }
}

module.exports = {
  parseGdadTemplateCsv
}
