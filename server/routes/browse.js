import { Router } from 'express';
import { listDirectory, getPathStats, deletePath } from '../services/remoteFs.js';
import { loadConfig } from '../services/configStore.js';
import { adminGuard } from '../services/auth.js';

const router = Router();

router.post('/list', async (req, res) => {
  try {
    const { target, path } = req.body;
    const entries = await listDirectory(target, path);
    res.json({ ok: true, entries });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/stats', async (req, res) => {
  try {
    const { target, path } = req.body;
    const stats = await getPathStats(target, path);
    res.json({ ok: true, stats });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/delete', adminGuard, async (req, res) => {
  try {
    const { target, path, side, workingLocationId } = req.body || {};
    const config = await loadConfig();

    if (side === 'storage') {
      if (!Boolean(config?.storageLocation?.allowDeleteInBrowser)) {
        throw new Error('Delete is disabled for Storage Location in Settings');
      }
      const storageRoot = String(config?.storageLocation?.rootPath || '').trim();
      if (storageRoot && String(path || '').trim() === storageRoot) {
        throw new Error('Cannot delete the Storage Location root path');
      }
    } else if (side === 'working') {
      const working = (config?.workingLocations || []).find((location) => location.id === workingLocationId);
      if (!working) {
        throw new Error('Working location not found');
      }
      if (!Boolean(working?.allowDeleteInBrowser)) {
        throw new Error('Delete is disabled for this Working Location in Settings');
      }
      const workingRoot = String(working?.rootPath || '').trim();
      if (workingRoot && String(path || '').trim() === workingRoot) {
        throw new Error('Cannot delete the Working Location root path');
      }
    } else {
      throw new Error('Invalid location side');
    }

    await deletePath(target, path);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

export default router;
