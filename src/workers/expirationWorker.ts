import { createHmac } from 'crypto';
import { uuidv4 } from '../utils/uuid';
import { query, Reservation, Order, Ticket, getClient } from '../db';

const WORKER_INTERVAL_MS = 60_000; // 1 minute
const QR_SECRET = process.env.QR_SECRET || 'ticketdrop-secret-key-change-in-production';

function generateTicket(orderId: string, eventId: string, tierId: string, userToken: string): { code: string; qr_sig: string } {
  const code = uuidv4();
  const hmac = createHmac('sha256', QR_SECRET);
  hmac.update(`${code}:${orderId}:${eventId}`);
  const qr_sig = hmac.digest('hex');
  return { code, qr_sig };
}

export async function runExpirationWorker() {
  // 1. Expire reservations past expires_at and return inventory
  const expireClient = await getClient();
  try {
    await expireClient.query('BEGIN');

    // Only process reservations that changed from 'active' to 'expired' in this transaction
    // This ensures idempotency - same reservation won't be processed twice
    const expireResult = await expireClient.query<{ id: string; event_id: string; tier_id: string; quantity: number }>(
      `UPDATE reservations
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'active' AND expires_at <= NOW()
       RETURNING id, event_id, tier_id, quantity`
    );

    if (expireResult.rows.length > 0) {
      // Inventory is automatically restored because availability is calculated as:
      // capacity - (active reservations) - (sold orders)
      // When we mark reservations as expired, they're no longer counted as "active"
      // So no explicit Redis counter increment needed
      
      // Track metrics per event and tier
      const eventCounts = new Map<string, number>();
      for (const row of expireResult.rows) {
        eventCounts.set(row.event_id, (eventCounts.get(row.event_id) || 0) + 1);
      }

      console.log(JSON.stringify({
        level: 'info',
        msg: 'worker.reservations.expired',
        count: expireResult.rows.length,
        events_affected: Array.from(eventCounts.entries()).map(([eventId, count]) => ({ event_id: eventId, count })),
      }));
    }

    await expireClient.query('COMMIT');
  } catch (error: any) {
    await expireClient.query('ROLLBACK');
    console.error(JSON.stringify({
      level: 'error',
      msg: 'worker.expiration.error',
      error: error.message,
      stack: error.stack,
    }));
  } finally {
    expireClient.release();
  }

  // 2. Ensure paid orders have tickets (idempotent recovery)
  const ticketClient = await getClient();
  try {
    await ticketClient.query('BEGIN');

    // Only select orders that still need tickets (ensures idempotency)
    const ordersWithoutTickets = await ticketClient.query<Order & { ticket_count: number }>(
      `SELECT o.*, COALESCE(t.ticket_count, 0) as ticket_count
       FROM orders o
       LEFT JOIN (
         SELECT order_id, COUNT(*) as ticket_count
         FROM tickets
         GROUP BY order_id
       ) t ON o.id = t.order_id
       WHERE o.status = 'paid' AND COALESCE(t.ticket_count, 0) < o.quantity
       FOR UPDATE`
    );

    let totalTicketsRecovered = 0;
    for (const order of ordersWithoutTickets.rows) {
      const missing = order.quantity - order.ticket_count;
      
      // Generate all missing tickets in one transaction
      for (let i = 0; i < missing; i++) {
        const { code, qr_sig } = generateTicket(order.id, order.event_id, order.tier_id, order.user_token);
        await ticketClient.query<Ticket>(
          `INSERT INTO tickets (order_id, event_id, tier_id, user_token, code, qr_sig)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (code) DO NOTHING`,
          [order.id, order.event_id, order.tier_id, order.user_token, code, qr_sig]
        );
      }

      if (missing > 0) {
        totalTicketsRecovered += missing;
        console.log(JSON.stringify({
          level: 'info',
          msg: 'worker.tickets.repaired',
          order_id: order.id,
          missing,
          event_id: order.event_id,
        }));
      }
    }

    if (totalTicketsRecovered > 0) {
      console.log(JSON.stringify({
        level: 'info',
        msg: 'worker.tickets.recovery_summary',
        total_recovered: totalTicketsRecovered,
      }));
    }

    await ticketClient.query('COMMIT');
  } catch (error: any) {
    await ticketClient.query('ROLLBACK');
    console.error(JSON.stringify({
      level: 'error',
      msg: 'worker.tickets.error',
      error: error.message,
      stack: error.stack,
    }));
  } finally {
    ticketClient.release();
  }
}

export function startExpirationWorker() {
  console.log(JSON.stringify({
    level: 'info',
    msg: 'worker.start',
    interval_ms: WORKER_INTERVAL_MS,
  }));

  // Kick off immediately, then every minute
  runExpirationWorker();
  setInterval(runExpirationWorker, WORKER_INTERVAL_MS);
}


