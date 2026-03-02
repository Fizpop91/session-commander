import fs from 'fs/promises';
import path from 'path';
import { encryptObject, decryptObject } from './secretStore.js';

const dataDir = path.resolve('data');
const notificationConfigPath = path.join(dataDir, 'notifications.json');
const notificationSecretsPath = path.join(dataDir, 'notification-secrets.enc');
const legacyConfigPath = path.join(dataDir, 'config.json');

function defaults() {
  return {
    smtp: {
      host: '',
      port: 587,
      secure: false,
      username: '',
      password: '',
      from: '',
      to: ''
    },
    preferences: {
      completedTransfer: false,
      failedTransfer: true
    }
  };
}

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

function normalizeNotifications(raw = {}) {
  const base = defaults();
  return {
    smtp: {
      host: String(raw?.smtp?.host || base.smtp.host),
      port: Number(raw?.smtp?.port || base.smtp.port),
      secure: Boolean(raw?.smtp?.secure),
      username: String(raw?.smtp?.username || base.smtp.username),
      password: String(raw?.smtp?.password || base.smtp.password),
      from: String(raw?.smtp?.from || base.smtp.from),
      to: String(raw?.smtp?.to || base.smtp.to)
    },
    preferences: {
      completedTransfer: Boolean(raw?.preferences?.completedTransfer),
      failedTransfer:
        raw?.preferences?.failedTransfer === undefined
          ? base.preferences.failedTransfer
          : Boolean(raw.preferences.failedTransfer)
    }
  };
}

async function loadNotificationSecrets() {
  try {
    const encrypted = await fs.readFile(notificationSecretsPath, 'utf8');
    const decrypted = await decryptObject(encrypted);
    return { smtpPassword: String(decrypted?.smtpPassword || '') };
  } catch {
    return { smtpPassword: '' };
  }
}

async function saveNotificationSecrets(smtpPassword) {
  const password = String(smtpPassword || '');
  if (!password) {
    try {
      await fs.unlink(notificationSecretsPath);
    } catch {
      // ignore
    }
    return;
  }

  const encrypted = await encryptObject({ smtpPassword: password });
  await fs.writeFile(notificationSecretsPath, encrypted, { encoding: 'utf8', mode: 0o600 });
}

async function loadLegacyNotifications() {
  try {
    const raw = await fs.readFile(legacyConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeNotifications(parsed?.notifications || {});
  } catch {
    return defaults();
  }
}

export async function loadNotificationConfig() {
  await ensureDataDir();

  let nonSecret = null;
  try {
    const raw = await fs.readFile(notificationConfigPath, 'utf8');
    nonSecret = normalizeNotifications(JSON.parse(raw));
  } catch {
    nonSecret = await loadLegacyNotifications();
  }

  const secrets = await loadNotificationSecrets();
  nonSecret.smtp.password = String(secrets.smtpPassword || nonSecret.smtp.password || '');

  return nonSecret;
}

export async function saveNotificationConfig(nextNotifications = {}) {
  await ensureDataDir();
  const normalized = normalizeNotifications(nextNotifications);
  await saveNotificationSecrets(normalized.smtp.password);

  const sanitized = normalizeNotifications(normalized);
  sanitized.smtp.password = '';
  await fs.writeFile(notificationConfigPath, JSON.stringify(sanitized, null, 2), 'utf8');

  return normalized;
}

export async function clearNotificationConfig() {
  await ensureDataDir();
  const cleared = defaults();

  try {
    await fs.unlink(notificationConfigPath);
  } catch {
    // ignore
  }

  try {
    await fs.unlink(notificationSecretsPath);
  } catch {
    // ignore
  }

  return cleared;
}
