import { query } from './index';

async function createReservationsTable() {
  try {
    console.log('Creating reservations table...');
    
    await query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        tier_id             UUID NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
        user_token          TEXT NOT NULL,
        quantity            INTEGER NOT NULL CHECK (quantity > 0),
        status              TEXT NOT NULL DEFAULT 'active',
        expires_at          TIMESTAMPTZ NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    await query(`
      CREATE INDEX IF NOT EXISTS idx_reservations_event_tier_active
      ON reservations(event_id, tier_id, status)
      WHERE status = 'active'
    `);
    
    await query(`
      CREATE INDEX IF NOT EXISTS idx_reservations_user_token_active
      ON reservations(user_token, status)
      WHERE status = 'active'
    `);
    
    await query(`
      CREATE INDEX IF NOT EXISTS idx_reservations_expires_at
      ON reservations(expires_at)
      WHERE status = 'active'
    `);
    
    console.log('✅ Reservations table created successfully');
  } catch (error: any) {
    console.error('❌ Error creating reservations table:', error.message);
    throw error;
  }
}

if (require.main === module) {
  createReservationsTable()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default createReservationsTable;

