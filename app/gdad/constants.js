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
  (process.env.GDAD_SCORER_EMAILS ? process.env.GDAD_SCORER_EMAILS.split(',') : '')
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
 * Three bands used in the UI (aligned with DDaT “Working”, “Practitioner”, “Expert” and
 * the internal SEO / G7 / G6 matrix). Short summaries — full wording is on the framework site.
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
  isAccessibilityOnlyRole,
  isGdAdEvidenceApplicableRole,
  isGdAdScorer,
  gdadScorerEmails
}
