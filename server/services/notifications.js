import path from 'path';
import { loadConfig } from './configStore.js';
import { loadNotificationConfig } from './notificationConfigStore.js';

const APP_NAME = 'Session Commander';
const LOGO_URL = 'https://i.imgur.com/zSih198.png';
const EMAIL_BANNER_BG = '#141821';

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

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const decimals = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(decimals)} ${units[index]}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sameTarget(a = {}, b = {}) {
  return (
    String(a.host || '') === String(b.host || '') &&
    Number(a.port || 22) === Number(b.port || 22) &&
    String(a.username || '') === String(b.username || '')
  );
}

function getWorkingLocationLabel(appConfig = {}, target = {}) {
  const matches = Array.isArray(appConfig?.workingLocations)
    ? appConfig.workingLocations.find((location) => sameTarget(location, target))
    : null;

  if (matches?.name) return matches.name;
  if (matches?.rootPath) return matches.rootPath;
  return 'Working Location';
}

function getStorageLocationLabel(appConfig = {}) {
  return String(appConfig?.storageLocation?.name || '').trim() || 'Storage Location';
}

function sessionNameFromPath(rawPath = '') {
  const normalized = String(rawPath || '').replace(/\/+$/, '');
  return path.posix.basename(normalized);
}

function buildCopyEventContent({
  noun,
  destinationLabel,
  sessionName,
  outcome,
  sizeLabel,
  error
}) {
  const quotedSession = `"${sessionName}"`;
  if (outcome === 'completed') {
    return {
      subject: `${noun} to ${destinationLabel} Complete`,
      headline: `${noun} Complete`,
      textLines: [`${noun} of ${quotedSession} to ${destinationLabel} Complete`, `Size: ${sizeLabel || '—'}`],
      htmlLines: [
        `${noun} of <strong>${escapeHtml(quotedSession)}</strong> to ${escapeHtml(destinationLabel)} Complete`,
        `Size: ${escapeHtml(sizeLabel || '—')}`
      ]
    };
  }

  return {
    subject: `${noun} to ${destinationLabel} Failed`,
    headline: `${noun} Failed`,
    textLines: [
      `${noun} of ${quotedSession} to ${destinationLabel} Failed`,
      error ? `Error: ${error}` : ''
    ].filter(Boolean),
    htmlLines: [
      `${noun} of <strong>${escapeHtml(quotedSession)}</strong> to ${escapeHtml(destinationLabel)} Failed`,
      error ? `Error: ${escapeHtml(error)}` : ''
    ].filter(Boolean)
  };
}

function buildMessage({
  transferType,
  outcome,
  sourcePath,
  destinationPath,
  sourceTarget,
  destinationTarget,
  sizeBytes,
  sessionName,
  error,
  appConfig,
  hasLogo
}) {
  const normalizedType = transferType || 'transfer';
  const safeOutcome = outcome === 'failed' ? 'failed' : 'completed';
  const sizeLabel = formatBytes(sizeBytes);

  let subject = `${APP_NAME} Notification`;
  let headline = `${APP_NAME} transfer update`;
  let textLines = [];
  let htmlLines = [];

  if (normalizedType === 'restore') {
    const destinationLabel = getWorkingLocationLabel(appConfig, destinationTarget);
    const folderName =
      sessionName || sessionNameFromPath(destinationPath) || sessionNameFromPath(sourcePath) || 'Session';
    ({ subject, headline, textLines, htmlLines } = buildCopyEventContent({
      noun: 'Restore',
      destinationLabel,
      sessionName: folderName,
      outcome: safeOutcome,
      sizeLabel,
      error
    }));
  } else if (normalizedType === 'backup') {
    const destinationLabel = getStorageLocationLabel(appConfig);
    const folderName =
      sessionName || sessionNameFromPath(destinationPath) || sessionNameFromPath(sourcePath) || 'Session';
    ({ subject, headline, textLines, htmlLines } = buildCopyEventContent({
      noun: 'Backup',
      destinationLabel,
      sessionName: folderName,
      outcome: safeOutcome,
      sizeLabel,
      error
    }));
  } else if (normalizedType === 'template-create') {
    const destinationLabel = getWorkingLocationLabel(appConfig, destinationTarget);
    const createdSession =
      sessionName || sessionNameFromPath(destinationPath) || sessionNameFromPath(sourcePath) || 'Session';
    if (safeOutcome === 'completed') {
      subject = `New Session Created on ${destinationLabel}`;
      headline = 'New Session Created';
      textLines = [`New session "${createdSession}" created on ${destinationLabel}`];
      htmlLines = [
        `New session <strong>${escapeHtml(`"${createdSession}"`)}</strong> created on ${escapeHtml(destinationLabel)}`
      ];
    } else {
      subject = `New Session Creation Failed on ${destinationLabel}`;
      headline = 'New Session Failed';
      textLines = [`New session creation failed on ${destinationLabel}`, error ? `Error: ${error}` : ''].filter(Boolean);
      htmlLines = [
        `New session creation failed on ${escapeHtml(destinationLabel)}`,
        error ? `Error: ${escapeHtml(error)}` : ''
      ].filter(Boolean);
    }
  } else {
    const verb = safeOutcome === 'completed' ? 'Complete' : 'Failed';
    subject = `${normalizedType} ${verb}`;
    headline = `${normalizedType} ${verb}`;
    textLines = [headline];
    if (error) textLines.push(`Error: ${error}`);
    htmlLines = textLines.map((line) => escapeHtml(line));
  }

  const escapedHeadline = escapeHtml(headline);
  const renderedDetails = htmlLines.length ? htmlLines : textLines.map((line) => escapeHtml(line));
  const logoCell = hasLogo
    ? `<td style="vertical-align:middle;width:30px;line-height:0;">
                    <img src="${LOGO_URL}" width="30" height="30" alt="${APP_NAME} Logo" style="display:block;vertical-align:middle;" />
                  </td>`
    : '';
  const titlePadding = hasLogo ? 'padding-left:6px;' : '';
  const html = `
<div style="margin:0;padding:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:20px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:collapse;">
          <tr>
            <td style="background:${EMAIL_BANNER_BG};padding:16px 18px;border-radius:10px 10px 0 0;color:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  ${logoCell}
                  <td style="${titlePadding}font-size:20px;line-height:1.2;font-weight:700;vertical-align:middle;">
                    ${APP_NAME}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:20px 18px;border:1px solid #e6e9f0;border-top:none;border-radius:0 0 10px 10px;">
              <p style="margin:0 0 12px;font-size:18px;line-height:1.4;color:#1f2937;font-weight:600;">${escapedHeadline}</p>
              ${renderedDetails
                .map(
                  (line) =>
                    `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#374151;">${line}</p>`
                )
                .join('')}
              <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">Sent ${escapeHtml(
                new Date().toISOString()
              )}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`.trim();

  return {
    subject,
    text: textLines.join('\n'),
    html
  };
}

export async function notifyTransferEvent({
  transferType,
  outcome,
  sourcePath = '',
  destinationPath = '',
  sourceTarget = {},
  destinationTarget = {},
  sizeBytes = 0,
  sessionName = '',
  error = ''
} = {}) {
  try {
    const [notificationConfig, appConfig] = await Promise.all([loadNotificationConfig(), loadConfig()]);
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
      sourceTarget,
      destinationTarget,
      sizeBytes,
      sessionName,
      error,
      appConfig,
      hasLogo: Boolean(LOGO_URL)
    });

    await transporter.sendMail({
      from: settings.smtp.from,
      to: settings.smtp.to.join(', '),
      subject: message.subject,
      text: message.text,
      html: message.html
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
  const hasLogo = Boolean(LOGO_URL);
  const logoCell = hasLogo
    ? `<td style="vertical-align:middle;width:30px;line-height:0;">
                    <img src="${LOGO_URL}" width="30" height="30" alt="${APP_NAME} Logo" style="display:block;vertical-align:middle;" />
                  </td>`
    : '';
  const titlePadding = hasLogo ? 'padding-left:6px;' : '';
  const text = `${APP_NAME} notification test\nTime: ${now}`;
  const html = `
<div style="margin:0;padding:16px;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:collapse;">
          <tr>
            <td style="background:${EMAIL_BANNER_BG};padding:16px 18px;border-radius:10px 10px 0 0;color:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  ${logoCell}
                  <td style="${titlePadding}font-size:20px;line-height:1.2;font-weight:700;vertical-align:middle;">${APP_NAME}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:20px 18px;border:1px solid #e6e9f0;border-top:none;border-radius:0 0 10px 10px;">
              <p style="margin:0 0 8px;font-size:18px;color:#1f2937;font-weight:600;">SMTP test email</p>
              <p style="margin:0;font-size:14px;color:#374151;">Time: ${escapeHtml(now)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`.trim();

  await transporter.sendMail({
    from: smtp.from,
    to: smtp.to.join(', '),
    subject: '[Session Commander] Test Email',
    text,
    html
  });

  return { ok: true };
}
