## Reservation & Checkout Manual Test Plan

These steps validate the end-to-end flow (waiting room → reservation → checkout → order/tickets) plus the safeguards we recently added. All commands assume the API is running on `http://localhost:4000` and the web app on `http://localhost:5173`.

### 1. Join the waiting room and obtain tokens
```bash
curl -X POST http://localhost:4000/events/{eventId}/waiting-room/join \
  -H 'Content-Type: application/json'
```
- Response now returns a `token`. Visit the event in the UI so `canEnter` flips to true.
- When `canEnter` becomes true, the server issues a short-lived `waiting_room_access` key. You have ~3 minutes to create a reservation before it expires.

### 2. Create a reservation (POST /events/:id/reservations)
```bash
curl -X POST http://localhost:4000/events/{eventId}/reservations \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: {waitingRoomToken}' \
  -d '{"tier_id":"{tierId}","quantity":1,"token":"{waitingRoomToken}"}'
```
- Expect 201 with reservation details.
- If you try again with the same token before the first reservation expires, you should receive `409` (double-hold prevention).
- If you wait >3 minutes (or manually update `expires_at` to the past) and hit the endpoint again, the reservation will be marked `expired` by the worker and you can hold another set of tickets.

### 3. Check reservation status
```bash
curl http://localhost:4000/events/{eventId}/reservations?token={waitingRoomToken}
```
- Returns active reservation until it expires or is converted.

### 4. Create checkout session / confirm
```bash
curl -X POST http://localhost:4000/checkout/sessions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-{timestamp}' \
  -H 'X-User-Id: {waitingRoomToken}' \
  -d '{"reservation_id":"{reservationId}"}'

curl -X POST http://localhost:4000/checkout/confirm \
  -H 'Content-Type: application/json' \
  -d '{"checkout_id":"{checkoutSessionId}","simulate":"success"}'
```
- The second call should mark the reservation `converted`, create an order, and issue tickets.
- Re-running either call with the same payload is idempotent: you’ll get the same checkout session/order back.

### 5. Validate ticket issuance
```bash
curl http://localhost:4000/me/tickets?token={waitingRoomToken}
```
- Confirms that the tickets exist and include QR signatures. You can also query the `tickets` table directly if needed.

### 6. Forced expiration check
1. Update a reservation row: `UPDATE reservations SET expires_at = NOW() - INTERVAL '5 minutes' WHERE id = '...'`.
2. Wait up to 60 seconds for the worker run (logs will show `worker.reservations.expired`).
3. `GET /events/:id/reservations?token=...` should now return `404`, and the web UI will prompt you to re-run the flow.

Following these steps exercises all critical paths: waiting room admission, reservation creation, double-hold protection, checkout/session idempotency, order/ticket issuance, and automatic expiration. Use this checklist whenever you need to demonstrate the flow or verify future changes.


