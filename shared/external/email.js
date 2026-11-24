'use strict';

// Real external integration: Brevo transactional email. Without a key the
// service still works and records the message in the reminders table (dev mode).
const { config } = require('../config');

async function sendEmail(message) {
  const settings = config();
  if (settings.testMode || settings.emailMode === 'log' || !settings.brevoKey) {
    console.log('EMAIL_DEV_LOG', JSON.stringify({ to: message.to, subject: message.subject }));
    return { status: 'dev-log', provider: 'local-log', messageId: `dev_${Date.now()}` };
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'api-key': settings.brevoKey
    },
    body: JSON.stringify({
      sender: { name: 'Blood Donation Drive', email: settings.emailFrom.includes('<')
        ? settings.emailFrom.split('<')[1].replace('>', '') : settings.emailFrom },
      to: [{ email: message.to, name: message.name || 'Donor' }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text || message.subject
    }),
    signal: AbortSignal.timeout(9000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Brevo returned ${response.status}: ${body.slice(0, 200)}`);
  const parsed = body ? JSON.parse(body) : {};
  return { status: 'sent', provider: 'brevo', messageId: parsed.messageId || '' };
}

module.exports = { sendEmail };
