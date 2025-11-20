import { query } from './index';

async function createOrdersTable() {
  try {
    console.log('Creating orders table...');

    await query(`
      CREATE TABLE IF NOT EXISTS orders (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        checkout_session_id UUID NOT NULL REFERENCES checkout_sessions(id) ON DELETE CASCADE,
        reservation_id      UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
        event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        tier_id             UUID NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
        user_token          TEXT NOT NULL,
        quantity            INTEGER NOT NULL CHECK (quantity > 0),
        total_price_cents   INTEGER NOT NULL CHECK (total_price_cents >= 0),
        status              TEXT NOT NULL DEFAULT 'paid',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_orders_user_token
      ON orders(user_token)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_orders_event_id
      ON orders(event_id)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_orders_checkout_session_id
      ON orders(checkout_session_id)
    `);

    console.log('✅ Orders table created successfully');
  } catch (error: any) {
    console.error('❌ Error creating orders table:', error.message);
    throw error;
  }
}

if (require.main === module) {
  createOrdersTable()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default createOrdersTable;

