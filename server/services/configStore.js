import fs from 'fs/promises';
import path from 'path';

const dataDir = path.resolve('data');
const configPath = path.join(dataDir, 'config.json');
const defaultPath = path.resolve('server/config/defaultConfig.json');

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}
function stripNotificationFields(config) {
  const next = JSON.parse(JSON.stringify(config || {}));
  delete next.notifications;
  return next;
}

export async function loadConfig() {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return stripNotificationFields(JSON.parse(raw));
  } catch {
    const defaults = await fs.readFile(defaultPath, 'utf8');
    return stripNotificationFields(JSON.parse(defaults));
  }
}

export async function saveConfig(nextConfig) {
  await ensureDataDir();
  const sanitized = stripNotificationFields(nextConfig);
  await fs.writeFile(configPath, JSON.stringify(sanitized, null, 2), 'utf8');
  return sanitized;
}
