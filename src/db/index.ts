import { Pool, QueryResult, QueryResultRow } from 'pg';
import { resolve } from 'path';

// Load .env file if not in Vercel environment
if (typeof process.env.VERCEL === 'undefined' && !process.env.VERCEL_URL) {
  try {
    // Load .env from project root (two levels up from src/db/)
    const envPath = resolve(__dirname, '../../.env');
    require('dotenv').config({ path: envPath });
  } catch (e) {
    // dotenv not available, use environment variables directly
  }
}

const connectionString =
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;

const useSsl = process.env.PGSSLMODE === 'require' || process.env.NODE_ENV === 'production';

const pool = new Pool(
  connectionString
    ? {
        connectionString,
        ssl: useSsl ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
      }
    : {
        host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT || '5432', 10),
        user: process.env.DB_USER || process.env.POSTGRES_USER || 'ticketdrop',
        password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || 'ticketdrop',
        database: process.env.DB_NAME || process.env.POSTGRES_DATABASE || 'ticketdrop',
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
      }
);

// Handle pool errors gracefully
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export interface Event {
  id: string;
  name: string;
  venue: string;
  description: string | null;
  starts_at: Date;
  on_sale_at: Date;
  status: 'draft' | 'scheduled' | 'on_sale' | 'closed' | 'canceled';
  paused: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TicketTier {
  id: string;
  event_id: string;
  name: string;
  price_cents: number;
  capacity: number;
  per_user_limit: number;
  created_at: Date;
  updated_at: Date;
}

export interface Reservation {
  id: string;
  event_id: string;
  tier_id: string;
  user_token: string;
  quantity: number;
  status: 'active' | 'expired' | 'converted' | 'canceled';
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CheckoutSession {
  id: string;
  reservation_id: string;
  idempotency_key: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  created_at: Date;
  updated_at: Date;
}

export interface Order {
  id: string;
  checkout_session_id: string;
  reservation_id: string;
  event_id: string;
  tier_id: string;
  user_token: string;
  quantity: number;
  total_price_cents: number;
  status: 'paid' | 'refunded' | 'canceled';
  created_at: Date;
  updated_at: Date;
}

export interface Ticket {
  id: string;
  order_id: string;
  event_id: string;
  tier_id: string;
  user_token: string;
  code: string;
  qr_sig: string;
  created_at: Date;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  try {
    return await pool.query<T>(text, params);
  } catch (error: any) {
    // Log connection errors for debugging
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.error('Database connection error:', {
        code: error.code,
        message: error.message,
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '5432',
      });
    }
    throw error;
  }
}

export async function getClient() {
  try {
    return await pool.connect();
  } catch (error: any) {
    // Log connection errors for debugging
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.error('Database connection error (getClient):', {
        code: error.code,
        message: error.message,
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '5432',
      });
    }
    throw error;
  }
}

export default pool;

