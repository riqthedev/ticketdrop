import { Router, Request, Response } from 'express';
import { query, Event, TicketTier } from '../db';

const router = Router();

// Public event response type (without internal fields)
interface PublicEvent {
  id: string;
  name: string;
  venue: string;
  description: string | null;
  starts_at: Date;
  on_sale_at: Date;
  status: 'draft' | 'scheduled' | 'on_sale' | 'closed' | 'canceled';
}

// Public tier response type (without internal fields)
interface PublicTier {
  id: string;
  event_id: string;
  name: string;
  price_cents: number;
  capacity: number;
  per_user_limit: number;
}

// Helper to convert Event to PublicEvent
function toPublicEvent(event: Event): PublicEvent {
  return {
    id: event.id,
    name: event.name,
    venue: event.venue,
    description: event.description,
    starts_at: event.starts_at,
    on_sale_at: event.on_sale_at,
    status: event.status,
  };
}

// Helper to convert TicketTier to PublicTier
function toPublicTier(tier: TicketTier): PublicTier {
  return {
    id: tier.id,
    event_id: tier.event_id,
    name: tier.name,
    price_cents: tier.price_cents,
    capacity: tier.capacity,
    per_user_limit: tier.per_user_limit,
  };
}

// GET /events - List all non-draft events
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query<Event>(
      `SELECT * FROM events 
       WHERE status != 'draft' 
       ORDER BY starts_at ASC`
    );
    
    const publicEvents = result.rows.map(toPublicEvent);
    res.json(publicEvents);
  } catch (error: any) {
    console.error('Error fetching events:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
      // Log connection info for debugging (without sensitive data)
      hasConnectionString: !!(process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL),
      hasDbHost: !!process.env.DB_HOST,
      connectionStringPreview: process.env.DATABASE_URL ? 
        process.env.DATABASE_URL.substring(0, 50) + '...' : 'NOT SET',
    });
    
    // Provide more helpful error messages
    let errorMessage = 'Failed to fetch events';
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      errorMessage = 'Database connection failed. Please check your database configuration.';
      if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL && !process.env.POSTGRES_PRISMA_URL) {
        errorMessage += ' DATABASE_URL environment variable is not set.';
      }
    } else if (error.message?.includes('relation') || error.message?.includes('does not exist')) {
      errorMessage = 'Database tables not found. Please initialize the database schema.';
    }
    
    res.status(500).json({ 
      error: errorMessage,
      code: error.code,
      // Show more details in production for debugging (but not sensitive data)
      ...(process.env.VERCEL && { 
        hint: 'Check Vercel function logs for details. Verify DATABASE_URL is set in environment variables.' 
      })
    });
  }
});

// GET /events/:id/availability - Get real-time ticket availability per tier
// NOTE: This route must come before /:id to avoid route matching conflicts
router.get('/:id/availability', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
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
    
    // Get all tiers for this event
    const tiersResult = await query<TicketTier>(
      'SELECT * FROM ticket_tiers WHERE event_id = $1 ORDER BY price_cents ASC',
      [id]
    );

    // Calculate availability for each tier
    // For now, since we don't have reservations/orders yet:
    // - available = capacity (nothing reserved/sold yet)
    // - reserved = 0
    // - sold = 0
    // This will be updated when Features 5-7 are implemented
    
    // Calculate availability for each tier
    const availability = await Promise.all(
      tiersResult.rows.map(async (tier) => {
        // Count active reservations for this tier
        const reservationsResult = await query<{ count: string }>(
          `SELECT COALESCE(SUM(quantity), 0) as count 
           FROM reservations 
           WHERE tier_id = $1 AND status = 'active' AND expires_at > NOW()`,
          [tier.id]
        );
        const reserved = parseInt(reservationsResult.rows[0]?.count || '0', 10);
        
        // Count sold tickets from orders
        const ordersResult = await query<{ count: string }>(
          `SELECT COALESCE(SUM(quantity), 0) as count 
           FROM orders 
           WHERE tier_id = $1 AND status = 'paid'`,
          [tier.id]
        );
        const sold = parseInt(ordersResult.rows[0]?.count || '0', 10);
        
        const available = Math.max(0, tier.capacity - reserved - sold);
        
        return {
          tier_id: tier.id,
          tier_name: tier.name,
          capacity: tier.capacity,
          available,
          reserved,
          sold,
          price_cents: tier.price_cents,
          per_user_limit: tier.per_user_limit,
        };
      })
    );

    res.json({
      event_id: id,
      event_name: event.name,
      availability,
      last_updated: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch availability', details: error.message });
  }
});

// GET /events/:id - Get event with tiers
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Get event
    const eventResult = await query<Event>(
      `SELECT * FROM events 
       WHERE id = $1 AND status != 'draft'`,
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];
    
    // Get tiers for this event
    const tiersResult = await query<TicketTier>(
      'SELECT * FROM ticket_tiers WHERE event_id = $1 ORDER BY price_cents ASC',
      [id]
    );

    const publicEvent = toPublicEvent(event);
    const publicTiers = tiersResult.rows.map(toPublicTier);

    res.json({
      ...publicEvent,
      tiers: publicTiers,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch event', details: error.message });
  }
});

export default router;

