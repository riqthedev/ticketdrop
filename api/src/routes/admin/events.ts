import { Router, Request, Response } from 'express';
import { query, Event, getClient } from '../../db';

const router = Router();

interface CreateEventBody {
  name: string;
  venue: string;
  description?: string;
  starts_at: string;
  on_sale_at: string;
  status?: 'draft' | 'scheduled' | 'on_sale' | 'closed' | 'canceled';
}

router.post('/', async (req: Request<{}, {}, CreateEventBody>, res: Response) => {
  try {
    const { name, venue, description, starts_at, on_sale_at, status = 'draft' } = req.body;

    if (!name || !venue || !starts_at || !on_sale_at) {
      return res.status(400).json({ error: 'Missing required fields: name, venue, starts_at, on_sale_at' });
    }

    const result = await query<Event>(
      `INSERT INTO events (name, venue, description, starts_at, on_sale_at, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, venue, description || null, starts_at, on_sale_at, status]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.constraint === 'events_on_sale_before_start') {
      return res.status(400).json({ error: 'on_sale_at must be before or equal to starts_at' });
    }
    res.status(500).json({ error: 'Failed to create event', details: error.message });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query<Event>('SELECT * FROM events ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch events', details: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query<Event>('SELECT * FROM events WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch event', details: error.message });
  }
});

/**
 * DELETE /admin/events/:id/orders
 * Clear all orders and tickets for an event (admin only)
 */
router.delete('/:id/orders', async (req: Request, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Verify event exists
    const eventResult = await client.query<Event>(
      'SELECT * FROM events WHERE id = $1',
      [id]
    );

    if (eventResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Event not found' });
    }

    // Count tickets before deletion
    const ticketsCountResult = await client.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM tickets WHERE event_id = $1',
      [id]
    );
    const ticketsCount = parseInt(ticketsCountResult.rows[0]?.count || '0', 10);

    // Count orders before deletion
    const ordersCountResult = await client.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM orders WHERE event_id = $1',
      [id]
    );
    const ordersCount = parseInt(ordersCountResult.rows[0]?.count || '0', 10);

    // Delete tickets (cascade will handle related data)
    await client.query('DELETE FROM tickets WHERE event_id = $1', [id]);

    // Delete orders
    await client.query('DELETE FROM orders WHERE event_id = $1', [id]);

    // Also update reservations to canceled to release inventory
    await client.query(
      `UPDATE reservations SET status = 'canceled', updated_at = NOW() 
       WHERE event_id = $1 AND status IN ('active', 'converted')`,
      [id]
    );

    // Update checkout sessions to expired
    await client.query(
      `UPDATE checkout_sessions cs
       SET status = 'expired', updated_at = NOW()
       FROM orders o
       WHERE cs.id = o.checkout_session_id AND o.event_id = $1 AND cs.status = 'pending'`,
      [id]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Orders and tickets cleared successfully',
      tickets_deleted: ticketsCount,
      orders_deleted: ordersCount,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to clear orders and tickets', details: error.message });
  } finally {
    client.release();
  }
});

/**
 * POST /admin/events/:id/pause
 * Pause sales for an event (blocks new reservations, sets canEnter = false)
 */
router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify event exists
    const eventResult = await query<Event>(
      'SELECT * FROM events WHERE id = $1',
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Update event to paused
    const result = await query<Event>(
      `UPDATE events 
       SET paused = true, updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    res.json({
      message: 'Event sales paused successfully',
      event: result.rows[0],
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to pause event', details: error.message });
  }
});

/**
 * POST /admin/events/:id/resume
 * Resume sales for an event
 */
router.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify event exists
    const eventResult = await query<Event>(
      'SELECT * FROM events WHERE id = $1',
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Update event to not paused
    const result = await query<Event>(
      `UPDATE events 
       SET paused = false, updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    res.json({
      message: 'Event sales resumed successfully',
      event: result.rows[0],
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to resume event', details: error.message });
  }
});

/**
 * GET /admin/events/:id/status
 * Get event status: capacity, sold, active holds, queue length
 */
router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify event exists
    const eventResult = await query<Event>(
      'SELECT * FROM events WHERE id = $1',
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];

    // Get all tiers for this event
    const tiersResult = await query<{ id: string; name: string; capacity: number }>(
      'SELECT id, name, capacity FROM ticket_tiers WHERE event_id = $1',
      [id]
    );

    // Calculate totals
    let totalCapacity = 0;
    let totalSold = 0;
    let totalActiveHolds = 0;

    const tierStatuses = await Promise.all(
      tiersResult.rows.map(async (tier) => {
        totalCapacity += tier.capacity;

        // Count sold tickets
        const soldResult = await query<{ count: string }>(
          `SELECT COALESCE(SUM(quantity), 0) as count 
           FROM orders 
           WHERE tier_id = $1 AND status = 'paid'`,
          [tier.id]
        );
        const sold = parseInt(soldResult.rows[0]?.count || '0', 10);
        totalSold += sold;

        // Count active reservations
        const holdsResult = await query<{ count: string }>(
          `SELECT COALESCE(SUM(quantity), 0) as count 
           FROM reservations 
           WHERE tier_id = $1 AND status = 'active' AND expires_at > NOW()`,
          [tier.id]
        );
        const holds = parseInt(holdsResult.rows[0]?.count || '0', 10);
        totalActiveHolds += holds;

        return {
          tier_id: tier.id,
          tier_name: tier.name,
          capacity: tier.capacity,
          sold,
          active_holds: holds,
          available: tier.capacity - sold - holds,
        };
      })
    );

    // Get queue length from Redis sorted set (scalable, no key scanning)
    const redis = (await import('../../redis')).default;
    const queueKey = `waiting_room:queue:${id}`;
    const actualQueueLength = await redis.zcard(queueKey);

    res.json({
      event_id: id,
      event_name: event.name,
      paused: event.paused,
      status: event.status,
      total_capacity: totalCapacity,
      total_sold: totalSold,
      total_active_holds: totalActiveHolds,
      total_available: totalCapacity - totalSold - totalActiveHolds,
      queue_length: actualQueueLength,
      tiers: tierStatuses,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get event status', details: error.message });
  }
});

export default router;

