const { NotifyClient } = require('notifications-node-client')

function isNotifyConfigured () {
  return Boolean(process.env.NOTIFY_API_KEY && process.env.NOTIFY_TEMPLATE_ID)
}

function isFeedbackNotifyConfigured () {
  return Boolean(process.env.NOTIFY_API_KEY && process.env.NOTIFY_FEEDBACK_TEMPLATE_ID)
}

/**
 * @param {string} emailAddress
 * @param {string} code
 * @returns {Promise<void>}
 */
function logNotifyApiFailure (phase, emailAddress, err) {
  /** Axios-style errors from notifications-node-client */
  const status = err && err.response && err.response.status
  const body = err && err.response && err.response.data
  const concise = body && typeof body === 'object' ? body.errors || body.detail || body.title || body.message : undefined
  console.error(
    `[GOV.UK Notify] ${phase} failed`,
    JSON.stringify({
      status: status || null,
      recipient: emailAddress,
      notifyErrors: concise || undefined,
      message: err && err.message
    })
  )
}

async function sendVerificationEmail (emailAddress, code) {
  if (!isNotifyConfigured()) {
    const err = new Error('NOTIFY not configured')
    err.code = 'NOTIFY_NOT_CONFIGURED'
    throw err
  }
  const client = new NotifyClient(process.env.NOTIFY_API_KEY)
  try {
    await client.sendEmail(
      process.env.NOTIFY_TEMPLATE_ID,
      emailAddress,
      {
        personalisation: { code },
        reference: `design-help-verify-${Date.now()}`
      }
    )
  } catch (err) {
    logNotifyApiFailure('sendVerificationEmail', emailAddress, err)
    throw err
  }
}

/**
 * Sends aggregated service feedback to the team inbox (GOV.UK Notify).
 * Template must define the same personalisation keys as passed here.
 *
 * @param {string} inboxEmail
 * @param {{ feedbackDetails: string, pagePath: string, contactEmail: string, signedInAs: string }} fields
 * @returns {Promise<void>}
 */
async function sendServiceFeedbackEmail (inboxEmail, fields) {
  if (!isFeedbackNotifyConfigured()) {
    const err = new Error('NOTIFY feedback not configured')
    err.code = 'NOTIFY_FEEDBACK_NOT_CONFIGURED'
    throw err
  }
  const client = new NotifyClient(process.env.NOTIFY_API_KEY)
  try {
    await client.sendEmail(
      process.env.NOTIFY_FEEDBACK_TEMPLATE_ID,
      inboxEmail,
      {
        personalisation: {
          service_name: 'Design help',
          feedback_details: fields.feedbackDetails,
          page_path: fields.pagePath,
          contact_email: fields.contactEmail,
          signed_in_as: fields.signedInAs
        },
        reference: `design-help-feedback-${Date.now()}`
      }
    )
  } catch (err) {
    logNotifyApiFailure('sendServiceFeedbackEmail', inboxEmail, err)
    throw err
  }
}

module.exports = {
  sendVerificationEmail,
  isNotifyConfigured,
  sendServiceFeedbackEmail,
  isFeedbackNotifyConfigured
}
