import { Router, Request, Response } from 'express';
import { query, TicketTier, Event } from '../../db';

const router = Router();

interface CreateTierBody {
  event_id: string;
  name: string;
  price_cents: number;
  capacity: number;
  per_user_limit?: number;
}

router.post('/', async (req: Request<{}, {}, CreateTierBody>, res: Response) => {
  try {
    const { event_id, name, price_cents, capacity, per_user_limit = 4 } = req.body;

    if (!event_id || !name || price_cents === undefined || capacity === undefined) {
      return res.status(400).json({ error: 'Missing required fields: event_id, name, price_cents, capacity' });
    }

    // Verify event exists
    const eventResult = await query<Event>('SELECT id FROM events WHERE id = $1', [event_id]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const result = await query<TicketTier>(
      `INSERT INTO ticket_tiers (event_id, name, price_cents, capacity, per_user_limit)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [event_id, name, price_cents, capacity, per_user_limit]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.constraint === 'uq_ticket_tiers_event_name') {
      return res.status(400).json({ error: 'A tier with this name already exists for this event' });
    }
    res.status(500).json({ error: 'Failed to create ticket tier', details: error.message });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const { event_id } = req.query;
    
    if (event_id) {
      const result = await query<TicketTier>(
        'SELECT * FROM ticket_tiers WHERE event_id = $1 ORDER BY created_at DESC',
        [event_id as string]
      );
      return res.json(result.rows);
    }

    const result = await query<TicketTier>('SELECT * FROM ticket_tiers ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch ticket tiers', details: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query<TicketTier>('SELECT * FROM ticket_tiers WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket tier not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch ticket tier', details: error.message });
  }
});

export default router;

