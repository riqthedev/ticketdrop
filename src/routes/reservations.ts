import { Router, Request, Response } from 'express';
import { query, Event, TicketTier, Reservation, getClient } from '../db';
import { rateLimit } from '../utils/rateLimiter';
import { metrics } from '../metrics';
import redis from '../redis';
import { appConfig } from '../config';
import { maybeAlertOversellSpike } from '../alerting';

const router = Router();

const {
  reservation: {
    ttlMinutes: RESERVATION_TTL_MINUTES,
    perEventLimit: EVENT_PURCHASE_LIMIT,
  },
} = appConfig;

/**
 * POST /events/:id/reservations
 * Create a reservation (ticket hold) for a user
 * 
 * Body: {
 *   tier_id: string,
 *   quantity: number,
 *   token: string (waiting room token)
 * }
 */
router.post('/:id/reservations', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tier_id, quantity, token } = req.body;
    const userId = req.header('x-user-id');

    // Validate input
    if (!tier_id || !quantity || !token) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['tier_id', 'quantity', 'token']
      });
    }

    if (typeof quantity !== 'number' || quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive number' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'X-User-Id header is required' });
    }

    // Rate limiting per user per event
    const rateKey = `reservations:${id}:${userId}`;
    const { allowed, retryAfter } = await rateLimit(rateKey, 5, 60);
    if (!allowed) {
      metrics.reservationRateLimited.inc({ event_id: id });
      metrics.rateLimitHits.inc({ endpoint: 'reservations' });
      console.log(
        JSON.stringify({
          level: 'warn',
          msg: 'reservation.rate_limited',
          requestId: res.locals.requestId,
          event_id: id,
          user_id: userId,
          rate_key: rateKey,
        })
      );
      res.setHeader('Retry-After', retryAfter ?? 60);
      return res.status(429).json({ 
        error: 'rate_limited',
        retryAfterSeconds: retryAfter ?? 60,
      });
    }

    // Ensure waiting room token has been admitted (canEnter)
    const accessKey = `waiting_room_access:${id}:${token}`;
    const hasAccess = await redis.get(accessKey);
    if (!hasAccess) {
      return res.status(403).json({
        error: 'You have not been admitted from the waiting room yet. Please wait for your turn.',
      });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Verify event exists and is not draft
      const eventResult = await client.query<Event>(
        `SELECT * FROM events 
         WHERE id = $1 AND status != 'draft'`,
        [id]
      );

      if (eventResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Event not found' });
      }

      const event = eventResult.rows[0];

      // Check if event is paused
      if (event.paused) {
        await client.query('ROLLBACK');
        return res.status(403).json({ 
          error: 'Sales are currently paused for this event',
          paused: true
        });
      }

      // Verify tier exists and belongs to this event (lock row)
      const tierResult = await client.query<TicketTier>(
        `SELECT * FROM ticket_tiers 
         WHERE id = $1 AND event_id = $2
         FOR UPDATE`,
        [tier_id, id]
      );

      if (tierResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Tier not found for this event' });
      }

      const tier = tierResult.rows[0];

      const ordersResult = await client.query<{ count: string }>(
        `SELECT COALESCE(SUM(quantity), 0) as count
         FROM orders
         WHERE event_id = $1 AND user_token = $2 AND status = 'paid'`,
        [id, userId]
      );
      const totalPurchased = parseInt(ordersResult.rows[0]?.count || '0', 10);

      const activeUserHoldsResult = await client.query<{ count: string }>(
        `SELECT COALESCE(SUM(quantity), 0) as count
         FROM reservations
         WHERE event_id = $1 AND user_token = $2 AND status = 'active' AND expires_at > NOW()`,
        [id, userId]
      );
      const totalHeld = parseInt(activeUserHoldsResult.rows[0]?.count || '0', 10);

      const projectedTotal = totalPurchased + totalHeld + quantity;
      if (projectedTotal > EVENT_PURCHASE_LIMIT) {
        await client.query('ROLLBACK');
        metrics.purchaseLimitHit.inc({ event_id: id });
        console.log(
          JSON.stringify({
            level: 'warn',
            msg: 'reservation.purchase_limit_exceeded',
            requestId: res.locals.requestId,
            event_id: id,
            user_id: userId,
            tier_id: tier_id,
            requested_quantity: quantity,
            already_purchased: totalPurchased,
            active_holds: totalHeld,
            projected_total: projectedTotal,
            limit: EVENT_PURCHASE_LIMIT,
          })
        );
        return res.status(403).json({
          error: 'purchase_limit_exceeded',
          limit: EVENT_PURCHASE_LIMIT,
          alreadyPurchased: totalPurchased,
          activeHolds: totalHeld,
          requested: quantity,
        });
      }

      // Check per-user limit per tier
      if (quantity > tier.per_user_limit) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Cannot reserve more than ${tier.per_user_limit} tickets per user`,
          max_allowed: tier.per_user_limit
        });
      }

      // Check if user already has an active reservation for this event (using canonical userId)
      const existingReservation = await client.query<Reservation>(
        `SELECT * FROM reservations 
         WHERE event_id = $1 AND user_token = $2 AND status = 'active' AND expires_at > NOW()
         LIMIT 1`,
        [id, userId]
      );

      if (existingReservation.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ 
          error: 'You already have an active reservation for this event',
          reservation_id: existingReservation.rows[0].id,
          expires_at: existingReservation.rows[0].expires_at
        });
      }

      const activeReservationsResult = await client.query<{ count: string }>(
        `SELECT COALESCE(SUM(quantity), 0) as count FROM reservations 
         WHERE tier_id = $1 AND status = 'active' AND expires_at > NOW()`,
        [tier_id]
      );
      const reserved = parseInt(activeReservationsResult.rows[0]?.count || '0', 10);

      const soldResult = await client.query<{ count: string }>(
        `SELECT COALESCE(SUM(quantity), 0) as count 
         FROM orders 
         WHERE tier_id = $1 AND status = 'paid'`,
        [tier_id]
      );
      const sold = parseInt(soldResult.rows[0]?.count || '0', 10);

      const available = tier.capacity - reserved - sold;

      if (quantity > available) {
        await client.query('ROLLBACK');
        metrics.oversellAttempts.inc({ event_id: id, tier_id });
        await maybeAlertOversellSpike(id, tier_id, 10, 60);
        console.log(
          JSON.stringify({
            level: 'warn',
            msg: 'reservation.oversell_attempt',
            requestId: res.locals.requestId,
            event_id: id,
            tier_id,
            user_id: userId,
            requested_quantity: quantity,
            available,
            capacity: tier.capacity,
            reserved,
            sold,
          })
        );
        return res.status(409).json({ 
          error: 'Not enough tickets available',
          available,
          requested: quantity
        });
      }

      // Create reservation with TTL
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + RESERVATION_TTL_MINUTES);

      // Store canonical userId in user_token column (keeping column name for compatibility)
      const reservationResult = await client.query<Reservation>(
        `INSERT INTO reservations (event_id, tier_id, user_token, quantity, status, expires_at)
         VALUES ($1, $2, $3, $4, 'active', $5)
         RETURNING *`,
        [id, tier_id, userId, quantity, expiresAt]
      );

      const reservation = reservationResult.rows[0];

      await client.query('COMMIT');

      metrics.reservationsCreated.inc({ event_id: id, tier_id });

      console.log(
        JSON.stringify({
          level: 'info',
          msg: 'reservation.created',
          requestId: res.locals.requestId,
          event_id: id,
          tier_id,
          quantity,
          user_id: userId,
          reservation_id: reservation.id,
        })
      );

      return res.status(201).json({
        id: reservation.id,
        event_id: reservation.event_id,
        tier_id: reservation.tier_id,
        quantity: reservation.quantity,
        expires_at: reservation.expires_at.toISOString(),
        expires_in_seconds: Math.floor((expiresAt.getTime() - new Date().getTime()) / 1000),
      });
    } catch (dbError: any) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Failed to create reservation', details: dbError.message });
    } finally {
      client.release();
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create reservation', details: error.message });
  }
});

/**
 * GET /events/:id/reservations?token=
 * Get active reservation for a user token
 */
router.get('/:id/reservations', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token is required' });
    }

    // Get active reservation for this user and event
    // Note: token parameter is kept for backward compatibility, but we should use userId
    const userId = req.header('x-user-id') || token;
    const reservationResult = await query<Reservation>(
      `SELECT r.*, t.name as tier_name, t.price_cents
       FROM reservations r
       JOIN ticket_tiers t ON r.tier_id = t.id
       WHERE r.event_id = $1 AND r.user_token = $2 AND r.status = 'active' AND r.expires_at > NOW()
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [id, userId]
    );

    if (reservationResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active reservation found' });
    }

    const reservation = reservationResult.rows[0] as Reservation & { tier_name: string; price_cents: number };
    const expiresInSeconds = Math.floor(
      (new Date(reservation.expires_at).getTime() - new Date().getTime()) / 1000
    );

    res.json({
      id: reservation.id,
      event_id: reservation.event_id,
      tier_id: reservation.tier_id,
      tier_name: reservation.tier_name,
      quantity: reservation.quantity,
      price_cents: reservation.price_cents,
      total_price_cents: reservation.quantity * reservation.price_cents,
      expires_at: reservation.expires_at.toISOString(),
      expires_in_seconds: Math.max(0, expiresInSeconds),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get reservation', details: error.message });
  }
});

export default router;

