import { Router } from 'express';
import { listDirectory, getPathStats } from '../services/remoteFs.js';

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

export default router;
