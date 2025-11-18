import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, Event } from '../db';
import redis from '../redis';
import { metrics } from '../metrics';
import { appConfig } from '../config';
import { rateLimit } from '../utils/rateLimiter';

const router = Router();

const {
  waitingRoom: {
    tokenTtlSeconds: WAITING_ROOM_TOKEN_TTL_SECONDS,
    accessTtlSeconds: WAITING_ROOM_ACCESS_TTL_SECONDS,
    waveSize: WAVE_SIZE,
    waveAdvanceIntervalMs: WAVE_ADVANCE_INTERVAL_MS,
  },
} = appConfig;

/**
 * Gets queue position using sorted set (scalable, no key scanning)
 * Returns position (1-indexed) or null if not found
 */
async function getQueuePositionFromSortedSet(eventId: string, token: string): Promise<number | null> {
  const queueKey = `waiting_room:queue:${eventId}`;
  const rank = await redis.zrank(queueKey, token);
  
  if (rank === null || rank === undefined) {
    return null;
  }
  
  // Rank is 0-indexed, position is 1-indexed
  return rank + 1;
}

/**
 * Gets total queue size using sorted set
 */
async function getQueueTotalFromSortedSet(eventId: string): Promise<number> {
  const queueKey = `waiting_room:queue:${eventId}`;
  return await redis.zcard(queueKey);
}

/**
 * Gets queue position for a token using sorted set
 * Only returns position if sale has opened
 */
async function getQueuePosition(eventId: string, token: string, onSaleAt: Date): Promise<number | null> {
  // Only assign positions if sale has opened
  const now = new Date();
  if (now < onSaleAt) {
    return null; // Sale hasn't opened yet, no position assigned
  }
  
  // Get position directly from sorted set (scalable, no key scanning)
  return await getQueuePositionFromSortedSet(eventId, token);
}

/**
 * Determines if user can enter based on wave admission
 * Waves work like this:
 * - Wave 1: positions 1-100 can enter immediately
 * - Wave 2: positions 101-200 can enter after wave 1 completes
 * - Wave 3: positions 201-300 can enter after wave 2 completes
 * etc.
 * 
 * For now, we'll admit wave 1 immediately, and subsequent waves after a delay
 * In a real system, this would be controlled by actual wave completion
 */
function canEnterWave(position: number | null, admittedEnd: number | null): boolean {
  if (position === null || admittedEnd === null || admittedEnd === 0) return false;
  return position <= admittedEnd;
}

/**
 * Estimates time until user can enter (in seconds)
 * Assumes each wave takes ~30 seconds to process
 */
function estimateETA(
  position: number | null,
  admittedEnd: number,
  waveSize: number = WAVE_SIZE,
  advanceIntervalMs: number = WAVE_ADVANCE_INTERVAL_MS
): number {
  if (position === null || position <= admittedEnd) {
    return 0;
  }

  const positionsAhead = Math.max(0, position - admittedEnd);
  const wavesAhead = Math.ceil(positionsAhead / waveSize);
  const secondsPerWave = Math.ceil(advanceIntervalMs / 1000);

  return wavesAhead * secondsPerWave;
}

// POST /events/:id/waiting-room/join
router.post('/:id/waiting-room/join', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    // Rate limit waiting room joins per IP/event (10 joins per minute)
    const rateKey = `join:${clientIp}:${id}`;
    const { allowed, retryAfter } = await rateLimit(rateKey, 10, 60);
    if (!allowed) {
      metrics.rateLimitHits.inc({ endpoint: 'waiting_room_join' });
      res.setHeader('Retry-After', retryAfter ?? 60);
      return res.status(429).json({ 
        error: 'rate_limited',
        retryAfterSeconds: retryAfter ?? 60,
      });
    }

    // Get canonical user identity from header, fallback to token if not provided
    const userId = req.header('x-user-id');
    const token = uuidv4();
    const canonicalUserId = userId || token; // Use userId if provided, otherwise token as fallback

    // Verify event exists and is not draft
    const eventResult = await query<Event>(
      `SELECT * FROM events 
       WHERE id = $1 AND status != 'draft'`,
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];

    // Store token in Redis with event metadata and canonical userId
    // Key: waiting_room:{eventId}:{token}
    // Value: JSON with joined_at timestamp and userId
    const key = `waiting_room:${id}:${token}`;
    const value = JSON.stringify({
      eventId: id,
      token,
      userId: canonicalUserId,
      joinedAt: new Date().toISOString(),
    });

    // Store token with TTL so abandoned tokens expire automatically
    await redis.set(key, value, 'EX', WAITING_ROOM_TOKEN_TTL_SECONDS);
    
    // Add token to sorted set for queue management (score = join timestamp)
    const queueKey = `waiting_room:queue:${id}`;
    const joinTimestamp = Date.now();
    await redis.zadd(queueKey, joinTimestamp, token);
    // Set TTL on the sorted set to match token TTL
    await redis.expire(queueKey, WAITING_ROOM_TOKEN_TTL_SECONDS);
    
    // Increment queue size counter
    const queueSizeKey = `queue_size:${id}`;
    await redis.incr(queueSizeKey);

    // If sale is already open, invalidate positions so they get recalculated
    // This ensures new users get correct positions in real-time
    const now = new Date();
    const onSaleAt = new Date(event.on_sale_at);
    if (now >= onSaleAt) {
      // Clear the positions_assigned flag so positions get recalculated
      const positionsAssignedKey = `positions_assigned:${id}`;
      await redis.del(positionsAssignedKey);
    }

    metrics.queueJoins.inc({ event_id: id });

    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'waiting_room.join',
        requestId: res.locals.requestId,
        event_id: id,
        token,
      })
    );

    res.status(200).json({ token });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to join waiting room', details: error.message });
  }
});

// GET /events/:id/waiting-room/status?token=
router.get('/:id/waiting-room/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token is required' });
    }

    // Verify event exists
    const eventResult = await query<Event>(
      `SELECT * FROM events 
       WHERE id = $1 AND status != 'draft'`,
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];

    // Check if token exists in Redis
    const key = `waiting_room:${id}:${token}`;
    const tokenData = await redis.get(key);

    if (!tokenData) {
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    // Determine state based on current time vs on_sale_at
    const now = new Date();
    const onSaleAt = new Date(event.on_sale_at);
    const state = now >= onSaleAt ? 'sale_open' : 'waiting';

    // Calculate seconds until sale opens
    const secondsUntilOnSale = state === 'waiting' 
      ? Math.max(0, Math.floor((onSaleAt.getTime() - now.getTime()) / 1000))
      : 0;

    // Get queue position and total (only if sale has opened)
    let position: number | null = null;
    let total = 0;
    let canEnter = false;
    let etaSeconds = 0;

    if (state === 'sale_open') {
      // Get total queue size from sorted set (scalable)
      total = await getQueueTotalFromSortedSet(id);
      
      // Get queue position from sorted set
      position = await getQueuePosition(id, token, onSaleAt);
      
      // Manage wave progression
      const waveEndKey = `queue_wave_end:${id}`;
      const waveAdvanceKey = `queue_wave_last_advance:${id}`;
      let waveEnd = parseInt((await redis.get(waveEndKey)) || '0', 10);
      const nowMs = Date.now();

      if (!waveEnd) {
        waveEnd = Math.min(total || WAVE_SIZE, WAVE_SIZE);
        if (waveEnd > 0) {
          await redis.set(waveEndKey, waveEnd.toString());
          await redis.set(waveAdvanceKey, nowMs.toString());
          console.log(JSON.stringify({
            level: 'info',
            msg: 'queue.wave.init',
            event_id: id,
            wave_end: waveEnd,
          }));
        }
      }

      if (total > waveEnd) {
        const lastAdvance = parseInt((await redis.get(waveAdvanceKey)) || '0', 10);
        if (!lastAdvance || nowMs - lastAdvance >= WAVE_ADVANCE_INTERVAL_MS) {
          const newWaveEnd = Math.min(total, waveEnd + WAVE_SIZE);
          if (newWaveEnd !== waveEnd) {
            waveEnd = newWaveEnd;
            await redis.set(waveEndKey, waveEnd.toString());
            await redis.set(waveAdvanceKey, nowMs.toString());
            console.log(JSON.stringify({
              level: 'info',
              msg: 'queue.wave.advance',
              event_id: id,
              wave_end: waveEnd,
            }));
          }
        }
      }

      // Determine if user can enter based on wave admission
      // But if event is paused, canEnter must be false
      if (position !== null && total > 0) {
        canEnter = canEnterWave(position, waveEnd) && !event.paused;
        etaSeconds = estimateETA(position, waveEnd, WAVE_SIZE, WAVE_ADVANCE_INTERVAL_MS);
      } else {
        // Even without position, if paused, canEnter is false
        canEnter = false;
      }
    }

    // If event is paused, override canEnter to false
    if (event.paused) {
      canEnter = false;
    }

    // Always include position fields when sale is open (even if null)
    const response: any = {
      state,
      onSaleAt: onSaleAt.toISOString(),
      secondsUntilOnSale,
      paused: event.paused,
    };

    if (state === 'sale_open') {
      response.position = position;
      response.total = total;
      response.canEnter = canEnter;
      response.etaSeconds = etaSeconds;

      if (canEnter) {
        const accessKey = `waiting_room_access:${id}:${token}`;
        await redis.set(accessKey, '1', 'EX', WAITING_ROOM_ACCESS_TTL_SECONDS);
      }
    }

    res.json(response);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get waiting room status', details: error.message });
  }
});

// DELETE /events/:id/waiting-room/clear (Admin endpoint to clear queue)
router.delete('/:id/waiting-room/clear', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify event exists
    const eventResult = await query<Event>(
      `SELECT * FROM events 
       WHERE id = $1`,
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Clear sorted set queue
    const queueKey = `waiting_room:queue:${id}`;
    const queueSize = await redis.zcard(queueKey);
    if (queueSize > 0) {
      await redis.del(queueKey);
    }

    // Clear all waiting room tokens for this event
    // Note: This is an admin-only endpoint, so using redis.keys() here is acceptable
    // In production, you might want to track tokens in a set for more efficient clearing
    const waitingRoomPattern = `waiting_room:${id}:*`;
    const waitingRoomKeys = await redis.keys(waitingRoomPattern);
    if (waitingRoomKeys.length > 0) {
      await redis.del(...waitingRoomKeys);
    }

    // Clear queue metadata
    await redis.del(`queue_size:${id}`);
    await redis.del(`queue_wave_end:${id}`);
    await redis.del(`queue_wave_last_advance:${id}`);

    res.json({ message: 'Queue cleared successfully', cleared: queueSize });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to clear queue', details: error.message });
  }
});

export default router;

