import { Router } from 'express';
import { buildSessionName } from '../services/naming.js';
import { createFromTemplate, inspectTemplatePtx } from '../services/transfer.js';
import { notifyTransferEvent } from '../services/notifications.js';

const router = Router();

router.post('/preview-name', (req, res) => {
  try {
    const sessionName = buildSessionName(req.body);
    res.json({ ok: true, sessionName });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/create', async (req, res) => {
  try {
    const result = await createFromTemplate(req.body);
    void notifyTransferEvent({
      transferType: 'template-create',
      outcome: 'completed',
      sourcePath: req.body?.templatePath,
      destinationPath: result?.destinationPath
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    void notifyTransferEvent({
      transferType: 'template-create',
      outcome: 'failed',
      sourcePath: req.body?.templatePath,
      destinationPath: req.body?.destinationParent,
      error: error.message
    });
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/check-ptx', async (req, res) => {
  try {
    const result = await inspectTemplatePtx(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

export default router;
