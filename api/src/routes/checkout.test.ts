import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { query } from '../db';
import { uuidv4 } from '../utils/uuid';
import express from 'express';
import request from 'supertest';
import checkoutRouter from './checkout';

// Note: These tests require a running database
// Run with: npm test (after setting up test environment)

const app = express();
app.use(express.json());
app.use('/checkout', checkoutRouter);

describe('Checkout Idempotency', () => {
  let testEventId: string;
  let testTierId: string;
  let testUserId: string;
  let testReservationId: string;

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
        new Date(Date.now() + 86400000).toISOString(),
        new Date(Date.now() - 3600000).toISOString(),
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
    // Cleanup
    await query('DELETE FROM tickets WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM orders WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM checkout_sessions WHERE reservation_id = $1', [testReservationId]);
    await query('DELETE FROM reservations WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM ticket_tiers WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM events WHERE id = $1', [testEventId]);
  });

  beforeEach(async () => {
    // Clean up and create fresh reservation
    await query('DELETE FROM tickets WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM orders WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM checkout_sessions WHERE reservation_id = $1', [testReservationId]);
    await query('DELETE FROM reservations WHERE event_id = $1', [testEventId]);

    // Create active reservation
    const expiresAt = new Date(Date.now() + 180000); // 3 minutes from now
    const reservationResult = await query(
      `INSERT INTO reservations (event_id, tier_id, user_token, quantity, status, expires_at)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING id`,
      [testEventId, testTierId, testUserId, 2, expiresAt]
    );
    testReservationId = reservationResult.rows[0].id;
  });

  it('should return same session ID for duplicate idempotency keys', async () => {
    const idempotencyKey = `test-key-${uuidv4()}`;

    // First request
    const response1 = await request(app)
      .post('/checkout/sessions')
      .set('Idempotency-Key', idempotencyKey)
      .set('X-User-Id', testUserId)
      .send({ reservation_id: testReservationId });

    expect(response1.status).toBe(201);
    const sessionId1 = response1.body.id;

    // Second request with same idempotency key
    const response2 = await request(app)
      .post('/checkout/sessions')
      .set('Idempotency-Key', idempotencyKey)
      .set('X-User-Id', testUserId)
      .send({ reservation_id: testReservationId });

    expect(response2.status).toBe(200);
    expect(response2.body.id).toBe(sessionId1);
    expect(response2.body.message).toContain('idempotent');
  });

  it('should create exactly one order when confirm is called twice', async () => {
    const idempotencyKey = `test-key-${uuidv4()}`;

    // Create checkout session
    const sessionResponse = await request(app)
      .post('/checkout/sessions')
      .set('Idempotency-Key', idempotencyKey)
      .set('X-User-Id', testUserId)
      .send({ reservation_id: testReservationId });

    expect(sessionResponse.status).toBe(201);
    const checkoutId = sessionResponse.body.id;

    // First confirm
    const confirm1 = await request(app)
      .post('/checkout/confirm')
      .set('X-User-Id', testUserId)
      .send({
        checkout_id: checkoutId,
        simulate: 'success'
      });

    expect(confirm1.status).toBe(201);
    const orderId1 = confirm1.body.order.id;

    // Second confirm (should be idempotent)
    const confirm2 = await request(app)
      .post('/checkout/confirm')
      .set('X-User-Id', testUserId)
      .send({
        checkout_id: checkoutId,
        simulate: 'success'
      });

    expect(confirm2.status).toBe(200);
    expect(confirm2.body.order.id).toBe(orderId1);
    expect(confirm2.body.message).toContain('idempotent');

    // Verify only one order exists
    const orders = await query(
      'SELECT COUNT(*) as count FROM orders WHERE checkout_session_id = $1',
      [checkoutId]
    );
    expect(parseInt(orders.rows[0].count, 10)).toBe(1);

    // Verify exactly 2 tickets exist (one per quantity)
    const tickets = await query(
      'SELECT COUNT(*) as count FROM tickets WHERE order_id = $1',
      [orderId1]
    );
    expect(parseInt(tickets.rows[0].count, 10)).toBe(2);
  });
});

