import { loadNotificationConfig } from './notificationConfigStore.js';

function parseRecipients(raw) {
  return String(raw || '')
    .split(/[;,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function getNotificationSettings(config = {}) {
  const notifications = config || {};
  const smtp = notifications?.smtp || {};
  const preferences = notifications?.preferences || {};

  return {
    smtp: {
      host: String(smtp.host || '').trim(),
      port: Number(smtp.port || 587),
      secure: Boolean(smtp.secure),
      username: String(smtp.username || '').trim(),
      password: String(smtp.password || ''),
      from: String(smtp.from || '').trim(),
      to: parseRecipients(smtp.to)
    },
    preferences: {
      completedTransfer: Boolean(preferences.completedTransfer),
      failedTransfer: Boolean(preferences.failedTransfer)
    }
  };
}

function shouldSendNotification(settings, outcome) {
  if (!settings?.smtp?.host || !settings?.smtp?.port || !settings?.smtp?.from || !settings?.smtp?.to?.length) {
    return false;
  }

  if (outcome === 'completed') {
    return settings.preferences.completedTransfer;
  }

  if (outcome === 'failed') {
    return settings.preferences.failedTransfer;
  }

  return false;
}

function buildTransportConfig(smtp) {
  const transport = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure
  };

  if (smtp.username) {
    transport.auth = {
      user: smtp.username,
      pass: smtp.password
    };
  }

  return transport;
}

function buildNormalizedSmtp(raw = {}) {
  return {
    host: String(raw.host || '').trim(),
    port: Number(raw.port || 587),
    secure: Boolean(raw.secure),
    username: String(raw.username || '').trim(),
    password: String(raw.password || ''),
    from: String(raw.from || '').trim(),
    to: parseRecipients(raw.to)
  };
}

function assertSmtpReady(smtp) {
  if (!smtp.host) throw new Error('SMTP host is required');
  if (!smtp.port || !Number.isFinite(Number(smtp.port))) throw new Error('SMTP port is required');
  if (!smtp.from) throw new Error('From email is required');
  if (!smtp.to.length) throw new Error('At least one recipient email is required');
}

function buildMessage({ transferType, outcome, sourcePath, destinationPath, error }) {
  const normalizedType = transferType || 'transfer';
  const verb = outcome === 'completed' ? 'completed' : 'failed';
  const titleCaseType =
    normalizedType === 'template-create'
      ? 'New session'
      : normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1);

  const subject = `[Session Commander] ${titleCaseType} ${verb}`;
  const lines = [
    `Transfer Type: ${normalizedType}`,
    `Outcome: ${verb}`,
    `Time: ${new Date().toISOString()}`
  ];

  if (sourcePath) lines.push(`Source: ${sourcePath}`);
  if (destinationPath) lines.push(`Destination: ${destinationPath}`);
  if (error) lines.push(`Error: ${error}`);

  return {
    subject,
    text: lines.join('\n')
  };
}

export async function notifyTransferEvent({
  transferType,
  outcome,
  sourcePath = '',
  destinationPath = '',
  error = ''
} = {}) {
  try {
    const notificationConfig = await loadNotificationConfig();
    const settings = getNotificationSettings(notificationConfig);

    if (!shouldSendNotification(settings, outcome)) {
      return { sent: false, reason: 'disabled-or-incomplete-config' };
    }

    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport(buildTransportConfig(settings.smtp));
    const message = buildMessage({
      transferType,
      outcome,
      sourcePath,
      destinationPath,
      error
    });

    await transporter.sendMail({
      from: settings.smtp.from,
      to: settings.smtp.to.join(', '),
      subject: message.subject,
      text: message.text
    });

    return { sent: true };
  } catch (sendError) {
    console.error(`Notification send failed: ${sendError.message}`);
    return { sent: false, reason: sendError.message };
  }
}

export async function sendTestNotificationEmail(rawSmtp = {}) {
  const smtp = buildNormalizedSmtp(rawSmtp);
  assertSmtpReady(smtp);

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport(buildTransportConfig(smtp));
  const now = new Date().toISOString();

  await transporter.sendMail({
    from: smtp.from,
    to: smtp.to.join(', '),
    subject: '[Session Commander] Test Email',
    text: `Session Commander notification test\nTime: ${now}`
  });

  return { ok: true };
}
