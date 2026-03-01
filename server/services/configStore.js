import fs from 'fs/promises';
import path from 'path';

const dataDir = path.resolve('data');
const configPath = path.join(dataDir, 'config.json');
const defaultPath = path.resolve('server/config/defaultConfig.json');

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

export async function loadConfig() {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    const defaults = await fs.readFile(defaultPath, 'utf8');
    return JSON.parse(defaults);
  }
}

export async function saveConfig(nextConfig) {
  await ensureDataDir();
  await fs.writeFile(configPath, JSON.stringify(nextConfig, null, 2), 'utf8');
  return nextConfig;
}
