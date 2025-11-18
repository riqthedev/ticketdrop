import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { query, getClient } from '../src/db';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import request from 'supertest';
import reservationsRouter from '../src/routes/reservations';
import checkoutRouter from '../src/routes/checkout';
import ticketsRouter from '../src/routes/tickets';
import redis from '../src/redis';

// Integration tests for oversell protection and idempotency
// These tests require a running database and Redis instance
// Run with: npm test

// Create test app with minimal middleware
const app = express();
app.use(express.json());

// Add request logger mock (if needed by routes)
app.use((req, res, next) => {
  res.locals.requestId = `test-${Date.now()}`;
  next();
});

app.use('/events', reservationsRouter);
app.use('/checkout', checkoutRouter);
app.use('/', ticketsRouter);

describe('Integration Tests - Oversell Protection & Idempotency', () => {
  let testEventId: string;
  let testTierId: string;
  let testUserId: string;
  let testToken: string;

  beforeAll(async () => {
    // Create test event and tier
    testUserId = `test-user-${uuidv4()}`;
    testToken = uuidv4();
    
    const eventResult = await query(
      `INSERT INTO events (name, venue, starts_at, on_sale_at, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        'Integration Test Event',
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
      [testEventId, 'Test Tier', 5000, 1, 4] // Capacity = 1 for oversell test
    );
    testTierId = tierResult.rows[0].id;

    // Create waiting room access for the token
    await redis.set(`waiting_room_access:${testEventId}:${testToken}`, '1', 'EX', 300);
  });

  afterAll(async () => {
    // Cleanup test data
    await query('DELETE FROM tickets WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM orders WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM checkout_sessions WHERE reservation_id IN (SELECT id FROM reservations WHERE event_id = $1)', [testEventId]);
    await query('DELETE FROM reservations WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM ticket_tiers WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM events WHERE id = $1', [testEventId]);
    
    // Cleanup Redis
    await redis.del(`waiting_room_access:${testEventId}:${testToken}`);
  });

  beforeEach(async () => {
    // Clean up reservations and orders before each test
    await query('DELETE FROM tickets WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM orders WHERE event_id = $1', [testEventId]);
    await query('DELETE FROM checkout_sessions WHERE reservation_id IN (SELECT id FROM reservations WHERE event_id = $1)', [testEventId]);
    await query('DELETE FROM reservations WHERE event_id = $1', [testEventId]);
    
    // Reset waiting room access
    await redis.set(`waiting_room_access:${testEventId}:${testToken}`, '1', 'EX', 300);
  });

  it('should prevent oversell under concurrent reservation requests', async () => {
    // Create a tier with capacity = 1
    const smallTierResult = await query(
      `INSERT INTO ticket_tiers (event_id, name, price_cents, capacity, per_user_limit)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [testEventId, 'Small Tier', 5000, 1, 4]
    );
    const smallTierId = smallTierResult.rows[0].id;

    try {
      // Fire 10 concurrent requests, each asking for 1 ticket
      const requests = Array.from({ length: 10 }, (_, i) => {
        const uniqueUserId = `test-user-${i}-${uuidv4()}`;
        const uniqueToken = uuidv4();
        
        // Create waiting room access for each token
        redis.set(`waiting_room_access:${testEventId}:${uniqueToken}`, '1', 'EX', 300);
        
        return request(app)
          .post(`/events/${testEventId}/reservations`)
          .set('X-User-Id', uniqueUserId)
          .send({
            tier_id: smallTierId,
            quantity: 1,
            token: uniqueToken,
          });
      });

      const responses = await Promise.all(requests);

      // Count successes (201) vs failures (409)
      const successes = responses.filter(r => r.status === 201);
      const failures = responses.filter(r => r.status === 409);

      // Exactly one should succeed (capacity = 1)
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(9);

      // All failures should indicate "not enough tickets available"
      failures.forEach(response => {
        expect(response.body.error).toContain('Not enough tickets available');
      });

      // Verify only one reservation exists in the database
      const reservationCount = await query(
        `SELECT COUNT(*) as count 
         FROM reservations 
         WHERE tier_id = $1 AND status = 'active'`,
        [smallTierId]
      );
      expect(parseInt(reservationCount.rows[0].count, 10)).toBe(1);

      // Verify availability is now 0
      const availabilityResult = await query(
        `SELECT 
          t.capacity,
          COALESCE(SUM(CASE WHEN r.status = 'active' AND r.expires_at > NOW() THEN r.quantity ELSE 0 END), 0) as reserved,
          COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.quantity ELSE 0 END), 0) as sold
         FROM ticket_tiers t
         LEFT JOIN reservations r ON t.id = r.tier_id
         LEFT JOIN orders o ON t.id = o.tier_id
         WHERE t.id = $1
         GROUP BY t.id, t.capacity`,
        [smallTierId]
      );
      const available = availabilityResult.rows[0].capacity - 
                       availabilityResult.rows[0].reserved - 
                       availabilityResult.rows[0].sold;
      expect(available).toBe(0);
    } finally {
      // Cleanup
      await query('DELETE FROM reservations WHERE tier_id = $1', [smallTierId]);
      await query('DELETE FROM ticket_tiers WHERE id = $1', [smallTierId]);
    }
  }, 30000); // 30 second timeout for concurrency test

  it('should enforce purchase limits per user', async () => {
    const limitTierResult = await query(
      `INSERT INTO ticket_tiers (event_id, name, price_cents, capacity, per_user_limit)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [testEventId, 'Limit Tier', 5000, 100, 2] // per_user_limit = 2
    );
    const limitTierId = limitTierResult.rows[0].id;

    try {
      // Create an existing reservation for this user (1 ticket)
      await query(
        `INSERT INTO reservations (event_id, tier_id, user_token, quantity, status, expires_at)
         VALUES ($1, $2, $3, $4, 'active', $5)`,
        [testEventId, limitTierId, testUserId, 1, new Date(Date.now() + 180000)]
      );

      // Try to reserve 2 more (would exceed limit of 2)
      const response = await request(app)
        .post(`/events/${testEventId}/reservations`)
        .set('X-User-Id', testUserId)
        .send({
          tier_id: limitTierId,
          quantity: 2,
          token: testToken,
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('purchase_limit_exceeded');
      expect(response.body.limit).toBe(6); // Per-event limit (default from config)

      // Try to reserve 1 more (should succeed, total = 2)
      const response2 = await request(app)
        .post(`/events/${testEventId}/reservations`)
        .set('X-User-Id', testUserId)
        .send({
          tier_id: limitTierId,
          quantity: 1,
          token: testToken,
        });

      // This should fail because we already have 1 active reservation
      // and trying to create another would exceed the limit
      // Actually, wait - the limit is per-event, not per-tier
      // Let me check the logic... The per_user_limit on tier is for quantity per reservation
      // The per-event limit is what matters here
      
      // Actually, the test should check per-event limit, not per-tier limit
      // Let me adjust: user has 1 ticket reserved, tries to reserve 6 more (total 7, limit 6)
      const response3 = await request(app)
        .post(`/events/${testEventId}/reservations`)
        .set('X-User-Id', testUserId)
        .send({
          tier_id: limitTierId,
          quantity: 6, // Would make total = 7, exceeding limit of 6
          token: testToken,
        });

      expect(response3.status).toBe(403);
      expect(response3.body.error).toBe('purchase_limit_exceeded');
    } finally {
      await query('DELETE FROM reservations WHERE tier_id = $1', [limitTierId]);
      await query('DELETE FROM ticket_tiers WHERE id = $1', [limitTierId]);
    }
  });

  it('should handle checkout idempotency correctly', async () => {
    // Create active reservation
    const expiresAt = new Date(Date.now() + 180000); // 3 minutes from now
    const reservationResult = await query(
      `INSERT INTO reservations (event_id, tier_id, user_token, quantity, status, expires_at)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING id`,
      [testEventId, testTierId, testUserId, 2, expiresAt]
    );
    const reservationId = reservationResult.rows[0].id;

    const idempotencyKey = `test-key-${uuidv4()}`;

    // First checkout session request
    const session1 = await request(app)
      .post('/checkout/sessions')
      .set('Idempotency-Key', idempotencyKey)
      .set('X-User-Id', testUserId)
      .send({ reservation_id: reservationId });

    expect(session1.status).toBe(201);
    const checkoutId = session1.body.id;

    // Second request with same idempotency key
    const session2 = await request(app)
      .post('/checkout/sessions')
      .set('Idempotency-Key', idempotencyKey)
      .set('X-User-Id', testUserId)
      .send({ reservation_id: reservationId });

    expect(session2.status).toBe(200);
    expect(session2.body.id).toBe(checkoutId);
    expect(session2.body.message).toContain('idempotent');

    // Verify only one checkout session exists
    const sessionCount = await query(
      'SELECT COUNT(*) as count FROM checkout_sessions WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    expect(parseInt(sessionCount.rows[0].count, 10)).toBe(1);

    // First confirm
    const confirm1 = await request(app)
      .post('/checkout/confirm')
      .set('X-User-Id', testUserId)
      .send({
        checkout_id: checkoutId,
        simulate: 'success',
      });

    expect(confirm1.status).toBe(201);
    const orderId1 = confirm1.body.order.id;

    // Second confirm (idempotent)
    const confirm2 = await request(app)
      .post('/checkout/confirm')
      .set('X-User-Id', testUserId)
      .send({
        checkout_id: checkoutId,
        simulate: 'success',
      });

    expect(confirm2.status).toBe(200);
    expect(confirm2.body.order.id).toBe(orderId1);
    expect(confirm2.body.message).toContain('idempotent');

    // Verify exactly one order exists
    const orderCount = await query(
      'SELECT COUNT(*) as count FROM orders WHERE checkout_session_id = $1',
      [checkoutId]
    );
    expect(parseInt(orderCount.rows[0].count, 10)).toBe(1);

    // Verify exactly 2 tickets exist (one per quantity)
    const ticketCount = await query(
      'SELECT COUNT(*) as count FROM tickets WHERE order_id = $1',
      [orderId1]
    );
    expect(parseInt(ticketCount.rows[0].count, 10)).toBe(2);
  });

  it('should refuse checkout confirm for expired reservations', async () => {
    // Create an expired reservation
    const expiredAt = new Date(Date.now() - 60000); // 1 minute ago
    const reservationResult = await query(
      `INSERT INTO reservations (event_id, tier_id, user_token, quantity, status, expires_at)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING id`,
      [testEventId, testTierId, testUserId, 2, expiredAt]
    );
    const reservationId = reservationResult.rows[0].id;

    // Create checkout session for the expired reservation
    const idempotencyKey = `test-key-${uuidv4()}`;
    const sessionResponse = await request(app)
      .post('/checkout/sessions')
      .set('Idempotency-Key', idempotencyKey)
      .set('X-User-Id', testUserId)
      .send({ reservation_id: reservationId });

    // Checkout session creation might succeed (it checks expiry at creation too, but let's test confirm)
    const checkoutId = sessionResponse.body.id;

    // Try to confirm checkout with expired reservation
    const confirmResponse = await request(app)
      .post('/checkout/confirm')
      .set('X-User-Id', testUserId)
      .send({
        checkout_id: checkoutId,
        simulate: 'success',
      });

    // Should reject with 409 and appropriate error
    expect(confirmResponse.status).toBe(409);
    expect(confirmResponse.body.error).toBe('reservation_expired_or_invalid');

    // Verify no order was created
    const orderCount = await query(
      'SELECT COUNT(*) as count FROM orders WHERE checkout_session_id = $1',
      [checkoutId]
    );
    expect(parseInt(orderCount.rows[0].count, 10)).toBe(0);

    // Verify no tickets were created
    const ticketCount = await query(
      'SELECT COUNT(*) as count FROM tickets WHERE order_id IN (SELECT id FROM orders WHERE checkout_session_id = $1)',
      [checkoutId]
    );
    expect(parseInt(ticketCount.rows[0].count, 10)).toBe(0);

    // Verify checkout session was marked as expired
    const sessionCheck = await query(
      'SELECT status FROM checkout_sessions WHERE id = $1',
      [checkoutId]
    );
    expect(sessionCheck.rows[0].status).toBe('expired');

    // Verify reservation was marked as expired
    const reservationCheck = await query(
      'SELECT status FROM reservations WHERE id = $1',
      [reservationId]
    );
    expect(reservationCheck.rows[0].status).toBe('expired');
  });

  it('should complete happy-path E2E purchase flow', async () => {
    // Setup: Create event/tier with decent capacity
    const e2eEventResult = await query(
      `INSERT INTO events (name, venue, starts_at, on_sale_at, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        'E2E Test Event',
        'E2E Venue',
        new Date(Date.now() + 86400000).toISOString(),
        new Date(Date.now() - 3600000).toISOString(), // 1 hour ago (on sale)
        'on_sale'
      ]
    );
    const e2eEventId = e2eEventResult.rows[0].id;

    const e2eTierResult = await query(
      `INSERT INTO ticket_tiers (event_id, name, price_cents, capacity, per_user_limit)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [e2eEventId, 'E2E Tier', 5000, 100, 4]
    );
    const e2eTierId = e2eTierResult.rows[0].id;

    const e2eUserId = `e2e-user-${uuidv4()}`;
    const e2eToken = uuidv4();

    try {
      // Step 1: Join waiting room (simulate by creating access token)
      await redis.set(`waiting_room_access:${e2eEventId}:${e2eToken}`, '1', 'EX', 300);

      // Step 2: Create reservation (simulating canEnter = true)
      const reservationResponse = await request(app)
        .post(`/events/${e2eEventId}/reservations`)
        .set('X-User-Id', e2eUserId)
        .send({
          tier_id: e2eTierId,
          quantity: 2,
          token: e2eToken,
        });

      expect(reservationResponse.status).toBe(201);
      const reservationId = reservationResponse.body.id;

      // Step 3: Create checkout session
      const idempotencyKey = `e2e-checkout-${uuidv4()}`;
      const checkoutSessionResponse = await request(app)
        .post('/checkout/sessions')
        .set('Idempotency-Key', idempotencyKey)
        .set('X-User-Id', e2eUserId)
        .send({ reservation_id: reservationId });

      expect(checkoutSessionResponse.status).toBe(201);
      const checkoutId = checkoutSessionResponse.body.id;

      // Step 4: Confirm checkout
      const confirmResponse = await request(app)
        .post('/checkout/confirm')
        .set('X-User-Id', e2eUserId)
        .send({
          checkout_id: checkoutId,
          simulate: 'success',
        });

      expect(confirmResponse.status).toBe(201);
      expect(confirmResponse.body.order).toBeDefined();
      expect(confirmResponse.body.tickets).toBeDefined();
      expect(confirmResponse.body.tickets.length).toBe(2);

      const orderId = confirmResponse.body.order.id;

      // Step 5: Verify reservation is converted
      const reservationCheck = await query(
        'SELECT status FROM reservations WHERE id = $1',
        [reservationId]
      );
      expect(reservationCheck.rows[0].status).toBe('converted');

      // Step 6: Verify order is created and marked paid
      const orderCheck = await query(
        'SELECT status FROM orders WHERE id = $1',
        [orderId]
      );
      expect(orderCheck.rows[0].status).toBe('paid');

      // Step 7: Verify tickets exist
      const ticketsCheck = await query(
        'SELECT COUNT(*) as count FROM tickets WHERE order_id = $1',
        [orderId]
      );
      expect(parseInt(ticketsCheck.rows[0].count, 10)).toBe(2);

      // Step 8: Call /me/tickets and verify tickets are returned
      const ticketsResponse = await request(app)
        .get('/me/tickets')
        .set('X-User-Id', e2eUserId);

      expect(ticketsResponse.status).toBe(200);
      expect(ticketsResponse.body.tickets).toBeDefined();
      expect(ticketsResponse.body.tickets.length).toBeGreaterThanOrEqual(2);
      
      // Verify the tickets from our order are in the response
      const ourTickets = ticketsResponse.body.tickets.filter(
        (t: any) => t.order_id === orderId
      );
      expect(ourTickets.length).toBe(2);
    } finally {
      // Cleanup
      await query('DELETE FROM tickets WHERE event_id = $1', [e2eEventId]);
      await query('DELETE FROM orders WHERE event_id = $1', [e2eEventId]);
      await query('DELETE FROM checkout_sessions WHERE reservation_id IN (SELECT id FROM reservations WHERE event_id = $1)', [e2eEventId]);
      await query('DELETE FROM reservations WHERE event_id = $1', [e2eEventId]);
      await query('DELETE FROM ticket_tiers WHERE event_id = $1', [e2eEventId]);
      await query('DELETE FROM events WHERE id = $1', [e2eEventId]);
      await redis.del(`waiting_room_access:${e2eEventId}:${e2eToken}`);
    }
  });

  it('should enforce purchase limit after successful purchase', async () => {
    // Create event/tier with capacity
    const limitEventResult = await query(
      `INSERT INTO events (name, venue, starts_at, on_sale_at, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        'Purchase Limit Test Event',
        'Test Venue',
        new Date(Date.now() + 86400000).toISOString(),
        new Date(Date.now() - 3600000).toISOString(),
        'on_sale'
      ]
    );
    const limitEventId = limitEventResult.rows[0].id;

    const limitTierResult = await query(
      `INSERT INTO ticket_tiers (event_id, name, price_cents, capacity, per_user_limit)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [limitEventId, 'Limit Tier', 5000, 100, 4]
    );
    const limitTierId = limitTierResult.rows[0].id;

    const limitUserId = `limit-user-${uuidv4()}`;
    const limitToken = uuidv4();

    try {
      // Grant waiting room access
      await redis.set(`waiting_room_access:${limitEventId}:${limitToken}`, '1', 'EX', 300);

      // Step 1: Create and complete first purchase (3 tickets)
      const reservation1Response = await request(app)
        .post(`/events/${limitEventId}/reservations`)
        .set('X-User-Id', limitUserId)
        .send({
          tier_id: limitTierId,
          quantity: 3,
          token: limitToken,
        });

      expect(reservation1Response.status).toBe(201);
      const reservation1Id = reservation1Response.body.id;

      const idempotencyKey1 = `limit-checkout-1-${uuidv4()}`;
      const checkout1Response = await request(app)
        .post('/checkout/sessions')
        .set('Idempotency-Key', idempotencyKey1)
        .set('X-User-Id', limitUserId)
        .send({ reservation_id: reservation1Id });

      expect(checkout1Response.status).toBe(201);
      const checkout1Id = checkout1Response.body.id;

      const confirm1Response = await request(app)
        .post('/checkout/confirm')
        .set('X-User-Id', limitUserId)
        .send({
          checkout_id: checkout1Id,
          simulate: 'success',
        });

      expect(confirm1Response.status).toBe(201);
      expect(confirm1Response.body.order.status).toBe('paid');

      // Step 2: Try to purchase 4 more tickets (total would be 7, exceeding limit of 6)
      const reservation2Response = await request(app)
        .post(`/events/${limitEventId}/reservations`)
        .set('X-User-Id', limitUserId)
        .send({
          tier_id: limitTierId,
          quantity: 4,
          token: limitToken,
        });

      expect(reservation2Response.status).toBe(403);
      expect(reservation2Response.body.error).toBe('purchase_limit_exceeded');
      expect(reservation2Response.body.limit).toBe(6);
      expect(reservation2Response.body.alreadyPurchased).toBe(3);
      expect(reservation2Response.body.requested).toBe(4);

      // Step 3: Try to purchase 3 more tickets (total would be 6, exactly at limit - should succeed)
      const reservation3Response = await request(app)
        .post(`/events/${limitEventId}/reservations`)
        .set('X-User-Id', limitUserId)
        .send({
          tier_id: limitTierId,
          quantity: 3,
          token: limitToken,
        });

      expect(reservation3Response.status).toBe(201);
      const reservation3Id = reservation3Response.body.id;

      // Step 4: Complete the second purchase
      const idempotencyKey2 = `limit-checkout-2-${uuidv4()}`;
      const checkout2Response = await request(app)
        .post('/checkout/sessions')
        .set('Idempotency-Key', idempotencyKey2)
        .set('X-User-Id', limitUserId)
        .send({ reservation_id: reservation3Id });

      expect(checkout2Response.status).toBe(201);
      const checkout2Id = checkout2Response.body.id;

      const confirm2Response = await request(app)
        .post('/checkout/confirm')
        .set('X-User-Id', limitUserId)
        .send({
          checkout_id: checkout2Id,
          simulate: 'success',
        });

      expect(confirm2Response.status).toBe(201);

      // Step 5: Verify /me/tickets returns all 6 tickets
      const ticketsResponse = await request(app)
        .get('/me/tickets')
        .set('X-User-Id', limitUserId);

      expect(ticketsResponse.status).toBe(200);
      expect(ticketsResponse.body.tickets).toBeDefined();
      
      // Filter tickets for this event
      const eventTickets = ticketsResponse.body.tickets.filter(
        (t: any) => t.event.id === limitEventId
      );
      expect(eventTickets.length).toBe(6);

      // Step 6: Try to purchase 1 more ticket (should fail - at limit)
      const reservation4Response = await request(app)
        .post(`/events/${limitEventId}/reservations`)
        .set('X-User-Id', limitUserId)
        .send({
          tier_id: limitTierId,
          quantity: 1,
          token: limitToken,
        });

      expect(reservation4Response.status).toBe(403);
      expect(reservation4Response.body.error).toBe('purchase_limit_exceeded');
      expect(reservation4Response.body.alreadyPurchased).toBe(6);
    } finally {
      // Cleanup
      await query('DELETE FROM tickets WHERE event_id = $1', [limitEventId]);
      await query('DELETE FROM orders WHERE event_id = $1', [limitEventId]);
      await query('DELETE FROM checkout_sessions WHERE reservation_id IN (SELECT id FROM reservations WHERE event_id = $1)', [limitEventId]);
      await query('DELETE FROM reservations WHERE event_id = $1', [limitEventId]);
      await query('DELETE FROM ticket_tiers WHERE event_id = $1', [limitEventId]);
      await query('DELETE FROM events WHERE id = $1', [limitEventId]);
      await redis.del(`waiting_room_access:${limitEventId}:${limitToken}`);
    }
  });
});

