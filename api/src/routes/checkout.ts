import { Router, Request, Response } from 'express';
import { createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, Reservation, CheckoutSession, Order, Ticket, getClient } from '../db';
import { rateLimit } from '../utils/rateLimiter';
import { metrics } from '../metrics';

const router = Router();

// HMAC secret for QR code signatures (in production, use env variable)
const QR_SECRET = process.env.QR_SECRET || 'ticketdrop-secret-key-change-in-production';

/**
 * Generate a ticket with unique code and HMAC signature
 */
function generateTicket(orderId: string, eventId: string, tierId: string, userToken: string): { code: string; qr_sig: string } {
  const code = uuidv4();
  const hmac = createHmac('sha256', QR_SECRET);
  hmac.update(`${code}:${orderId}:${eventId}`);
  const qr_sig = hmac.digest('hex');
  
  return { code, qr_sig };
}

/**
 * POST /checkout/sessions
 * Create an idempotent checkout session from a reservation
 * 
 * Headers:
 *   Idempotency-Key: string (required)
 * 
 * Body: {
 *   reservation_id: string
 * }
 */
router.post('/sessions', async (req: Request, res: Response) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    const userId = req.headers['x-user-id'] as string | undefined;
    const { reservation_id } = req.body;

    // Validate idempotency key
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return res.status(400).json({ 
        error: 'Idempotency-Key header is required' 
      });
    }

    if (!userId) {
      return res.status(400).json({
        error: 'X-User-Id header is required',
      });
    }

    // Rate limit checkout attempts per user
    const rateKey = `checkout:${userId}`;
    const { allowed, retryAfter } = await rateLimit(rateKey, 5, 60);
    if (!allowed) {
      metrics.rateLimitHits.inc({ endpoint: 'checkout_sessions' });
      res.setHeader('Retry-After', retryAfter ?? 60);
      return res.status(429).json({ 
        error: 'rate_limited',
        retryAfterSeconds: retryAfter ?? 60,
      });
    }

    // Validate reservation_id
    if (!reservation_id) {
      return res.status(400).json({ 
        error: 'reservation_id is required' 
      });
    }

    // Check if checkout session already exists for this idempotency key
    const existingSession = await query<CheckoutSession>(
      `SELECT * FROM checkout_sessions 
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (existingSession.rows.length > 0) {
      const session = existingSession.rows[0];
      
      // Get reservation details
      const reservationResult = await query<Reservation>(
        `SELECT r.*, t.name as tier_name, t.price_cents, t.event_id
         FROM reservations r
         JOIN ticket_tiers t ON r.tier_id = t.id
         WHERE r.id = $1`,
        [session.reservation_id]
      );

      if (reservationResult.rows.length === 0) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      const reservation = reservationResult.rows[0] as Reservation & { 
        tier_name: string; 
        price_cents: number;
        event_id: string;
      };

      // Return existing session (idempotent behavior)
      return res.json({
        id: session.id,
        reservation_id: session.reservation_id,
        status: session.status,
        reservation: {
          id: reservation.id,
          tier_name: reservation.tier_name,
          quantity: reservation.quantity,
          price_cents: reservation.price_cents,
          total_price_cents: reservation.quantity * reservation.price_cents,
          expires_at: reservation.expires_at.toISOString(),
        },
        created_at: session.created_at.toISOString(),
        message: 'Returning existing checkout session (idempotent)',
      });
    }

    // Verify reservation exists and is valid
    const reservationResult = await query<Reservation>(
      `SELECT r.*, t.name as tier_name, t.price_cents, t.event_id
       FROM reservations r
       JOIN ticket_tiers t ON r.tier_id = t.id
       WHERE r.id = $1`,
      [reservation_id]
    );

    if (reservationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    const reservation = reservationResult.rows[0] as Reservation & { 
      tier_name: string; 
      price_cents: number;
      event_id: string;
    };

    // Check if reservation is still active and not expired
    if (reservation.status !== 'active') {
      return res.status(409).json({ 
        error: 'Reservation is not active',
        status: reservation.status
      });
    }

    const now = new Date();
    const expiresAt = new Date(reservation.expires_at);
    
    if (now >= expiresAt) {
      // Mark reservation as expired
      await query(
        `UPDATE reservations SET status = 'expired' WHERE id = $1`,
        [reservation_id]
      );
      
      return res.status(409).json({ 
        error: 'Reservation has expired',
        expires_at: reservation.expires_at.toISOString()
      });
    }

    // Check if reservation already has a checkout session
    const existingReservationSession = await query<CheckoutSession>(
      `SELECT * FROM checkout_sessions 
       WHERE reservation_id = $1 AND status = 'pending'`,
      [reservation_id]
    );

    if (existingReservationSession.rows.length > 0) {
      // If same reservation but different idempotency key, return existing session
      const existingSession = existingReservationSession.rows[0];
      return res.json({
        id: existingSession.id,
        reservation_id: existingSession.reservation_id,
        status: existingSession.status,
        reservation: {
          id: reservation.id,
          tier_name: reservation.tier_name,
          quantity: reservation.quantity,
          price_cents: reservation.price_cents,
          total_price_cents: reservation.quantity * reservation.price_cents,
          expires_at: reservation.expires_at.toISOString(),
        },
        created_at: existingSession.created_at.toISOString(),
        message: 'Reservation already has a checkout session',
      });
    }

    // Extend reservation TTL when checkout session is created (give user more time to complete payment)
    // Extend by another 3 minutes (same as initial TTL)
    const extendedExpiresAt = new Date();
    extendedExpiresAt.setMinutes(extendedExpiresAt.getMinutes() + 3);
    
    await query(
      `UPDATE reservations 
       SET expires_at = $1, updated_at = NOW()
       WHERE id = $2 AND status = 'active'`,
      [extendedExpiresAt, reservation_id]
    );

    // Fetch updated reservation to get the new expiration time
    const updatedReservationResult = await query<Reservation>(
      `SELECT * FROM reservations WHERE id = $1`,
      [reservation_id]
    );
    const updatedReservation = updatedReservationResult.rows[0];

    // Create new checkout session
    const sessionResult = await query<CheckoutSession>(
      `INSERT INTO checkout_sessions (reservation_id, idempotency_key, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [reservation_id, idempotencyKey]
    );

    const session = sessionResult.rows[0];

    metrics.checkoutSessionsCreated.inc({ event_id: reservation.event_id });

    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'checkout.session.created',
        requestId: res.locals.requestId,
        checkout_session_id: session.id,
        reservation_id: reservation.id,
        event_id: reservation.event_id,
        user_id: userId,
      })
    );

    res.status(201).json({
      id: session.id,
      reservation_id: session.reservation_id,
      status: session.status,
      reservation: {
        id: updatedReservation.id,
        tier_name: reservation.tier_name,
        quantity: updatedReservation.quantity,
        price_cents: reservation.price_cents,
        total_price_cents: updatedReservation.quantity * reservation.price_cents,
        expires_at: updatedReservation.expires_at.toISOString(),
      },
      created_at: session.created_at.toISOString(),
    });
  } catch (error: any) {
    // Handle unique constraint violation (duplicate idempotency key)
    if (error.code === '23505') {
      // Retry: fetch existing session
      const idempotencyKey = req.headers['idempotency-key'] as string;
      const existingSession = await query<CheckoutSession>(
        `SELECT * FROM checkout_sessions 
         WHERE idempotency_key = $1`,
        [idempotencyKey]
      );

      if (existingSession.rows.length > 0) {
        const session = existingSession.rows[0];
        const reservationResult = await query<Reservation>(
          `SELECT r.*, t.name as tier_name, t.price_cents, t.event_id
           FROM reservations r
           JOIN ticket_tiers t ON r.tier_id = t.id
           WHERE r.id = $1`,
          [session.reservation_id]
        );

        if (reservationResult.rows.length > 0) {
          const reservation = reservationResult.rows[0] as Reservation & { 
            tier_name: string; 
            price_cents: number;
            event_id: string;
          };

          return res.json({
            id: session.id,
            reservation_id: session.reservation_id,
            status: session.status,
            reservation: {
              id: reservation.id,
              tier_name: reservation.tier_name,
              quantity: reservation.quantity,
              price_cents: reservation.price_cents,
              total_price_cents: reservation.quantity * reservation.price_cents,
              expires_at: reservation.expires_at.toISOString(),
            },
            created_at: session.created_at.toISOString(),
            message: 'Returning existing checkout session (idempotent)',
          });
        }
      }
    }

    res.status(500).json({ error: 'Failed to create checkout session', details: error.message });
  }
});

/**
 * GET /checkout/sessions/:id
 * Get checkout session details
 */
router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const sessionResult = await query<CheckoutSession>(
      `SELECT * FROM checkout_sessions WHERE id = $1`,
      [id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Checkout session not found' });
    }

    const session = sessionResult.rows[0];

    // Get reservation details
    const reservationResult = await query<Reservation>(
      `SELECT r.*, t.name as tier_name, t.price_cents, t.event_id
       FROM reservations r
       JOIN ticket_tiers t ON r.tier_id = t.id
       WHERE r.id = $1`,
      [session.reservation_id]
    );

    if (reservationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    const reservation = reservationResult.rows[0] as Reservation & { 
      tier_name: string; 
      price_cents: number;
      event_id: string;
    };

    res.json({
      id: session.id,
      reservation_id: session.reservation_id,
      status: session.status,
      reservation: {
        id: reservation.id,
        tier_name: reservation.tier_name,
        quantity: reservation.quantity,
        price_cents: reservation.price_cents,
        total_price_cents: reservation.quantity * reservation.price_cents,
        expires_at: reservation.expires_at.toISOString(),
      },
      created_at: session.created_at.toISOString(),
      updated_at: session.updated_at.toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get checkout session', details: error.message });
  }
});

/**
 * POST /checkout/confirm
 * Confirm payment and create order (idempotent)
 * 
 * Body: {
 *   checkout_id: string,
 *   simulate: "success" | "fail"
 * }
 */
router.post('/confirm', async (req: Request, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { checkout_id, simulate } = req.body;
    const userId = req.headers['x-user-id'] as string | undefined;

    // Rate limit checkout confirmations per user
    if (userId) {
      const rateKey = `checkout_confirm:${userId}`;
      const { allowed, retryAfter } = await rateLimit(rateKey, 10, 60);
      if (!allowed) {
        await client.query('ROLLBACK');
        metrics.rateLimitHits.inc({ endpoint: 'checkout_confirm' });
        res.setHeader('Retry-After', retryAfter ?? 60);
        return res.status(429).json({ 
          error: 'rate_limited',
          retryAfterSeconds: retryAfter ?? 60,
        });
      }
    }

    // Validate input
    if (!checkout_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'checkout_id is required' });
    }

    if (!simulate || (simulate !== 'success' && simulate !== 'fail')) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'simulate must be "success" or "fail"' 
      });
    }

    // Get checkout session with reservation details
    const sessionResult = await client.query<CheckoutSession & {
      reservation_id: string;
      event_id: string;
      tier_id: string;
      user_token: string;
      quantity: number;
      price_cents: number;
      tier_name: string;
    }>(
      `SELECT cs.*, 
              r.event_id, r.tier_id, r.user_token, r.quantity,
              t.price_cents, t.name as tier_name
       FROM checkout_sessions cs
       JOIN reservations r ON cs.reservation_id = r.id
       JOIN ticket_tiers t ON r.tier_id = t.id
       WHERE cs.id = $1`,
      [checkout_id]
    );

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Checkout session not found' });
    }

    const session = sessionResult.rows[0];

    // Check if order already exists (idempotency)
    const existingOrderResult = await client.query<Order>(
      `SELECT * FROM orders WHERE checkout_session_id = $1`,
      [checkout_id]
    );

    if (existingOrderResult.rows.length > 0) {
      // Order already exists, return it with tickets (idempotent behavior)
      const order = existingOrderResult.rows[0];
      
      // Get tickets for this order
      const ticketsResult = await client.query<Ticket>(
        `SELECT * FROM tickets WHERE order_id = $1`,
        [order.id]
      );
      
      await client.query('COMMIT');
      return res.json({
        order: {
          id: order.id,
          checkout_session_id: order.checkout_session_id,
          status: order.status,
          quantity: order.quantity,
          total_price_cents: order.total_price_cents,
          created_at: order.created_at.toISOString(),
        },
        tickets: ticketsResult.rows.map(t => ({
          id: t.id,
          code: t.code,
          qr_sig: t.qr_sig,
          created_at: t.created_at.toISOString(),
        })),
        checkout_session: {
          id: session.id,
          status: session.status,
        },
        message: 'Order already exists (idempotent)',
      });
    }

    // Verify checkout session is pending
    if (session.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ 
        error: `Checkout session is not pending (status: ${session.status})`,
        status: session.status
      });
    }

    // Explicitly load and validate reservation with FOR UPDATE lock
    // This ensures we check the reservation status/expiry at the moment of checkout
    const reservationResult = await client.query<Reservation>(
      `SELECT * FROM reservations 
       WHERE id = $1 
       FOR UPDATE`,
      [session.reservation_id]
    );

    if (reservationResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      // Mark checkout session as failed (in a new transaction)
      const updateClient = await getClient();
      try {
        await updateClient.query('BEGIN');
        await updateClient.query(
          `UPDATE checkout_sessions 
           SET status = 'failed', updated_at = NOW()
           WHERE id = $1`,
          [checkout_id]
        );
        await updateClient.query('COMMIT');
      } finally {
        updateClient.release();
      }
      metrics.reservationExpiredAtCheckout.inc({ event_id: session.event_id });
      return res.status(404).json({ 
        error: 'reservation_expired_or_invalid',
        message: 'Reservation not found'
      });
    }

    const reservation = reservationResult.rows[0];

    // Validate reservation is still active and not expired
    const now = new Date();
    const expiresAt = new Date(reservation.expires_at);
    
    if (reservation.status !== 'active') {
      await client.query('ROLLBACK');
      client.release();
      // Mark checkout session as failed (in a new transaction)
      const updateClient = await getClient();
      try {
        await updateClient.query('BEGIN');
        await updateClient.query(
          `UPDATE checkout_sessions 
           SET status = 'failed', updated_at = NOW()
           WHERE id = $1`,
          [checkout_id]
        );
        await updateClient.query('COMMIT');
      } finally {
        updateClient.release();
      }
      metrics.reservationExpiredAtCheckout.inc({ event_id: session.event_id });
      console.log(
        JSON.stringify({
          level: 'warn',
          msg: 'checkout.confirm.rejected.invalid_reservation',
          requestId: res.locals.requestId,
          checkout_session_id: checkout_id,
          reservation_id: reservation.id,
          reservation_status: reservation.status,
          event_id: session.event_id,
          user_id: userId,
        })
      );
      return res.status(409).json({ 
        error: 'reservation_expired_or_invalid',
        message: `Reservation is not active (status: ${reservation.status})`
      });
    }

    if (now >= expiresAt) {
      // Mark reservation as expired
      await client.query(
        `UPDATE reservations SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [reservation.id]
      );
      // Mark checkout session as expired
      await client.query(
        `UPDATE checkout_sessions 
         SET status = 'expired', updated_at = NOW()
         WHERE id = $1`,
        [checkout_id]
      );
      await client.query('COMMIT');
      client.release();
      metrics.reservationExpiredAtCheckout.inc({ event_id: session.event_id });
      console.log(
        JSON.stringify({
          level: 'warn',
          msg: 'checkout.confirm.rejected.expired_reservation',
          requestId: res.locals.requestId,
          checkout_session_id: checkout_id,
          reservation_id: reservation.id,
          expires_at: reservation.expires_at.toISOString(),
          event_id: session.event_id,
          user_id: userId,
        })
      );
      return res.status(409).json({ 
        error: 'reservation_expired_or_invalid',
        message: 'Reservation has expired',
        expires_at: reservation.expires_at.toISOString()
      });
    }

    // Simulate payment
    if (simulate === 'success') {
      // Payment successful: create order, update checkout session, update reservation
      const totalPriceCents = session.quantity * session.price_cents;

      // Create order
      const orderResult = await client.query<Order>(
        `INSERT INTO orders (
          checkout_session_id, reservation_id, event_id, tier_id,
          user_token, quantity, total_price_cents, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid')
        RETURNING *`,
        [
          checkout_id,
          session.reservation_id,
          session.event_id,
          session.tier_id,
          session.user_token,
          session.quantity,
          totalPriceCents,
        ]
      );

      const order = orderResult.rows[0];

      // Check if tickets already exist for this order (idempotency)
      const existingTicketsResult = await client.query<Ticket>(
        `SELECT * FROM tickets WHERE order_id = $1`,
        [order.id]
      );

      let tickets: Ticket[] = [];
      
      if (existingTicketsResult.rows.length === 0) {
        // Generate tickets (one per quantity)
        const ticketPromises = [];
        for (let i = 0; i < session.quantity; i++) {
          const { code, qr_sig } = generateTicket(order.id, session.event_id, session.tier_id, session.user_token);
          ticketPromises.push(
            client.query<Ticket>(
              `INSERT INTO tickets (order_id, event_id, tier_id, user_token, code, qr_sig)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING *`,
              [order.id, session.event_id, session.tier_id, session.user_token, code, qr_sig]
            )
          );
        }
        
        const ticketResults = await Promise.all(ticketPromises);
        tickets = ticketResults.map(result => result.rows[0]);
      } else {
        // Tickets already exist, return them
        tickets = existingTicketsResult.rows;
      }

      // Update checkout session to completed
      await client.query(
        `UPDATE checkout_sessions 
         SET status = 'completed', updated_at = NOW()
         WHERE id = $1`,
        [checkout_id]
      );

      // Update reservation to converted
      await client.query(
        `UPDATE reservations 
         SET status = 'converted', updated_at = NOW()
         WHERE id = $1`,
        [session.reservation_id]
      );

      await client.query('COMMIT');

      metrics.ordersCreated.inc({ event_id: session.event_id });
      metrics.checkoutConfirmationsSuccess.inc({ event_id: session.event_id });
      console.log(
        JSON.stringify({
          level: 'info',
          msg: 'order.created',
          requestId: res.locals.requestId,
          order_id: order.id,
          checkout_session_id: session.id,
          event_id: session.event_id,
          quantity: order.quantity,
        })
      );

      res.status(201).json({
        order: {
          id: order.id,
          checkout_session_id: order.checkout_session_id,
          status: order.status,
          quantity: order.quantity,
          total_price_cents: order.total_price_cents,
          created_at: order.created_at.toISOString(),
        },
        tickets: tickets.map(t => ({
          id: t.id,
          code: t.code,
          qr_sig: t.qr_sig,
          created_at: t.created_at.toISOString(),
        })),
        checkout_session: {
          id: session.id,
          status: 'completed',
        },
        reservation: {
          id: session.reservation_id,
          status: 'converted',
        },
        message: 'Payment successful, order created',
      });

    } else {
      // Payment failed: update checkout session, cancel reservation
      // Update checkout session to failed
      await client.query(
        `UPDATE checkout_sessions 
         SET status = 'failed', updated_at = NOW()
         WHERE id = $1`,
        [checkout_id]
      );

      // Update reservation to canceled (releases inventory)
      await client.query(
        `UPDATE reservations 
         SET status = 'canceled', updated_at = NOW()
         WHERE id = $1`,
        [session.reservation_id]
      );

      await client.query('COMMIT');

      metrics.checkoutConfirmationsFailed.inc({ event_id: session.event_id });
      console.log(
        JSON.stringify({
          level: 'info',
          msg: 'checkout.confirm.failed',
          requestId: res.locals.requestId,
          checkout_session_id: checkout_id,
          event_id: session.event_id,
          user_id: userId,
        })
      );

      res.json({
        checkout_session: {
          id: session.id,
          status: 'failed',
        },
        reservation: {
          id: session.reservation_id,
          status: 'canceled',
        },
        message: 'Payment failed, reservation canceled',
      });
    }

  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ 
      error: 'Failed to confirm checkout', 
      details: error.message 
    });
  } finally {
    client.release();
  }
});

export default router;

