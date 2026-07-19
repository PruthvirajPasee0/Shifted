# Ride Refund Design (Sprint 1)

## Goal

Make booking and ride cancellation financially safe for wallet and Razorpay payments.
Current code cancels bookings/seats but does not reverse settled fare in all paths.

## Refund Policy

- Before ride start:
  - Passenger cancellation => full refund.
  - Driver ride cancellation => full refund for all affected bookings.
- After ride start, before completion:
  - Driver cancellation => full refund.
  - Passenger cancellation => configurable policy (default: no refund).
- After ride completion:
  - No automatic refund; manual dispute flow only.

## Data Model Changes

- Add `payments.refund_status` enum: `none | pending | success | failed`.
- Add `payments.refunded_amount` numeric (default `0`).
- Add `payments.refund_ref` text for gateway refund id.
- Add `payment_refunds` table for immutable refund events:
  - `id`, `payment_id`, `booking_id`, `amount`, `reason`, `source` (`wallet|gateway|manual`), `status`, `gateway_ref`, timestamps.

## Service Layer

Create `app/services/refunds.py` with one orchestrator:

- `issue_refund(db, booking, reason, actor_id) -> RefundResult`
  - Lock booking + payment row.
  - Idempotency: if full refund already applied, return success without side effects.
  - Wallet payment:
    - Credit passenger wallet.
    - Debit driver wallet only if driver was credited already.
    - Record matching wallet transactions linked to refund event.
  - Razorpay payment:
    - Call Razorpay refund API for captured payment id.
    - Persist pending/success/failed state.
    - Credit passenger internal wallet only after gateway success (or keep strictly external based on business rule).

## API Changes

- `POST /bookings/{id}/cancel`:
  - Trigger refund orchestration when payment is `success`.
  - Return cancellation + refund summary.
- `POST /rides/{id}/cancel` and `/rides/{id}/series/cancel`:
  - Batch refund each paid booking.
  - Return counts: `refunded`, `pending_gateway_refunds`, `failed_refunds`.
- New admin endpoint:
  - `GET /payments/refunds?status=failed|pending` for operations visibility.

## Safety Requirements

- Strict idempotency key: `booking_id + payment_id + reason_category`.
- Full audit trail, never mutate historical refund rows.
- Transaction boundaries:
  - DB updates atomic per booking.
  - Gateway call result persisted even on partial failures.
- Reconciliation job:
  - Poll pending gateway refunds and finalize local state.

## Test Plan

- Unit:
  - Wallet refund credits passenger and restores ledger consistency.
  - Duplicate refund request is no-op.
  - Partial failure marks pending/failed with no double credit.
- Integration:
  - Booking cancel with paid wallet fare updates booking, payment, wallet txns.
  - Ride cancel with multiple paid bookings refunds all eligible bookings.
  - Razorpay mocked refund path validates state transitions.
