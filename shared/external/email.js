'use strict';

// Real external integration: Resend (preferred) or Brevo transactional email.
// Without a key, or in log/test mode, the service records the message in the
// reminders table (dev mode) instead of sending it.
const { config } = require('../config');

function senderAddress(value) {
  const match = String(value || '').match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

async function sendEmail(message) {
  const settings = config();
  const useResend = Boolean(settings.resendKey);
  const useBrevo = !useResend && Boolean(settings.brevoKey);

  if (settings.testMode || settings.emailMode === 'log' || (!useResend && !useBrevo)) {
    console.log('EMAIL_DEV_LOG', JSON.stringify({ to: message.to, subject: message.subject }));
    return { status: 'dev-log', provider: 'local-log', messageId: `dev_${Date.now()}` };
  }

  if (useResend) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${settings.resendKey}`,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        from: settings.emailFrom,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text || message.subject
      }),
      signal: AbortSignal.timeout(9000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Resend returned ${response.status}: ${body.slice(0, 200)}`);
    const parsed = body ? JSON.parse(body) : {};
    return { status: 'sent', provider: 'resend', messageId: parsed.id || '' };
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'api-key': settings.brevoKey
    },
    body: JSON.stringify({
      sender: { name: 'Blood Donation Drive', email: senderAddress(settings.emailFrom) },
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
