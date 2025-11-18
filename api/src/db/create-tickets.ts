import { query } from './index';

async function createTicketsTable() {
  try {
    console.log('Creating tickets table...');

    await query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        tier_id             UUID NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
        user_token          TEXT NOT NULL,
        code                TEXT NOT NULL,
        qr_sig              TEXT NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_code
      ON tickets(code)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_tickets_user_token
      ON tickets(user_token)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_tickets_order_id
      ON tickets(order_id)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_tickets_event_id
      ON tickets(event_id)
    `);

    console.log('✅ Tickets table created successfully');
  } catch (error: any) {
    console.error('❌ Error creating tickets table:', error.message);
    throw error;
  }
}

if (require.main === module) {
  createTicketsTable()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default createTicketsTable;

