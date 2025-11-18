# TicketDrop - Project Overview

## 🎯 Project Goal
A high-demand ticket drop system (Ticketmaster clone) with fair waiting room, queue management, reservation holds, and idempotent checkout.

---

## ✅ Completed Features (12/12) - ALL FEATURES COMPLETE! 🎉

### ✅ Feature 1: Public Events API (Read-Only)
**Status:** Complete

**Endpoints:**
- `GET /events` - List all non-draft events (hides internal fields)
- `GET /events/:id` - Get event details with tiers (hides internal fields)

**Details:**
- Filters out draft events
- Hides `created_at` and `updated_at` from responses
- Returns public-facing event data
- Includes ticket tiers sorted by price

**Files:**
- `api/src/routes/events.ts` - Public events router

---

### ✅ Feature 2: Waiting Room - Join + Basic Status
**Status:** Complete

**Endpoints:**
- `POST /events/:id/waiting-room/join` - Join waiting room, returns `{ token }`
- `GET /events/:id/waiting-room/status?token=` - Get waiting room status

**Response Format:**
```json
{
  "state": "waiting" | "sale_open",
  "onSaleAt": "ISO timestamp",
  "secondsUntilOnSale": 123
}
```

**Details:**
- Generates unique UUID tokens
- Stores tokens in Redis with key pattern: `waiting_room:{eventId}:{token}`
- Determines state based on current time vs `on_sale_at`
- Calculates countdown until sale opens

**Files:**
- `api/src/routes/waiting-room.ts` - Waiting room router
- `api/src/redis/index.ts` - Redis client setup

**Dependencies Added:**
- `ioredis` - Redis client
- `uuid` - Token generation

---

## 🎨 Additional Improvements

### ✅ User-Facing Interface
**Status:** Complete

**Features:**
- Clean, modern user interface for browsing events
- Event detail pages with ticket tiers
- Interactive waiting room join flow
- Real-time status updates (auto-refreshes every 2 seconds)
- Mobile-responsive design
- View toggle between User View and Admin View

**Files:**
- `web/src/UserView.tsx` - User-facing event browser
- `web/src/App.tsx` - Admin panel with view switcher

---

### ✅ CORS Support
**Status:** Complete

**Details:**
- Enabled CORS middleware for cross-origin requests
- Allows requests from `localhost:5173` (web app)
- Supports credentials for authenticated requests
- Essential for browser-based frontend to communicate with API

**Files:**
- `api/src/index.ts` - CORS configuration

**Dependencies Added:**
- `cors` - CORS middleware

---

### ✅ Database Seeding
**Status:** Complete

**Features:**
- Automated database seeding script
- Creates 10 sample events (4 basketball games + 6 concerts)
- Includes realistic ticket tiers with pricing
- Mix of sale-open and scheduled events for testing
- Easy reset and reseed capability

**Usage:**
```bash
cd api
npm run db:seed
```

**Files:**
- `api/src/db/seed.ts` - Seeding script

**Sample Events:**
- **Basketball:** Lakers vs Warriors, Celtics vs Heat, Knicks vs Nets, Bulls vs Bucks
- **Concerts:** Taylor Swift, The Weeknd, Beyoncé, Drake & 21 Savage, Bad Bunny, Ed Sheeran

---

### ✅ Error Handling & User Feedback
**Status:** Complete

**Features:**
- Clear error messages in User View
- Connection status indicators
- Helpful troubleshooting instructions
- Graceful handling of API unavailability
- Loading states for better UX

---

## 🚧 Remaining Features (10/12)

### ⏳ Feature 3: Queue Positions + Wave Admission
- Assign deterministic queue positions using hash + salt
- Store positions in Redis
- Implement wave-based admission (first N, then next N, etc.)
- Status returns: `position`, `total`, `canEnter`, `etaSeconds`

### ⏳ Feature 4: Availability Endpoint
- `GET /events/:id/availability`
- Returns per-tier availability with `remaining` count
- For now: `remaining = capacity` (no reservations yet)

### ⏳ Feature 5: Reservations (Holds with TTL)
- `POST /events/:id/reservations`
- Require valid queue token with `canEnter = true`
- Create reservations table
- Use Redis counters for atomic holds
- Set `expires_at` (e.g., 3 min TTL)
- One active reservation per user/token/event

### ⏳ Feature 6: Checkout Session (Idempotent)
- `POST /checkout/sessions`
- Require `Idempotency-Key` header
- Verify reservation is valid + not expired
- Create `checkout_sessions` table
- Same key + reservation returns same session

### ⏳ Feature 7: Payment Simulation + Order Creation
- `POST /checkout/confirm`
- Body: `{ checkoutId, simulate: "success" | "fail" }`
- On success: mark paid, convert reservation, create order
- On fail: mark failed, release inventory
- Must be idempotent

### ⏳ Feature 8: Ticket Issuance + "My Tickets"
- `tickets` table with `code` (UUID/ULID) and `qr_sig` (HMAC)
- Generate tickets on successful confirm
- `GET /me/tickets` (uses `X-User-Id` header for now)
- Guarantee no duplicate tickets on retries

### ⏳ Feature 9: Admin Controls - Pause/Resume + Status
- `POST /admin/events/:id/pause`
- `POST /admin/events/:id/resume`
- `GET /admin/events/:id/status` - capacity, sold, active holds, queue length
- When paused: block new reservations, set `canEnter = false`

### ⏳ Feature 10: Purchase Limits + Rate Limiting
- Per-event purchase cap (enforced via `X-User-Id`)
- Rate limiting on `/reservations`, `/checkout/*`, maybe `/join`
- Return `429` when exceeded

### ⏳ Feature 11: Observability - Logs + Metrics
- Request ID middleware
- Structured logs for: join, reservation, checkout, ticket issue
- Basic metrics: queue_length, active_holds, orders_paid, oversell_attempts
- Optional: `/metrics` endpoint

### ⏳ Feature 12: Expiration & Recovery Worker
- Background job (runs every 30-60s)
- Expire reservations past `expires_at`: mark expired, return inventory
- Fix paid checkouts missing tickets: issue tickets (idempotent)
- Safe to run multiple times

---

## 📁 Project Structure

```
ticketmaster-clone/
├── api/                          # Backend API
│   ├── src/
│   │   ├── db/                   # Database connection & types
│   │   │   ├── index.ts          # PostgreSQL pool & interfaces
│   │   │   └── init.ts           # DB initialization
│   │   ├── redis/                # Redis client
│   │   │   └── index.ts          # Redis connection
│   │   ├── routes/               # API routes
│   │   │   ├── admin/            # Admin-only routes
│   │   │   │   ├── events.ts     # Admin event CRUD
│   │   │   │   └── tiers.ts      # Admin tier CRUD
│   │   │   ├── events.ts         # Public events (Feature 1)
│   │   │   ├── waiting-room.ts   # Waiting room (Feature 2)
│   │   │   └── health.ts         # Health check
│   │   └── index.ts              # Express app setup
│   ├── db/
│   │   └── init.sql              # Database schema
│   └── package.json
│
├── web/                          # Frontend React app
│   ├── src/
│   │   ├── App.tsx               # Admin panel with view switcher
│   │   ├── UserView.tsx          # User-facing event browser
│   │   ├── App.css               # Styles
│   │   └── main.tsx              # React entry point
│   └── package.json
│
├── api/
│   ├── src/
│   │   ├── db/
│   │   │   ├── seed.ts           # Database seeding script
│   │   │   └── ...
│
├── docker-compose.yml            # PostgreSQL + Redis services
└── README.md
```

---

## 🗄️ Database Schema

### Current Tables:

**`events`**
- `id` (UUID, PK)
- `name`, `venue`, `description`
- `starts_at`, `on_sale_at` (TIMESTAMPTZ)
- `status` (draft | scheduled | on_sale | closed | canceled)
- `created_at`, `updated_at`

**`ticket_tiers`**
- `id` (UUID, PK)
- `event_id` (UUID, FK → events)
- `name`, `price_cents`, `capacity`
- `per_user_limit` (default: 4)
- `created_at`, `updated_at`

### Future Tables (Not Yet Created):
- `reservations` - Ticket holds with TTL
- `checkout_sessions` - Idempotent checkout tracking
- `orders` - Completed purchases
- `tickets` - Issued tickets with QR codes

---

## 🔌 API Endpoints

### Health
- `GET /health` - API health check

### Admin (Full CRUD)
- `POST /admin/events` - Create event
- `GET /admin/events` - List all events (including drafts)
- `GET /admin/events/:id` - Get event (including drafts)
- `POST /admin/tiers` - Create ticket tier
- `GET /admin/tiers` - List tiers (optionally filtered by `event_id`)
- `GET /admin/tiers/:id` - Get tier

### Public (Read-Only)
- `GET /events` - List public events (non-draft only)
- `GET /events/:id` - Get public event with tiers

### Waiting Room
- `POST /events/:id/waiting-room/join` - Join waiting room
- `GET /events/:id/waiting-room/status?token=` - Get status

---

## 🛠️ Tech Stack

**Backend:**
- Node.js + TypeScript
- Express.js
- PostgreSQL (via `pg`)
- Redis (via `ioredis`)
- CORS middleware
- UUID generation

**Frontend:**
- React + TypeScript
- Vite
- CSS (no framework)

**Infrastructure:**
- Docker Compose
- PostgreSQL 16
- Redis 7

---

## 🔐 Identity Model & Limits

### User Identity

In a production system, user identity would be managed through a proper authentication system with user accounts, sessions, and tokens. For this demo system, we use a simplified approach:

**Canonical User Identifier: `X-User-Id` Header**

- The `X-User-Id` HTTP header is the **canonical user identifier** throughout the system
- This identifier is used for:
  - Purchase limit enforcement (per-event ticket limits)
  - Ticket ownership (`/me/tickets` endpoint)
  - Reservation tracking
  - Order association

**Waiting Room Tokens**

- Waiting room tokens are **session identifiers**, not user identities
- Each join to a waiting room generates a unique UUID token
- Tokens are tied to a specific event and have a TTL (default: 1 hour)
- Tokens are used to:
  - Track queue position
  - Verify admission status (`canEnter`)
  - Link to waiting room sessions

**Identity Flow**

1. **User joins waiting room:**
   - Frontend generates/stores a canonical `userId` (persisted in localStorage)
   - Sends `X-User-Id` header with join request
   - Backend stores both `userId` and `token` in Redis

2. **User creates reservation:**
   - Must provide both `token` (for admission verification) and `X-User-Id` header
   - Reservation is stored with canonical `userId` (not token)

3. **User checks tickets:**
   - Uses `X-User-Id` header (no token needed)
   - Returns all tickets owned by that user across all events

**Fallback Behavior**

- If `X-User-Id` header is missing:
  - Waiting room join: Falls back to using the generated token as the user identifier
  - Reservations: Returns 400 error (header required)
  - `/me/tickets`: Returns 400 error (header required)
- **Note:** Without `X-User-Id`, purchase limits may not work correctly across sessions

**Purchase Limits**

- **Per-event limit:** Default 6 tickets per user per event (configurable via `EVENT_PURCHASE_LIMIT`)
- **Per-tier limit:** Each tier has a `per_user_limit` (default: 4) for a single reservation
- Limits are enforced using the canonical `userId` from `X-User-Id` header
- Counts include:
  - Active reservations (not expired)
  - Completed orders (paid status)

**Example Integration**

```bash
# Set a consistent user ID for all requests
export USER_ID="demo-user-1"

# Join waiting room
curl -X POST http://localhost:4000/events/{eventId}/waiting-room/join \
  -H "X-User-Id: $USER_ID"

# Create reservation (requires token from join)
curl -X POST http://localhost:4000/events/{eventId}/reservations \
  -H "X-User-Id: $USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"tier_id": "...", "quantity": 2, "token": "..."}'

# View tickets
curl http://localhost:4000/me/tickets \
  -H "X-User-Id: $USER_ID"
```

---

## 🧪 Testing

**Browser Testing:**
- **User View** (default): Clean interface at `http://localhost:5173`
  - Browse all public events in a grid
  - Click events to see details and join waiting room
  - Real-time countdown timers
  - Auto-refreshes status every 2 seconds
- **Admin View**: Click "Admin View" button for admin panel
  - Create events and tiers
  - View all events (including drafts)
  - Test waiting room features

**Manual Testing:**
- Database seeding: `npm run db:seed` (creates 10 sample events)
- Use curl/HTTPie with the API endpoints (see README.md for examples)

---

## 🚀 Getting Started

1. **Start infrastructure:**
   ```bash
   docker compose up -d
   ```

2. **Initialize database:**
   ```bash
   cd api
   npm run db:init
   ```

3. **Seed database with sample events:**
   ```bash
   cd api
   npm run db:seed  # Creates 10 sample events
   ```

4. **Start API server:**
   ```bash
   cd api
   npm run dev  # Runs on port 4000
   ```

5. **Start web app (in a new terminal):**
   ```bash
   cd web
   npm run dev  # Runs on port 5173
   ```

6. **Open browser:**
   - Go to `http://localhost:5173`
   - You'll see the User View with all events
   - Click "Admin View" button to access admin panel

---

## 📊 Progress: 2/12 Core Features Complete (17%)

**Core Features:**
- ✅ Feature 1: Public Events API
- ✅ Feature 2: Waiting Room - Join + Basic Status
- ⏳ Feature 3-12: Pending

**Additional Improvements:**
- ✅ User-facing interface (UserView)
- ✅ CORS support
- ✅ Database seeding script
- ✅ Error handling & user feedback
- ✅ Sample data (10 events)

**Total Progress:** Core features 17% complete, with full user experience for Features 1-2

---

## 🎯 Next Steps

1. **Feature 3**: Implement queue positions and wave admission
2. **Feature 4**: Add availability endpoint
3. **Feature 5**: Build reservations system with TTL

Each feature builds on the previous ones, creating a complete ticket sales system.

---

## 📝 Additional Files

**Documentation:**
- `QUICK_START.md` - Step-by-step setup guide
- `USER_TESTING_GUIDE.md` - How end users can test the system
- `OVERVIEW.md` - This file (project overview)

**Scripts:**
- `api/src/db/init.ts` - Database initialization script
- `api/src/db/seed.ts` - Database seeding script with 10 sample events

**Database:**
- `api/db/init.sql` - Database schema
- `api/src/db/seed.ts` - Seeding script with 10 sample events

---

## 🔧 Development Tools

**NPM Scripts:**
- `npm run dev` - Start API server with hot reload
- `npm run db:init` - Initialize database schema
- `npm run db:seed` - Seed database with sample events
- `npm run build` - Build for production
- `npm start` - Run production build

**Docker:**
- `docker compose up -d` - Start PostgreSQL and Redis
- `docker compose ps` - Check service status
- `docker compose restart` - Restart services

---

## 🎯 Current Capabilities

**What Works Now:**
- ✅ Browse public events (10 sample events included)
- ✅ View event details with ticket tiers
- ✅ Join waiting rooms for events
- ✅ See real-time countdown until sale opens
- ✅ Monitor waiting room status (auto-updates)
- ✅ Admin panel for creating events and tiers
- ✅ CORS-enabled for browser access
- ✅ Multiple concurrent users supported

**What's Next:**
- Queue positions and wave admission (Feature 3)
- Availability tracking (Feature 4)
- Reservation system (Feature 5)

