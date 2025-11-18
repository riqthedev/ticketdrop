import { Router } from 'express';
import { getMetrics, metricsContentType } from '../metrics';

const router = Router();

router.get('/metrics', async (_req, res) => {
  try {
    res.setHeader('Content-Type', metricsContentType);
    res.send(await getMetrics());
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get metrics', details: error.message });
  }
});

export default router;


