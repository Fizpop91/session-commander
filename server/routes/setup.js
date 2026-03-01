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
  removeToolKeysFromSystems,
  getContainerKeyStatus,
  testConnectionWithPassword,
  refreshContainerKnownHosts
} from '../services/ssh.js';
import { saveConfig, loadConfig } from '../services/configStore.js';
import { adminGuard } from '../services/auth.js';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

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
    const saved = await saveConfig({
      ...current,
      ...req.body
    });
    res.json({ ok: true, config: saved });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/clear-config', adminGuard, async (req, res) => {
  try {
    const removeKeys = Boolean(req.body?.removeKeys);
    const current = await loadConfig();
    const defaultsRaw = await fs.readFile(path.resolve('server/config/defaultConfig.json'), 'utf8');
    const defaults = JSON.parse(defaultsRaw);

    const warnings = [];

    if (removeKeys) {
      const storageTarget = {
        host: current?.storageLocation?.host || '',
        port: Number(current?.storageLocation?.port || 22),
        username: current?.storageLocation?.username || ''
      };
      const working = Array.isArray(current?.workingLocations) ? current.workingLocations[0] : null;
      const workingTarget = {
        host: working?.host || '',
        port: Number(working?.port || 22),
        username: working?.username || ''
      };

      const cleanup = await removeToolKeysFromSystems({ storageTarget, workingTarget });
      warnings.push(...(cleanup.warnings || []));

      try {
        await fs.rm(path.resolve('data/ssh/id_ed25519'), { force: true });
        await fs.rm(path.resolve('data/ssh/id_ed25519.pub'), { force: true });
      } catch (error) {
        warnings.push(`local key cleanup: ${error.message}`);
      }
    }

    const nextConfig = {
      ...defaults,
      security: current?.security || defaults.security
    };

    const saved = await saveConfig(nextConfig);
    res.json({
      ok: true,
      config: saved,
      warnings
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
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
