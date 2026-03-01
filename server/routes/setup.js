import { Router } from 'express';
import {
  testNasConnection,
  checkScpInstalled,
  checkRsyncInstalled,
  generateContainerKeypair,
  installContainerKeyWithPassword,
  generateRemoteKeypairWithPassword,
  installPeerKeyWithPassword,
  testPeerConnection,
  getContainerKeyStatus,
  testConnectionWithPassword,
  refreshContainerKnownHosts,
  clearToolKeysWithPasswords
} from '../services/ssh.js';
import { saveConfig, loadConfig } from '../services/configStore.js';
import { adminGuard } from '../services/auth.js';
import fs from 'fs/promises';
import path from 'path';

const router = Router();
const configArchiveDir = path.resolve('data/config');
const defaultConfigPath = path.resolve('server/config/defaultConfig.json');

function sanitizeConfigFilename(input) {
  const raw = String(input || '').trim();
  const base = raw.replace(/\.json$/i, '');
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safe || `config_${Date.now()}`}.json`;
}

async function loadDefaultConfig() {
  const defaultsRaw = await fs.readFile(defaultConfigPath, 'utf8');
  return JSON.parse(defaultsRaw);
}

async function ensureConfigArchiveDir() {
  await fs.mkdir(configArchiveDir, { recursive: true });
}

async function ensureDefaultStoredConfig() {
  await ensureConfigArchiveDir();
  const defaultStoredPath = path.join(configArchiveDir, 'default.json');
  try {
    await fs.access(defaultStoredPath);
  } catch {
    const defaults = await loadDefaultConfig();
    await fs.writeFile(defaultStoredPath, JSON.stringify(defaults, null, 2), 'utf8');
  }
}

function extractTargetPayload(body = {}) {
  return {
    storageTarget: body.storageTarget,
    storagePassword: body.storagePassword,
    workingTarget: body.workingTarget,
    workingPassword: body.workingPassword
  };
}

router.get('/config', async (req, res) => {
  const config = await loadConfig();
  res.json(config);
});

router.get('/key-status', async (req, res) => {
  try {
    const status = await getContainerKeyStatus();
    res.json({ ok: true, ...status });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/test', adminGuard, async (req, res) => {
  try {
    const { target } = req.body;

    const connection = await testNasConnection(target);
    const [scp, rsync] = await Promise.all([
      checkScpInstalled(target),
      checkRsyncInstalled(target)
    ]);

    res.json({
      ok: true,
      connection,
      scp,
      rsync
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/test-bootstrap', adminGuard, async (req, res) => {
  try {
    const { target, password } = req.body;
    const result = await testConnectionWithPassword(target, password);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/test-peer', adminGuard, async (req, res) => {
  try {
    const { sourceTarget, destinationTarget } = req.body;
    const result = await testPeerConnection(sourceTarget, destinationTarget);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/init-keys', adminGuard, async (req, res) => {
  try {
    const result = await generateContainerKeypair();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/bootstrap-key', adminGuard, async (req, res) => {
  try {
    const { target, password } = req.body;
    const result = await installContainerKeyWithPassword(target, password);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/peer-key/generate', adminGuard, async (req, res) => {
  try {
    const { target, password } = req.body;
    const result = await generateRemoteKeypairWithPassword(target, password);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/peer-key/install', adminGuard, async (req, res) => {
  try {
    const { target, password, publicKey } = req.body;
    const result = await installPeerKeyWithPassword(target, password, publicKey);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/authorize-container', adminGuard, async (req, res) => {
  try {
    const { storageTarget, storagePassword, workingTarget, workingPassword } = extractTargetPayload(
      req.body
    );

    const keypair = await generateContainerKeypair();
    await installContainerKeyWithPassword(storageTarget, storagePassword);
    await installContainerKeyWithPassword(workingTarget, workingPassword);

    const [storageTest, workingTest] = await Promise.all([
      testNasConnection(storageTarget),
      testNasConnection(workingTarget)
    ]);

    const [storageScp, storageRsync, workingScp, workingRsync] = await Promise.all([
      checkScpInstalled(storageTarget),
      checkRsyncInstalled(storageTarget),
      checkScpInstalled(workingTarget),
      checkRsyncInstalled(workingTarget)
    ]);

    res.json({
      ok: true,
      publicKey: keypair.publicKey,
      storage: {
        connection: storageTest,
        scp: storageScp,
        rsync: storageRsync
      },
      working: {
        connection: workingTest,
        scp: workingScp,
        rsync: workingRsync
      }
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

async function handleStorageToWorkingTrust(req, res) {
  try {
    const { storageTarget, storagePassword, workingTarget, workingPassword } = extractTargetPayload(
      req.body
    );

    const storageKey = await generateRemoteKeypairWithPassword(storageTarget, storagePassword);
    await installPeerKeyWithPassword(workingTarget, workingPassword, storageKey.publicKey);
    const peerTest = await testPeerConnection(storageTarget, workingTarget);

    res.json({
      ok: true,
      publicKey: storageKey.publicKey,
      test: peerTest
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
}

async function handleWorkingToStorageTrust(req, res) {
  try {
    const { storageTarget, storagePassword, workingTarget, workingPassword } = extractTargetPayload(
      req.body
    );

    const workingKey = await generateRemoteKeypairWithPassword(workingTarget, workingPassword);
    await installPeerKeyWithPassword(storageTarget, storagePassword, workingKey.publicKey);
    const peerTest = await testPeerConnection(workingTarget, storageTarget);

    res.json({
      ok: true,
      publicKey: workingKey.publicKey,
      test: peerTest
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
}

router.post('/peer-trust/storage-to-working', adminGuard, handleStorageToWorkingTrust);
router.post('/peer-trust/working-to-storage', adminGuard, handleWorkingToStorageTrust);

router.post('/config', adminGuard, async (req, res) => {
  try {
    const current = await loadConfig();
    const { configName, ...incoming } = req.body || {};
    const saved = await saveConfig({
      ...current,
      ...incoming
    });
    await ensureDefaultStoredConfig();
    await fs.writeFile(path.join(configArchiveDir, 'latest.json'), JSON.stringify(saved, null, 2), 'utf8');
    let storedAs = null;
    if (String(configName || '').trim()) {
      storedAs = sanitizeConfigFilename(configName);
      await fs.writeFile(path.join(configArchiveDir, storedAs), JSON.stringify(saved, null, 2), 'utf8');
    }
    res.json({ ok: true, config: saved, storedAs });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.get('/configs', adminGuard, async (req, res) => {
  try {
    await ensureDefaultStoredConfig();
    const entries = await fs.readdir(configArchiveDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map(async (entry) => {
          const fullPath = path.join(configArchiveDir, entry.name);
          const stat = await fs.stat(fullPath);
          return {
            name: entry.name,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString()
          };
        })
    );

    files.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
    return res.json({ ok: true, configs: files });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/configs/load', adminGuard, async (req, res) => {
  try {
    await ensureDefaultStoredConfig();
    const requested = sanitizeConfigFilename(req.body?.name);
    const targetPath = path.join(configArchiveDir, requested);
    const raw = await fs.readFile(targetPath, 'utf8');
    const parsed = JSON.parse(raw);
    const saved = await saveConfig(parsed);
    return res.json({ ok: true, config: saved });
  } catch (error) {
    return res.status(400).json({ ok: false, error: `Load config failed: ${error.message}` });
  }
});

router.post('/configs/import', adminGuard, async (req, res) => {
  try {
    const payload = req.body?.config;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ ok: false, error: 'Config payload must be a JSON object' });
    }

    const saved = await saveConfig(payload);
    await ensureDefaultStoredConfig();
    const archiveName = sanitizeConfigFilename(req.body?.name || `import_${Date.now()}.json`);
    await fs.writeFile(path.join(configArchiveDir, archiveName), JSON.stringify(saved, null, 2), 'utf8');
    return res.json({ ok: true, config: saved, storedAs: archiveName });
  } catch (error) {
    return res.status(400).json({ ok: false, error: `Import config failed: ${error.message}` });
  }
});

router.post('/clear-config', adminGuard, async (req, res) => {
  try {
    const saved = await saveConfig(await loadDefaultConfig());
    await ensureDefaultStoredConfig();
    await fs.writeFile(path.join(configArchiveDir, 'latest.json'), JSON.stringify(saved, null, 2), 'utf8');
    res.json({
      ok: true,
      config: saved,
      warnings: []
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/clear-config-and-keys', adminGuard, async (req, res) => {
  try {
    const { storageTarget, storagePassword, workingTarget, workingPassword } = extractTargetPayload(
      req.body
    );

    if (!storageTarget?.host || !storageTarget?.username) {
      return res.status(400).json({ ok: false, error: 'Storage location target is required' });
    }
    if (!workingTarget?.host || !workingTarget?.username) {
      return res.status(400).json({ ok: false, error: 'Working location target is required' });
    }
    if (!storagePassword) {
      return res.status(400).json({ ok: false, error: 'Storage location password is required' });
    }
    if (!workingPassword) {
      return res.status(400).json({ ok: false, error: 'Working location password is required' });
    }

    const keyCleanup = await clearToolKeysWithPasswords({
      storageTarget,
      storagePassword,
      workingTarget,
      workingPassword
    });

    const saved = await saveConfig(await loadDefaultConfig());
    await ensureDefaultStoredConfig();
    await fs.writeFile(path.join(configArchiveDir, 'latest.json'), JSON.stringify(saved, null, 2), 'utf8');

    return res.json({
      ok: true,
      config: saved,
      keysFound: Boolean(keyCleanup.keysFound),
      keysCleared: Boolean(keyCleanup.cleared),
      keyReport: keyCleanup.report || null,
      keyDetails: keyCleanup.details || null,
      warnings: Array.isArray(keyCleanup.warnings) ? keyCleanup.warnings : []
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/clear-container-known-hosts', adminGuard, async (req, res) => {
  try {
    const rawHosts = Array.isArray(req.body?.hosts) ? req.body.hosts : [];
    const hosts = [...new Set(rawHosts.map((host) => String(host || '').trim()).filter(Boolean))];

    if (!hosts.length) {
      return res.status(400).json({ ok: false, error: 'At least one host is required' });
    }

    const result = await refreshContainerKnownHosts({
      workingTargets: hosts.map((host) => ({ host }))
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

export default router;
