import { Router, Request, Response } from 'express';
import { query, Ticket, Order } from '../db';

const router = Router();

/**
 * GET /me/tickets
 * Get all tickets for a user (uses X-User-Id header)
 * 
 * Headers:
 *   X-User-Id: string (canonical user identifier)
 */
router.get('/me/tickets', async (req: Request, res: Response) => {
  try {
    const userId = req.header('x-user-id');

    if (!userId) {
      return res.status(400).json({ error: 'X-User-Id header is required' });
    }

    // Get all tickets for this user with event and tier details
    const ticketsResult = await query<Ticket & {
      event_name: string;
      event_venue: string;
      event_starts_at: Date;
      tier_name: string;
      tier_price_cents: number;
      order_id: string;
    }>(
      `SELECT t.*, 
              e.name as event_name, 
              e.venue as event_venue, 
              e.starts_at as event_starts_at,
              tt.name as tier_name,
              tt.price_cents as tier_price_cents
       FROM tickets t
       JOIN events e ON t.event_id = e.id
       JOIN ticket_tiers tt ON t.tier_id = tt.id
       WHERE t.user_token = $1
       ORDER BY t.created_at DESC`,
      [userId]
    );

    const tickets = ticketsResult.rows.map(ticket => ({
      id: ticket.id,
      code: ticket.code,
      qr_sig: ticket.qr_sig,
      event: {
        id: ticket.event_id,
        name: ticket.event_name,
        venue: ticket.event_venue,
        starts_at: ticket.event_starts_at.toISOString(),
      },
      tier: {
        id: ticket.tier_id,
        name: ticket.tier_name,
        price_cents: ticket.tier_price_cents,
      },
      order_id: ticket.order_id,
      created_at: ticket.created_at.toISOString(),
    }));

    res.json({
      tickets,
      count: tickets.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch tickets', details: error.message });
  }
});

/**
 * GET /me/order?event_id=
 * Fetch the most recent order (and its tickets) for a user (uses X-User-Id header).
 * Optionally scope to a specific event.
 */
router.get('/me/order', async (req: Request, res: Response) => {
  try {
    const userId = req.header('x-user-id');
    const { event_id } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'X-User-Id header is required' });
    }

    const params: any[] = [userId];
    let whereClause = 'o.user_token = $1';

    if (event_id && typeof event_id === 'string') {
      params.push(event_id);
      whereClause += ` AND o.event_id = $${params.length}`;
    }

    const orderResult = await query<
      Order & {
        event_name: string;
        event_venue: string;
        event_starts_at: Date;
        tier_name: string;
        tier_price_cents: number;
      }
    >(
      `SELECT o.*,
              e.name as event_name,
              e.venue as event_venue,
              e.starts_at as event_starts_at,
              tt.name as tier_name,
              tt.price_cents as tier_price_cents
       FROM orders o
       JOIN events e ON o.event_id = e.id
       JOIN ticket_tiers tt ON o.tier_id = tt.id
       WHERE ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT 1`,
      params
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'No order found' });
    }

    const order = orderResult.rows[0];

    const ticketsResult = await query<Ticket>(
      `SELECT *
       FROM tickets
       WHERE order_id = $1
       ORDER BY created_at ASC`,
      [order.id]
    );

    res.json({
      order: {
        id: order.id,
        checkout_session_id: order.checkout_session_id,
        status: order.status,
        quantity: order.quantity,
        total_price_cents: order.total_price_cents,
        created_at: order.created_at.toISOString(),
        event_id: order.event_id,
        event_name: order.event_name,
        event_venue: order.event_venue,
        event_starts_at: order.event_starts_at.toISOString(),
        tier_id: order.tier_id,
        tier_name: order.tier_name,
        tier_price_cents: order.tier_price_cents,
      },
      tickets: ticketsResult.rows.map((ticket) => ({
        id: ticket.id,
        code: ticket.code,
        qr_sig: ticket.qr_sig,
        created_at: ticket.created_at.toISOString(),
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch order', details: error.message });
  }
});

export default router;

