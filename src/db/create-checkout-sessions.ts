import { query } from './index';

async function createCheckoutSessionsTable() {
  try {
    console.log('Creating checkout_sessions table...');
    
    await query(`
      CREATE TABLE IF NOT EXISTS checkout_sessions (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        reservation_id      UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
        idempotency_key     TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'pending',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_sessions_idempotency_key
      ON checkout_sessions(idempotency_key)
    `);
    
    await query(`
      CREATE INDEX IF NOT EXISTS idx_checkout_sessions_reservation_id
      ON checkout_sessions(reservation_id)
    `);
    
    console.log('✅ Checkout sessions table created successfully');
  } catch (error: any) {
    console.error('❌ Error creating checkout_sessions table:', error.message);
    throw error;
  }
}

if (require.main === module) {
  createCheckoutSessionsTable()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default createCheckoutSessionsTable;
