CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Events: a single show or performance that can sell tickets
CREATE TABLE IF NOT EXISTS events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    venue           TEXT NOT NULL,
    description     TEXT,
    starts_at       TIMESTAMPTZ NOT NULL,
    on_sale_at      TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | on_sale | closed | canceled
    paused          BOOLEAN NOT NULL DEFAULT false, -- Admin can pause/resume sales
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Basic constraint: sale must start before event
ALTER TABLE events
    ADD CONSTRAINT events_on_sale_before_start
    CHECK (on_sale_at <= starts_at);

-- Ticket tiers: GA / VIP / Balcony etc.
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

-- One tier name per event for sanity
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_tiers_event_name
ON ticket_tiers(event_id, name);

-- Reservations: Temporary holds on tickets with TTL
CREATE TABLE IF NOT EXISTS reservations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    tier_id             UUID NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
    user_token          TEXT NOT NULL, -- Waiting room token or user identifier
    quantity            INTEGER NOT NULL CHECK (quantity > 0),
    status              TEXT NOT NULL DEFAULT 'active', -- active | expired | converted | canceled
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding active reservations by event and tier
CREATE INDEX IF NOT EXISTS idx_reservations_event_tier_active
ON reservations(event_id, tier_id, status)
WHERE status = 'active';

-- Index for finding active reservations by user token
CREATE INDEX IF NOT EXISTS idx_reservations_user_token_active
ON reservations(user_token, status)
WHERE status = 'active';

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_reservations_expires_at
ON reservations(expires_at)
WHERE status = 'active';

-- Checkout Sessions: Idempotent checkout tracking
CREATE TABLE IF NOT EXISTS checkout_sessions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reservation_id      UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    idempotency_key     TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed | expired
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one checkout session per idempotency key
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_sessions_idempotency_key
ON checkout_sessions(idempotency_key);

-- Index for finding sessions by reservation
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_reservation_id
ON checkout_sessions(reservation_id);

-- Orders: Completed purchases
CREATE TABLE IF NOT EXISTS orders (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    checkout_session_id UUID NOT NULL REFERENCES checkout_sessions(id) ON DELETE CASCADE,
    reservation_id      UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    tier_id             UUID NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
    user_token          TEXT NOT NULL,
    quantity            INTEGER NOT NULL CHECK (quantity > 0),
    total_price_cents   INTEGER NOT NULL CHECK (total_price_cents >= 0),
    status              TEXT NOT NULL DEFAULT 'paid', -- paid | refunded | canceled
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for finding orders by user token
CREATE INDEX IF NOT EXISTS idx_orders_user_token
ON orders(user_token);

-- Index for finding orders by event
CREATE INDEX IF NOT EXISTS idx_orders_event_id
ON orders(event_id);

-- Index for finding orders by checkout session
CREATE INDEX IF NOT EXISTS idx_orders_checkout_session_id
ON orders(checkout_session_id);

-- Tickets: Individual tickets issued for orders
CREATE TABLE IF NOT EXISTS tickets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    tier_id             UUID NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
    user_token          TEXT NOT NULL,
    code                TEXT NOT NULL, -- Unique ticket code (UUID)
    qr_sig              TEXT NOT NULL, -- HMAC signature for QR code verification
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one ticket per code
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_code
ON tickets(code);

-- Index for finding tickets by user token
CREATE INDEX IF NOT EXISTS idx_tickets_user_token
ON tickets(user_token);

-- Index for finding tickets by order
CREATE INDEX IF NOT EXISTS idx_tickets_order_id
ON tickets(order_id);

-- Index for finding tickets by event
CREATE INDEX IF NOT EXISTS idx_tickets_event_id
ON tickets(event_id);

