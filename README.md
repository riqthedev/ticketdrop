# TicketDrop

A full-stack ticketing project exploring waiting-room admission, temporary ticket holds, and repeat-safe checkout.

**Stack:** TypeScript, Node.js/Express, PostgreSQL, Redis, React, and Vite.

## Engineering walkthrough

| Concern | Implementation to review |
| --- | --- |
| Waiting-room admission | [Redis sorted-set queue and wave admission](src/routes/waiting-room.ts) |
| Ticket holds | [Reservation validation, rate limiting, and database transactions](src/routes/reservations.ts) |
| Repeat requests | [Checkout handling](src/routes/checkout.ts) and [idempotency tests](src/routes/checkout.test.ts) |
| Expired inventory holds | [Expiration worker](src/workers/expirationWorker.ts) and [worker tests](src/workers/expirationWorker.test.ts) |
| API behavior | [Integration tests](tests-api/integration.test.ts) |
| User interface | [React frontend](web/src/UserView.tsx) |

## Repository layout

- `src/`: Express routes, database access, Redis, logging, and background processing.
- `web/`: React/Vite frontend.
- `api/`: API deployment entry point and database initialization assets.
- `tests-api/`: API integration tests.
- `docker-compose.yml`: local service configuration.

This is a portfolio project. The code and tests are available for review; no production scale, benchmark, or test-pass claim is implied. Database-backed tests require a configured database.

## Author

[Nyriq Faber](https://github.com/riqthedev) · [LinkedIn](https://www.linkedin.com/in/nyriqfaber)
