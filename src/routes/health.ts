import { Router } from 'express';
import { query } from '../db';
import redis from '../redis';

const router = Router();

router.get('/', async (req, res) => {
  const checks: Record<string, { status: string; error?: string }> = {};
  
  // Check database connection
  try {
    await query('SELECT 1');
    checks.database = { status: 'ok' };
  } catch (error: any) {
    checks.database = { 
      status: 'error', 
      error: error.message || 'Database connection failed',
      code: error.code,
    };
  }
  
  // Check Redis connection (non-blocking)
  try {
    await redis.ping();
    checks.redis = { status: 'ok' };
  } catch (error: any) {
    checks.redis = { 
      status: 'error', 
      error: error.message || 'Redis connection failed',
      code: error.code,
    };
  }
  
  const allOk = Object.values(checks).every(check => check.status === 'ok');
  
  res.status(allOk ? 200 : 503).json({ 
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});

export default router;

