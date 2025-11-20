import client from 'prom-client';

const register = new client.Registry();

client.collectDefaultMetrics({ register });

export const metrics = {
  queueJoins: new client.Counter({
    name: 'queue_joins_total',
    help: 'Number of waiting room joins',
    labelNames: ['event_id'],
    registers: [register],
  }),
  reservationsCreated: new client.Counter({
    name: 'reservations_created_total',
    help: 'Number of reservations created',
    labelNames: ['event_id', 'tier_id'],
    registers: [register],
  }),
  reservationRateLimited: new client.Counter({
    name: 'reservation_rate_limited_total',
    help: 'Number of reservation attempts rate limited',
    labelNames: ['event_id'],
    registers: [register],
  }),
  purchaseLimitHit: new client.Counter({
    name: 'reservation_purchase_limit_hits_total',
    help: 'Number of times per-event purchase limit was exceeded',
    labelNames: ['event_id'],
    registers: [register],
  }),
  checkoutSessionsCreated: new client.Counter({
    name: 'checkout_sessions_created_total',
    help: 'Number of checkout sessions created',
    labelNames: ['event_id'],
    registers: [register],
  }),
  checkoutRateLimited: new client.Counter({
    name: 'checkout_rate_limited_total',
    help: 'Number of checkout attempts rate limited',
    labelNames: ['event_id'],
    registers: [register],
  }),
  ordersCreated: new client.Counter({
    name: 'orders_created_total',
    help: 'Number of orders created',
    labelNames: ['event_id'],
    registers: [register],
  }),
  rateLimitHits: new client.Counter({
    name: 'rate_limit_hits_total',
    help: 'Number of rate limit hits',
    labelNames: ['endpoint'],
    registers: [register],
  }),
  reservationsExpired: new client.Counter({
    name: 'reservations_expired_total',
    help: 'Number of reservations expired',
    labelNames: ['event_id'],
    registers: [register],
  }),
  inventoryRestored: new client.Counter({
    name: 'inventory_restored_total',
    help: 'Number of inventory units restored from expired reservations',
    labelNames: ['tier_id'],
    registers: [register],
  }),
  ticketsRecovered: new client.Counter({
    name: 'tickets_recovered_total',
    help: 'Number of tickets recovered for paid orders',
    labelNames: ['event_id'],
    registers: [register],
  }),
  reservationExpiredAtCheckout: new client.Counter({
    name: 'reservation_expired_at_checkout_total',
    help: 'Number of checkout confirmations rejected due to expired or invalid reservations',
    labelNames: ['event_id'],
    registers: [register],
  }),
  oversellAttempts: new client.Counter({
    name: 'oversell_attempts_total',
    help: 'Number of reservation attempts that failed due to insufficient availability',
    labelNames: ['event_id', 'tier_id'],
    registers: [register],
  }),
  checkoutConfirmationsSuccess: new client.Counter({
    name: 'checkout_confirmations_success_total',
    help: 'Number of successful checkout confirmations',
    labelNames: ['event_id'],
    registers: [register],
  }),
  checkoutConfirmationsFailed: new client.Counter({
    name: 'checkout_confirmations_failed_total',
    help: 'Number of failed checkout confirmations',
    labelNames: ['event_id'],
    registers: [register],
  }),
};

export async function getMetrics() {
  return register.metrics();
}

export const metricsContentType = register.contentType;


