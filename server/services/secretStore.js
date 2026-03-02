import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const keyFilePath = path.resolve('data', 'secrets.key');

function resolveKeyFromEnv() {
  const raw = String(process.env.SESSION_COMMANDER_SECRET_KEY || '').trim();
  if (!raw) return null;

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  try {
    const asBase64 = Buffer.from(raw, 'base64');
    if (asBase64.length === 32) return asBase64;
  } catch {
    // ignore
  }

  throw new Error('SESSION_COMMANDER_SECRET_KEY must be 32-byte base64 or 64-char hex');
}

async function ensureKeyFile() {
  try {
    const existing = await fs.readFile(keyFilePath, 'utf8');
    const parsed = Buffer.from(existing.trim(), 'hex');
    if (parsed.length === 32) return parsed;
  } catch {
    // create below
  }

  const key = crypto.randomBytes(32);
  await fs.mkdir(path.dirname(keyFilePath), { recursive: true });
  await fs.writeFile(keyFilePath, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  return key;
}

async function getKey() {
  const envKey = resolveKeyFromEnv();
  if (envKey) return envKey;
  return ensureKeyFile();
}

export async function encryptObject(payload) {
  const key = await getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    data: encrypted.toString('base64')
  });
}

export async function decryptObject(rawEncrypted) {
  const parsed = JSON.parse(String(rawEncrypted || '{}'));
  if (parsed.v !== 1) {
    throw new Error('Unsupported encrypted payload version');
  }

  const key = await getKey();
  const iv = Buffer.from(String(parsed.iv || ''), 'base64');
  const tag = Buffer.from(String(parsed.tag || ''), 'base64');
  const data = Buffer.from(String(parsed.data || ''), 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}
