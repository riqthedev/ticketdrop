import { Pool, QueryResult, QueryResultRow } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'ticketdrop',
  password: process.env.DB_PASSWORD || 'ticketdrop',
  database: process.env.DB_NAME || 'ticketdrop',
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
  return pool.query<T>(text, params);
}

export async function getClient() {
  return pool.connect();
}

export default pool;

