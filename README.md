# TicketDrop

**A Ticketmaster-style high-demand ticketing system with fair waiting room, Redis-backed queue, and idempotent checkout.**

TicketDrop demonstrates production-ready patterns for handling high-concurrency ticket sales, including wave-based admission, oversell protection, reservation management with TTL, and idempotent payment processing.

---

## 🎯 What This Showcases

- **Redis Queue + Wave Admission**: Fair waiting room with wave-based entry to prevent server overload
- **Oversell-Safe Reservations**: TTL-based ticket holds with automatic expiration and inventory restoration
- **Idempotent Checkout**: Safe payment processing that handles retries and network failures gracefully
- **Background Worker**: Automated expiration processing for reservations and inventory management
- **Observability**: Prometheus metrics and structured logging for monitoring and debugging
- **Purchase Limits**: Per-user, per-event ticket limits with active reservation tracking
- **Rate Limiting**: Protection against abuse on critical endpoints

---

## 🛠 Tech Stack

**Backend:**
- Node.js + TypeScript
- Express.js
- PostgreSQL (source of truth)
- Redis (queue & inventory management)
- Prometheus metrics

**Frontend:**
- React + TypeScript
- Vite

**Infrastructure:**
- Docker Compose (Postgres + Redis)

---

## 🏗 Architecture Overview

```
┌─────────────┐
│   React UI  │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│      Express API (Port 4000)        │
│  ┌──────────────────────────────┐   │
│  │  Waiting Room Router          │   │
│  │  (Wave-based admission)       │   │
│  └──────────────┬───────────────┘   │
│                 │                    │
│  ┌──────────────▼───────────────┐   │
│  │  Reservations Router          │   │
│  │  (TTL-based holds)            │   │
│  └──────────────┬───────────────┘   │
│                 │                    │
│  ┌──────────────▼───────────────┐   │
│  │  Checkout Router              │   │
│  │  (Idempotent processing)      │   │
│  └──────────────┬───────────────┘   │
└─────────────────┼───────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌───────────────┐   ┌───────────────┐
│   PostgreSQL  │   │     Redis     │
│ (Source of    │   │ (Queue &      │
│  Truth)       │   │  Inventory)   │
└───────────────┘   └───────────────┘
        │
        ▼
┌───────────────┐
│ Expiration    │
│ Worker        │
│ (Background)  │
└───────────────┘
```

**Data Flow:**
1. User joins waiting room → Token stored in Redis
2. Wave admission → Access granted via Redis
3. Reservation created → Inventory held in Postgres, TTL in Redis
4. Checkout session → Idempotent key prevents duplicates
5. Payment confirmed → Order + tickets created atomically
6. Background worker → Expires old reservations, restores inventory

---

## 🚀 How to Run Locally

### Prerequisites
- Node.js 18+ and npm
- Docker and Docker Compose

### Step-by-Step Setup

1. **Start infrastructure services:**
   ```bash
   docker compose up -d
   ```

2. **Set up environment variables:**
   ```bash
   cd api
   # Create .env file (see api/.env.example for required variables)
   # Default values work for local development
   ```

3. **Install dependencies:**
   ```bash
   cd api && npm install
   cd ../web && npm install
   ```

4. **Initialize the database:**
   ```bash
   cd api
   npm run db:init      # Creates tables
   npm run db:seed      # Optional: seeds sample events
   ```

5. **Start the API server:**
   ```bash
   cd api
   npm run dev          # Runs on http://localhost:4000
   ```

6. **Start the web app (in a new terminal):**
   ```bash
   cd web
   npm run dev          # Runs on http://localhost:5173
   ```

7. **Open your browser:**
   - Navigate to `http://localhost:5173`
   - The frontend automatically generates and sends a `X-User-Id` header

---

## 🎬 How to Demo in 2 Minutes

1. **Browse Events**: Open `http://localhost:5173` and view available events
2. **Join Waiting Room**: Click "Join Waiting Room" on an event
3. **Wait for Admission**: Monitor status until `canEnter: true` (wave-based)
4. **Reserve Tickets**: Select tier and quantity, click "Reserve Tickets"
5. **Checkout**: Click "Proceed to Checkout" → "Confirm Payment" (simulated)
6. **View Tickets**: Click "My Tickets" to see purchased tickets with QR codes

**Optional:**
- View live metrics at `http://localhost:4000/metrics` (Prometheus format)
- Check admin endpoints at `http://localhost:4000/admin/events`

---

## 📚 API Documentation

### Public Endpoints

**Events:**
- `GET /events` - List all public events
- `GET /events/:id` - Get event details with ticket tiers
- `GET /events/:id/availability` - Get real-time availability per tier

**Waiting Room:**
- `POST /events/:id/waiting-room/join` - Join waiting room (returns token)
- `GET /events/:id/waiting-room/status?token=...` - Check status and queue position

**Reservations:**
- `POST /events/:id/reservations` - Create reservation (requires waiting room token)
  - Body: `{ tier_id, quantity, token }`
  - Headers: `X-User-Id` (required)

**Checkout:**
- `POST /checkout/sessions` - Create checkout session (idempotent)
  - Headers: `Idempotency-Key` (required), `X-User-Id` (required)
  - Body: `{ reservation_id }`
- `POST /checkout/confirm` - Confirm payment (idempotent)
  - Headers: `X-User-Id` (required)
  - Body: `{ checkout_id, simulate: "success" | "fail" }`

**Tickets:**
- `GET /me/tickets` - Get all tickets for current user
  - Headers: `X-User-Id` (required)

### Admin Endpoints

- `GET /admin/events/:id/status` - Get detailed event status (reservations, orders, inventory)
- `GET /metrics` - Prometheus metrics endpoint

---

## 🧪 Running Tests

```bash
cd api
npm test
```

**Test Coverage:**
- **Idempotency**: Checkout sessions and confirmations handle duplicate requests safely
- **Oversell Protection**: Concurrent reservation requests respect inventory limits
- **Expiration**: Background worker expires reservations and restores inventory
- **Purchase Limits**: Per-user, per-event limits are enforced correctly
- **End-to-End**: Complete purchase flow from waiting room to ticket issuance

---

## 📖 About This Project

### Why I Built This

- **Practice designing for high concurrency & fairness**: Implemented wave-based admission to prevent server overload during ticket drops
- **Learn Redis + Postgres coordination**: Used Redis for queue management and Postgres as source of truth, ensuring data consistency
- **Explore idempotency, background workers, and observability**: Built idempotent checkout flows, automated expiration workers, and comprehensive metrics

### Key Design Decisions

- **Wave-based admission**: Prevents thundering herd by admitting users in waves
- **TTL-based reservations**: Automatic expiration ensures inventory isn't held indefinitely
- **Idempotent checkout**: Safe retries prevent duplicate orders from network failures
- **Postgres as source of truth**: Redis used for ephemeral data (queue, access tokens), Postgres for persistent data
- **Background worker**: Periodic cleanup of expired reservations maintains data integrity

---

## 🔐 Identity Model & Purchase Limits

**Identity System:**
- **`X-User-Id` Header**: Canonical user identifier (in production, would come from auth)
- **Waiting Room Tokens**: Session tokens stored in Redis, associated with user ID
- **User Token in Database**: `user_token` column stores `X-User-Id` for purchase limits and queries

**Purchase Limits:**
- Default: **6 tickets per user per event** (configurable via `EVENT_PURCHASE_LIMIT`)
- Includes: Paid orders + active reservations
- Returns HTTP 403 with detailed breakdown when limit exceeded

**Rate Limiting:**
- `/events/:id/waiting-room/join`: 10 req/min per IP/event
- `/events/:id/reservations`: 5 req/min per user/event
- `/checkout/sessions`: 5 req/min per user
- `/checkout/confirm`: 10 req/min per user

---

## 📁 Project Structure

```
ticketmaster-clone/
├── api/                    # Backend API
│   ├── src/
│   │   ├── routes/         # Express routers
│   │   ├── db/             # Database utilities & migrations
│   │   ├── workers/        # Background workers
│   │   ├── middleware/     # Express middleware
│   │   └── utils/           # Utility functions
│   ├── tests/              # Integration tests
│   └── package.json
├── web/                    # React frontend
│   ├── src/
│   │   ├── UserView.tsx    # Main UI component
│   │   └── App.tsx
│   └── package.json
├── docker-compose.yml      # Postgres + Redis
└── README.md
```

---

## 🔮 What I'd Do Next (Future Work)

- **Real payments integration**: Replace simulated payments with Stripe/PayPal
- **Full authentication system**: JWT-based auth with user accounts and sessions
- **Enhanced monitoring**: Alerting integration (PagerDuty, Slack) and distributed tracing

---

## 📄 Documentation

- `OVERVIEW.md` - Complete feature documentation
- `QUICK_START.md` - Detailed setup guide
- `USER_TESTING_GUIDE.md` - End-user testing scenarios

---

## 📝 License

ISC
