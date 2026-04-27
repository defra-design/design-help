const { NotifyClient } = require('notifications-node-client')

function isNotifyConfigured () {
  return Boolean(process.env.NOTIFY_API_KEY && process.env.NOTIFY_TEMPLATE_ID)
}

/**
 * @param {string} emailAddress
 * @param {string} code
 * @returns {Promise<void>}
 */
async function sendVerificationEmail (emailAddress, code) {
  if (!isNotifyConfigured()) {
    const err = new Error('NOTIFY not configured')
    err.code = 'NOTIFY_NOT_CONFIGURED'
    throw err
  }
  const client = new NotifyClient(process.env.NOTIFY_API_KEY)
  await client.sendEmail(
    process.env.NOTIFY_TEMPLATE_ID,
    emailAddress,
    {
      personalisation: { code },
      reference: `design-help-verify-${Date.now()}`
    }
  )
}

module.exports = {
  sendVerificationEmail,
  isNotifyConfigured
}
