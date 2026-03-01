import { Router } from 'express';
import {
  compareSourceAndDestination,
  startRestoreJob,
  startBackupJob,
  getTransferJobStatus
} from '../services/transfer.js';

const router = Router();

router.post('/compare', async (req, res) => {
  try {
    const result = await compareSourceAndDestination(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/restore', async (req, res) => {
  try {
    const result = startRestoreJob(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/backup', async (req, res) => {
  try {
    const result = startBackupJob(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.get('/status/:jobId', async (req, res) => {
  try {
    const result = getTransferJobStatus(req.params.jobId);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(404).json({ ok: false, error: error.message });
  }
});

export default router;
