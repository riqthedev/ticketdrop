import { query } from './index';

interface EventData {
  name: string;
  venue: string;
  description: string;
  starts_at: string;
  on_sale_at: string;
  status: 'draft' | 'scheduled' | 'on_sale' | 'closed' | 'canceled';
}

interface TierData {
  event_id: string;
  name: string;
  price_cents: number;
  capacity: number;
  per_user_limit: number;
}

const events: EventData[] = [
  // Basketball Games
  {
    name: 'Lakers vs Warriors',
    venue: 'Crypto.com Arena',
    description: 'Watch LeBron James and Stephen Curry face off in this epic Western Conference showdown!',
    starts_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
    on_sale_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
    status: 'scheduled',
  },
  {
    name: 'Celtics vs Heat',
    venue: 'TD Garden',
    description: 'Eastern Conference rivalry game. Don\'t miss this intense matchup!',
    starts_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days from now
    on_sale_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago (sale open)
    status: 'on_sale',
  },
  {
    name: 'Knicks vs Nets',
    venue: 'Madison Square Garden',
    description: 'New York City basketball at its finest! The battle for NYC supremacy.',
    starts_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
    on_sale_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days from now
    status: 'scheduled',
  },
  {
    name: 'Bulls vs Bucks',
    venue: 'United Center',
    description: 'Giannis Antetokounmpo and the Bucks take on the Chicago Bulls in this Midwest clash.',
    starts_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(), // 21 days from now
    on_sale_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), // 3 hours from now (for testing countdown)
    status: 'scheduled',
  },
  
  // Concerts
  {
    name: 'Taylor Swift - The Eras Tour',
    venue: 'SoFi Stadium',
    description: 'Experience the full Eras Tour with all your favorite hits! This is a once-in-a-lifetime show.',
    starts_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
    on_sale_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
    status: 'scheduled',
  },
  {
    name: 'The Weeknd - After Hours Til Dawn Tour',
    venue: 'MetLife Stadium',
    description: 'Join The Weeknd for an unforgettable night of music under the stars.',
    starts_at: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(), // 45 days from now
    on_sale_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago (sale open)
    status: 'on_sale',
  },
  {
    name: 'Beyoncé - Renaissance World Tour',
    venue: 'Mercedes-Benz Stadium',
    description: 'Queen Bey brings the Renaissance to life! Get ready for an incredible performance.',
    starts_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days from now
    on_sale_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
    status: 'scheduled',
  },
  {
    name: 'Drake & 21 Savage - It\'s All A Blur Tour',
    venue: 'Barclays Center',
    description: 'Two of hip-hop\'s biggest names on one stage. This is going to be legendary!',
    starts_at: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(), // 20 days from now
    on_sale_at: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), // 1 hour from now (for testing)
    status: 'scheduled',
  },
  {
    name: 'Bad Bunny - World\'s Hottest Tour',
    venue: 'Yankee Stadium',
    description: 'El Conejo Malo brings the heat! The biggest Latin music tour of the year.',
    starts_at: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days from now
    on_sale_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days from now
    status: 'scheduled',
  },
  {
    name: 'Ed Sheeran - Mathematics Tour',
    venue: 'Wembley Stadium',
    description: 'Ed Sheeran returns with his biggest hits and new music. A night of pure magic.',
    starts_at: new Date(Date.now() + 50 * 24 * 60 * 60 * 1000).toISOString(), // 50 days from now
    on_sale_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago (sale open)
    status: 'on_sale',
  },
];

const createTiers = (eventId: string, type: 'basketball' | 'concert'): TierData[] => {
  if (type === 'basketball') {
    return [
      {
        event_id: eventId,
        name: 'Lower Bowl',
        price_cents: 25000, // $250
        capacity: 500,
        per_user_limit: 4,
      },
      {
        event_id: eventId,
        name: 'Upper Bowl',
        price_cents: 8000, // $80
        capacity: 1000,
        per_user_limit: 6,
      },
      {
        event_id: eventId,
        name: 'Courtside',
        price_cents: 150000, // $1500
        capacity: 50,
        per_user_limit: 2,
      },
      {
        event_id: eventId,
        name: 'Club Level',
        price_cents: 12000, // $120
        capacity: 300,
        per_user_limit: 4,
      },
    ];
  } else {
    // Concert tiers
    return [
      {
        event_id: eventId,
        name: 'VIP',
        price_cents: 50000, // $500
        capacity: 200,
        per_user_limit: 4,
      },
      {
        event_id: eventId,
        name: 'Floor',
        price_cents: 20000, // $200
        capacity: 1000,
        per_user_limit: 6,
      },
      {
        event_id: eventId,
        name: 'Lower Level',
        price_cents: 15000, // $150
        capacity: 2000,
        per_user_limit: 8,
      },
      {
        event_id: eventId,
        name: 'Upper Level',
        price_cents: 7500, // $75
        capacity: 3000,
        per_user_limit: 10,
      },
    ];
  }
};

export async function seedDatabase(): Promise<void> {
  try {
    console.log('🌱 Starting database seed...');

    // Ensure database is initialized - create tables if they don't exist
    console.log('Ensuring database is initialized...');
    try {
      await query(`
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      `);
      
      await query(`
        CREATE TABLE IF NOT EXISTS events (
          id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name            TEXT NOT NULL,
          venue           TEXT NOT NULL,
          description     TEXT,
          starts_at       TIMESTAMPTZ NOT NULL,
          on_sale_at      TIMESTAMPTZ NOT NULL,
          status          TEXT NOT NULL DEFAULT 'draft',
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS ticket_tiers (
          id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          name                TEXT NOT NULL,
          price_cents         INTEGER NOT NULL CHECK (price_cents >= 0),
          capacity            INTEGER NOT NULL CHECK (capacity >= 0),
          per_user_limit      INTEGER NOT NULL DEFAULT 4 CHECK (per_user_limit > 0),
          created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // Add constraint if it doesn't exist
      try {
        await query(`
          ALTER TABLE events
          ADD CONSTRAINT events_on_sale_before_start
          CHECK (on_sale_at <= starts_at);
        `);
      } catch (error: any) {
        if (error.code !== '42710') { // constraint already exists
          throw error;
        }
      }

      // Add unique index if it doesn't exist
      try {
        await query(`
          CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_tiers_event_name
          ON ticket_tiers(event_id, name);
        `);
      } catch (error: any) {
        // Index might already exist, that's fine
      }

      console.log('Database tables ready!');
    } catch (error: any) {
      console.error('Error setting up database:', error.message);
      throw error;
    }

    // Clear existing events (optional - comment out if you want to keep existing data)
    console.log('Clearing existing events...');
    try {
      await query('DELETE FROM ticket_tiers');
      await query('DELETE FROM events');
    } catch (error: any) {
      if (error.code !== '42P01') {
        throw error;
      }
    }

    // Insert events
    for (const event of events) {
      console.log(`Creating event: ${event.name}...`);
      const eventResult = await query<{ id: string }>(
        `INSERT INTO events (name, venue, description, starts_at, on_sale_at, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [event.name, event.venue, event.description, event.starts_at, event.on_sale_at, event.status]
      );

      const eventId = eventResult.rows[0].id;

      // Determine event type and create tiers
      const isBasketball = event.name.includes('vs') || event.venue.includes('Arena') || event.venue.includes('Garden') || event.venue.includes('Center');
      const tiers = createTiers(eventId, isBasketball ? 'basketball' : 'concert');

      // Insert tiers
      for (const tier of tiers) {
        await query(
          `INSERT INTO ticket_tiers (event_id, name, price_cents, capacity, per_user_limit)
           VALUES ($1, $2, $3, $4, $5)`,
          [tier.event_id, tier.name, tier.price_cents, tier.capacity, tier.per_user_limit]
        );
      }

      console.log(`✅ Created ${event.name} with ${tiers.length} tiers`);
    }

    console.log(`\n🎉 Successfully seeded ${events.length} events!`);
    console.log('\n📊 Summary:');
    console.log(`   - Basketball games: ${events.filter(e => e.name.includes('vs')).length}`);
    console.log(`   - Concerts: ${events.filter(e => !e.name.includes('vs')).length}`);
    console.log(`   - On sale now: ${events.filter(e => e.status === 'on_sale').length}`);
    console.log(`   - Scheduled: ${events.filter(e => e.status === 'scheduled').length}`);
  } catch (error: any) {
    console.error('❌ Failed to seed database:', error.message);
    throw error;
  }
}

if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('\n✨ Seed complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

