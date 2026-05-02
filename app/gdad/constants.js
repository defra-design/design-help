/**
 * GDaD / DDaT design skills — seven skills aligned with the Government Digital and Data
 * Profession Capability Framework (see https://ddat-capability-framework.service.gov.uk/).
 * Accessibility-only job titles are excluded from evidence capture (see isAccessibilityOnlyRole).
 */

const FRAMEWORK_BASE = 'https://ddat-capability-framework.service.gov.uk'
const SKILLS_PATH = `${FRAMEWORK_BASE}/skills`

/** Job titles in this app that are not on the GDaD design skills path yet */
const ACCESSIBILITY_ONLY_ROLES = new Set([
  'Accessibility Specialist (SEO)',
  'Senior Accessibility Specialist (Grade 7)'
])

const gdadScorerEmails = new Set(
  (process.env.GDAD_SCORER_EMAILS ? process.env.GDAD_SCORER_EMAILS.split(',') : [])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean)
)

function isAccessibilityOnlyRole (role) {
  if (!role) return false
  return ACCESSIBILITY_ONLY_ROLES.has(String(role).trim())
}

/** True when this job title should see GDaD evidence features (must still have a profile). */
function isGdAdEvidenceApplicableRole (role) {
  if (!role || !String(role).trim()) return false
  return !isAccessibilityOnlyRole(role)
}

function isGdAdScorer (user) {
  return Boolean(user && user.email && gdadScorerEmails.has(String(user.email).toLowerCase()))
}

/**
 * Three bands (aligned with DDaT Working / Practitioner / Expert). Short summaries — full wording is on the framework site.
 */
const LEVEL_BANDS = [
  {
    key: 'working',
    label: 'Working',
    tagClass: 'govuk-tag--blue',
    description: 'Typical expectations at junior to mid grades (for example SEO). Align your STAR evidence to behaviours at this band unless your role profile points higher.'
  },
  {
    key: 'practitioner',
    label: 'Practitioner',
    tagClass: 'govuk-tag--yellow',
    description: 'Typical expectations at senior grades (for example G7). Demonstrate broader influence and complexity than “working”.'
  },
  {
    key: 'expert',
    label: 'Expert',
    tagClass: 'govuk-tag--green',
    description: 'Typical expectations at lead grades (for example G6). Organisation-wide or strategic impact.'
  }
]

/**
 * Maps profile job titles to framework “tracks”. Skill matrices follow the published role pages:
 * — https://ddat-capability-framework.service.gov.uk/role/service-designer
 * — https://ddat-capability-framework.service.gov.uk/role/interaction-designer
 * For levels 3–6, Working / Practitioner / Expert expectations per skill are the same on both pages (Aug 2025);
 * interaction-designer and service-designer tracks use aliased matrices below.
 */
const ROLE_TO_FRAMEWORK_TRACK = {
  'Interaction Designer': 'interaction_designer',
  'Service Designer': 'service_designer',
  'Senior Interaction Designer': 'senior_interaction_designer',
  'Senior Service Designer': 'senior_service_designer',
  'Principal Service Designer': 'lead_service_designer',
  'Design Manager': 'lead_service_designer',
  'Senior Resource Manager': 'lead_service_designer',
  'Head of Design': 'head_of_service_design'
}

const FRAMEWORK_TRACK_LABEL = {
  service_designer: 'Service designer',
  senior_service_designer: 'Senior service designer',
  lead_service_designer: 'Lead service designer',
  head_of_service_design: 'Head of service design',
  interaction_designer: 'Interaction designer',
  senior_interaction_designer: 'Senior interaction designer',
  lead_interaction_designer: 'Lead interaction designer',
  head_of_interaction_design: 'Head of interaction design'
}

/**
 * Per-skill expected level (working | practitioner | expert) from the service designer role tables.
 * Interaction designer role tables use the same pattern — alias tracks point here.
 */
const FRAMEWORK_TRACK_SKILL_LEVELS = {
  service_designer: {
    design_communication: 'working',
    designing_for_everyone: 'working',
    designing_strategically: 'working',
    designing_together: 'working',
    evidence_based_design: 'working',
    iterative_design: 'working',
    leading_design: 'working'
  },
  senior_service_designer: {
    design_communication: 'practitioner',
    designing_for_everyone: 'practitioner',
    designing_strategically: 'practitioner',
    designing_together: 'practitioner',
    evidence_based_design: 'practitioner',
    iterative_design: 'practitioner',
    leading_design: 'working'
  },
  lead_service_designer: {
    design_communication: 'expert',
    designing_for_everyone: 'expert',
    designing_strategically: 'practitioner',
    designing_together: 'expert',
    evidence_based_design: 'expert',
    iterative_design: 'expert',
    leading_design: 'practitioner'
  },
  head_of_service_design: {
    design_communication: 'expert',
    designing_for_everyone: 'expert',
    designing_strategically: 'expert',
    designing_together: 'expert',
    evidence_based_design: 'expert',
    iterative_design: 'expert',
    leading_design: 'expert'
  }
}

FRAMEWORK_TRACK_SKILL_LEVELS.interaction_designer = FRAMEWORK_TRACK_SKILL_LEVELS.service_designer
FRAMEWORK_TRACK_SKILL_LEVELS.senior_interaction_designer = FRAMEWORK_TRACK_SKILL_LEVELS.senior_service_designer
FRAMEWORK_TRACK_SKILL_LEVELS.lead_interaction_designer = FRAMEWORK_TRACK_SKILL_LEVELS.lead_service_designer
FRAMEWORK_TRACK_SKILL_LEVELS.head_of_interaction_design = FRAMEWORK_TRACK_SKILL_LEVELS.head_of_service_design

/** Profile job titles whose framework role page is interaction-designer (others default to service-designer). */
const JOB_TITLES_INTERACTION_DESIGNER_ROLE_PAGE = new Set([
  'Interaction Designer',
  'Senior Interaction Designer'
])

/** Served by app — local copy of team matrix PNG; canonical levels are from the framework role page. */
const GDAD_SKILLS_MATRIX_URL = '/gdad-reference/skills-matrix.png'

function getFrameworkTrackKeyForJobTitle (role) {
  if (!role) return 'service_designer'
  const trimmed = String(role).trim()
  return ROLE_TO_FRAMEWORK_TRACK[trimmed] || 'service_designer'
}

/** Human-readable DDaT role level label (interaction or service pathway), for UI copy. */
function getFrameworkRolePageLabel (role) {
  const track = getFrameworkTrackKeyForJobTitle(role)
  return FRAMEWORK_TRACK_LABEL[track] || FRAMEWORK_TRACK_LABEL.service_designer
}

/** Full URL to the relevant DDaT “role” page (interaction vs service designer pathway). */
function roleFrameworkPageUrl (profileRole) {
  if (profileRole && JOB_TITLES_INTERACTION_DESIGNER_ROLE_PAGE.has(String(profileRole).trim())) {
    return `${FRAMEWORK_BASE}/role/interaction-designer`
  }
  return `${FRAMEWORK_BASE}/role/service-designer`
}

function getExpectedLevelKeyForSkillAndRole (skillKey, role) {
  const track = getFrameworkTrackKeyForJobTitle(role)
  const matrix = FRAMEWORK_TRACK_SKILL_LEVELS[track]
  if (!matrix || !matrix[skillKey]) return 'working'
  return matrix[skillKey] || 'working'
}

function getExpectedBandForSkillAndRole (skillKey, role) {
  const levelKey = getExpectedLevelKeyForSkillAndRole(skillKey, role)
  return LEVEL_BANDS.find((b) => b.key === levelKey) || LEVEL_BANDS[0]
}

/** @deprecated Use getExpectedBandForSkillAndRole(skillKey, role); kept for callers that still use a single band. */
function getExpectedLevelKeyForRole (role) {
  return getExpectedLevelKeyForSkillAndRole('design_communication', role)
}

/** @deprecated Use getExpectedBandForSkillAndRole */
function getExpectedBandForRole (role) {
  return getExpectedBandForSkillAndRole('design_communication', role)
}

/**
 * Seven skills — keys match DB skill_key; frameworkHash is the on-page anchor on /skills.
 */
const SKILLS = [
  {
    key: 'design_communication',
    label: 'Design communication',
    frameworkHash: 'design-communication',
    starHint: 'Situation, task, action, result — focus on how you communicated design decisions and to whom.'
  },
  {
    key: 'designing_for_everyone',
    label: 'Designing for everyone',
    frameworkHash: 'designing-for-everyone',
    starHint: 'Inclusive, accessible and sustainable design — evidence of how you met user needs and standards.'
  },
  {
    key: 'designing_strategically',
    label: 'Designing strategically',
    frameworkHash: 'designing-strategically',
    starHint: 'How your work aligned to team and organisational goals, risks, opportunities, patterns or components.'
  },
  {
    key: 'designing_together',
    label: 'Designing together',
    frameworkHash: 'designing-together',
    starHint: 'Sessions, stakeholders, feedback, and collaboration across boundaries.'
  },
  {
    key: 'evidence_based_design',
    label: 'Evidence-based design',
    frameworkHash: 'evidence-based-design',
    starHint: 'Hypotheses, research, analytics or data you used to develop and test design ideas.'
  },
  {
    key: 'iterative_design',
    label: 'Iterative design',
    frameworkHash: 'iterative-design',
    starHint: 'Agile iteration, prototyping fidelity, patterns, and responding to change.'
  },
  {
    key: 'leading_design',
    label: 'Leading design',
    frameworkHash: 'leading-design',
    starHint: 'Leading, coordinating, mentoring, or influencing design practice and leadership.'
  }
]

const SKILL_KEY_SET = new Set(SKILLS.map((s) => s.key))

const SCORE_LABELS = {
  1: 'Below standard',
  2: 'At standard',
  3: 'Above standard'
}

function skillFrameworkUrl (frameworkHash) {
  return `${SKILLS_PATH}#${frameworkHash}`
}

function rolePageExamplesUrl () {
  return `${FRAMEWORK_BASE}/role/service-designer`
}

module.exports = {
  FRAMEWORK_BASE,
  SKILLS_PATH,
  SKILLS,
  SKILL_KEY_SET,
  LEVEL_BANDS,
  SCORE_LABELS,
  skillFrameworkUrl,
  rolePageExamplesUrl,
  roleFrameworkPageUrl,
  GDAD_SKILLS_MATRIX_URL,
  getFrameworkTrackKeyForJobTitle,
  getFrameworkRolePageLabel,
  getExpectedLevelKeyForSkillAndRole,
  getExpectedBandForSkillAndRole,
  getExpectedLevelKeyForRole,
  getExpectedBandForRole,
  isAccessibilityOnlyRole,
  isGdAdEvidenceApplicableRole,
  isGdAdScorer,
  gdadScorerEmails
}
