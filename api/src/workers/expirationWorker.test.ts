import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { query, getClient } from '../db';
import { runExpirationWorker } from './expirationWorker';
import { uuidv4 } from '../utils/uuid';

// Note: These tests require a running database and Redis instance
// Run with: npm test (after setting up test environment)

describe('Expiration Worker', () => {
  let testEventId: string;
  let testTierId: string;
  let testUserId: string;

  beforeAll(async () => {
    // Create test event and tier
    testUserId = `test-user-${uuidv4()}`;
    
    const eventResult = await query(
      `INSERT INTO events (name, venue, starts_at, on_sale_at, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        'Test Event',
        'Test Venue',
        new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        new Date(Date.now() - 3600000).toISOString(), // 1 hour ago (on sale)
        'on_sale'
      ]
    );
    testEventId = eventResult.rows[0].id;

    const tierResult = await query(
      `INSERT INTO ticket_tiers (event_id, name, price_cents, capacity, per_user_limit)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [testEventId, 'Test Tier', 5000, 100, 4]
    );
    testTierId = tierResult.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup test data
    await query('DELETE FROM tickets WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM orders WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM reservations WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM ticket_tiers WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM events WHERE id = $1', [testEventId]);
  });

  beforeEach(async () => {
    // Clean up reservations and orders before each test
    await query('DELETE FROM tickets WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM orders WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM reservations WHERE event_id = $1', [testEventId]);
  });

  it('should expire reservations past expires_at and restore inventory', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Create an expired reservation
      const pastDate = new Date(Date.now() - 60000); // 1 minute ago
      const reservationResult = await client.query(
        `INSERT INTO reservations (event_id, tier_id, user_token, quantity, status, expires_at)
         VALUES ($1, $2, $3, $4, 'active', $5)
         RETURNING id, quantity`,
        [testEventId, testTierId, testUserId, 5, pastDate]
      );
      const reservationId = reservationResult.rows[0].id;

      await client.query('COMMIT');

      // Check availability before expiration (should be reduced by reservation)
      const beforeResult = await query(
        `SELECT 
          t.capacity,
          COALESCE(SUM(CASE WHEN r.status = 'active' AND r.expires_at > NOW() THEN r.quantity ELSE 0 END), 0) as reserved,
          COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.quantity ELSE 0 END), 0) as sold
         FROM ticket_tiers t
         LEFT JOIN reservations r ON t.id = r.tier_id
         LEFT JOIN orders o ON t.id = o.tier_id
         WHERE t.id = $1
         GROUP BY t.id, t.capacity`,
        [testTierId]
      );
      const beforeAvailable = beforeResult.rows[0].capacity - beforeResult.rows[0].reserved - beforeResult.rows[0].sold;

      // Run expiration worker
      await runExpirationWorker();

      // Check that reservation is expired
      const reservationCheck = await query(
        'SELECT status FROM reservations WHERE id = $1',
        [reservationId]
      );
      expect(reservationCheck.rows[0].status).toBe('expired');

      // Check availability after expiration (should be restored)
      const afterResult = await query(
        `SELECT 
          t.capacity,
          COALESCE(SUM(CASE WHEN r.status = 'active' AND r.expires_at > NOW() THEN r.quantity ELSE 0 END), 0) as reserved,
          COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.quantity ELSE 0 END), 0) as sold
         FROM ticket_tiers t
         LEFT JOIN reservations r ON t.id = r.tier_id
         LEFT JOIN orders o ON t.id = o.tier_id
         WHERE t.id = $1
         GROUP BY t.id, t.capacity`,
        [testTierId]
      );
      const afterAvailable = afterResult.rows[0].capacity - afterResult.rows[0].reserved - afterResult.rows[0].sold;

      // Available should increase by the expired reservation quantity
      expect(afterAvailable).toBe(beforeAvailable + 5);
    } finally {
      client.release();
    }
  });

  it('should recover tickets for paid orders missing tickets', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Create a paid order without tickets
      const orderResult = await client.query(
        `INSERT INTO orders (
          checkout_session_id, reservation_id, event_id, tier_id,
          user_token, quantity, total_price_cents, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid')
        RETURNING id`,
        [
          uuidv4(), // fake checkout session id
          uuidv4(), // fake reservation id
          testEventId,
          testTierId,
          testUserId,
          3,
          15000
        ]
      );
      const orderId = orderResult.rows[0].id;

      await client.query('COMMIT');

      // Verify no tickets exist
      const beforeTickets = await query(
        'SELECT COUNT(*) as count FROM tickets WHERE order_id = $1',
        [orderId]
      );
      expect(parseInt(beforeTickets.rows[0].count, 10)).toBe(0);

      // Run worker
      await runExpirationWorker();

      // Verify tickets were created
      const afterTickets = await query(
        'SELECT COUNT(*) as count FROM tickets WHERE order_id = $1',
        [orderId]
      );
      expect(parseInt(afterTickets.rows[0].count, 10)).toBe(3);

      // Run worker again (idempotency test)
      await runExpirationWorker();

      // Should still be exactly 3 tickets (not 6)
      const finalTickets = await query(
        'SELECT COUNT(*) as count FROM tickets WHERE order_id = $1',
        [orderId]
      );
      expect(parseInt(finalTickets.rows[0].count, 10)).toBe(3);
    } finally {
      client.release();
    }
  });
});

