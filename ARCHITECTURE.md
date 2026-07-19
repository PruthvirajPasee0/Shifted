# Shifted — Enterprise Carpooling Platform

> A full-stack, organization-scoped carpooling application that lets employees of a
> company offer and find rides with colleagues, track trips live, settle fares through
> an in-app wallet, and manage compliance documents — all under an admin console per
> organization.

---

## 1. Project Summary

**Shifted** is an enterprise (B2B) carpooling platform. Unlike a public ride-sharing app,
every user belongs to an **Organization** (their employer), and all ride matching,
searching, and administration are strictly scoped to that organization. The goals are to
reduce commute cost, improve seat utilisation, and cut CO₂ emissions for a company's
workforce.

### High-level capabilities

| Area                            | What it does                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Auth & org onboarding** | Self-signup into an existing org (picker), admin-provisioned employees, JWT auth                                              |
| **Vehicles**              | Employees register vehicles (soft-deletable), gated by seating capacity/mileage checks                                        |
| **Documents**             | Upload licence / RC / insurance / ID for admin verification; offering rides requires a*verified* driving licence            |
| **Offer a ride**          | Drivers publish rides with map-picked origin/destination, seats, fare, departure time                                         |
| **Find a ride**           | Passengers search by map location; a haversine + bounding-box matcher ranks same-org rides by proximity                       |
| **Bookings**              | Concurrency-safe seat reservation with atomic seat decrement and rebook support                                               |
| **Trip lifecycle**        | Driver starts → in-progress → completes (or cancels); live location pings; in-ride chat                                     |
| **Payments & wallet**     | In-app wallet with Razorpay recharge (real, signature-verified) and simulated fallback; ride payment via wallet/card/UPI/cash |
| **Notifications**         | In-app notification rows + best-effort branded HTML emails on key events                                                      |
| **Reports**               | Per-user / per-org analytics: trips, distance, fuel, cost/km, CO₂ saved, seat utilisation, monthly & per-vehicle breakdowns  |
| **Admin console**         | Manage employees (grant/revoke access), verify documents, view vehicles, edit org cost config                                 |

### Technology stack

**Backend** (`backend/`)

- **FastAPI 0.115** on **Uvicorn** (ASGI)
- **SQLAlchemy 2.0** (synchronous ORM, typed `Mapped[...]` models)
- **Pydantic v2** + **pydantic-settings** for schemas and env config
- **python-jose** (JWT, HS256) + **passlib[bcrypt]** for auth
- **SQLite** by default (zero-setup); Postgres-ready via `DATABASE_URL`
- **Razorpay** SDK for payments; stdlib **smtplib** for email

**Frontend** (`frontend/`)

- **React 18 + TypeScript** built with **Vite 5**
- **Tailwind CSS 3** (CSS-custom-property theming; "CARPOOL/OS" brand identity)
- **react-router-dom v6** (routing), **axios** (HTTP), **framer-motion** (animations)
- **recharts** (analytics charts), **@react-google-maps/api** (maps), Razorpay Checkout (runtime script)

### Repository layout

```
Shifted/
├── ARCHITECTURE.md            ← this document
├── AUDIT.md                   ← project audit notes
├── make_erd.py / make_schema_pdf.py   ← scripts generating the ERD image / schema PDF
├── carpool_schema_erd.png     ← generated entity-relationship diagram
├── Carpool_Platform_Schema.pdf
├── backend/
│   ├── main.py                ← thin entrypoint (imports app.main:app)
│   ├── requirements.txt / pyproject.toml / uv.lock
│   ├── .env.example
│   └── app/
│       ├── main.py            ← FastAPI app, CORS, router mounting, lifespan
│       ├── config.py          ← Settings (pydantic-settings)
│       ├── database.py        ← engine, session, Base, get_db
│       ├── models.py          ← SQLAlchemy ORM models + enums
│       ├── schemas.py         ← Pydantic request/response models
│       ├── security.py        ← password hashing + JWT
│       ├── deps.py            ← auth dependencies (current user / active / admin)
│       ├── utils.py           ← haversine, bounding box, match score, fuel/cost math
│       ├── seed.py            ← demo data seeder
│       ├── email_templates.py ← branded transactional HTML email builders
│       ├── routers/           ← auth, admin, vehicles, documents, places,
│       │                         rides, bookings, wallet, payments, reports, notifications
│       └── services/          ← email (SMTP), notifications (push), payment_gateway (Razorpay)
└── frontend/
    ├── vite.config.ts / tailwind.config.js / tsconfig.json
    ├── .env.example
    └── src/
        ├── main.tsx           ← React root (BrowserRouter → AuthProvider → App)
        ├── App.tsx            ← route tree + splash gating
        ├── index.css          ← Tailwind layers + design tokens
        ├── context/AuthContext.tsx
        ├── lib/               ← api, format, image, razorpay, useAsync
        ├── types/index.ts     ← shared domain TypeScript types
        ├── components/        ← 17 reusable UI + feature components
        └── pages/             ← 13 route pages
```

---

## 2. System Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Browser (SPA)                                 │
│  React + Vite  ──  AuthContext (JWT in localStorage)  ──  axios client     │
│      │  Google Maps JS         │  Razorpay Checkout (runtime script)       │
└──────┼─────────────────────────┼───────────────────────────────────────────┘
       │  Authorization: Bearer <JWT>   (per-request interceptor)
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      FastAPI  (prefix /api)                                │
│  CORS → routers → deps (auth/role gates) → services → SQLAlchemy session   │
│                                                                            │
│   services/email (SMTP, background)   services/payment_gateway (Razorpay)  │
│   services/notifications (in-app rows + queued emails)                     │
└──────┬───────────────────────────────────────────────┬────────────────────┘
       ▼                                                ▼
   SQLite / Postgres                            External: Gmail SMTP, Razorpay
```

Key architectural decisions:

- **Organization isolation** is enforced ad hoc in each router by checking the acting
  user's `org_id` against the resource owner/driver's `org_id`. Ride cross-org access
  returns **404** (not 403) so outsiders cannot even confirm a ride exists.
- **Stateless auth**: JWTs carry `sub` (user id) + `role` + `org_id`; there is no server
  session store. Tokens expire after `ACCESS_TOKEN_MINUTES` (default 15).
- **Notifications are transaction-atomic**: `notify.push` adds the in-app row to the same
  DB session as the triggering event; the *caller* commits. Emails are queued as
  best-effort FastAPI background tasks and never block or roll back a request.
- **Money uses `Decimal`** end-to-end on the backend (via `Decimal(str(...))`) to avoid
  float drift; response schemas expose them as floats and the frontend defensively
  coerces numeric strings (`format.ts#toNumber`).

---

## 3. Backend — Module-by-Module

### 3.1 `app/config.py` — Settings

Defines a `Settings(BaseSettings)` loaded from `.env` (extra keys ignored). A module
singleton `settings = Settings()` is imported everywhere.

- **`DATABASE_URL`** (default `sqlite:///./carpool.db`)
- **`JWT_SECRET`** — **required, no fallback**; a missing secret fails startup rather than
  signing tokens with a public placeholder.
- **`JWT_ALGORITHM`** (`HS256`), **`ACCESS_TOKEN_MINUTES`** (15)
- **`GOOGLE_API_KEY`**, **`FRONTEND_URL`** (used to build email CTA links)
- **Email/SMTP**: `EMAIL_ENABLED`, `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`,
  `SMTP_PASSWORD`, `SMTP_FROM_NAME`
- **Razorpay**: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- Computed properties: **`email_configured`** (enabled + user + password) and
  **`razorpay_configured`** (both keys present) — used to gracefully degrade to
  simulated/no-op behavior when integrations are unconfigured.

### 3.2 `app/database.py` — Persistence plumbing

- Builds the SQLAlchemy `engine` with `pool_pre_ping=True`. For SQLite it passes
  `check_same_thread=False` (needed under FastAPI's threadpool) and registers a `connect`
  event that runs `PRAGMA foreign_keys=ON` on **every** connection (SQLite ignores FKs
  otherwise).
- `SessionLocal` = `sessionmaker(autocommit=False, autoflush=False)`.
- `Base(DeclarativeBase)` — the ORM base class.
- **`get_db()`** — FastAPI dependency yielding a session and closing it in `finally`.

### 3.3 `app/models.py` — ORM models & enums

All primary keys are UUID strings (`PK() = String(36) default uuid4`), portable across
SQLite/Postgres. Timestamps use `server_default=func.now()` and `onupdate=func.now()`.

**Enums**: `UserRole`(admin/employee), `UserStatus`(invited/active/suspended),
`FuelType`(petrol/diesel/ev/cng), `RideStatus`(scheduled/started/in_progress/completed/cancelled),
`BookingStatus`(booked/cancelled/completed), `PaymentType`(ride_payment/wallet_recharge),
`PayMethod`(cash/card/upi/wallet), `PayStatus`(pending/success/failed),
`WtxnType`(recharge/debit/credit), `DocType`(driving_license/id_proof/vehicle_rc/vehicle_insurance),
`DocStatus`(pending/verified/rejected), `PmType`(card/upi), `TicketStatus`(open/in_progress/closed).

**Tables** (with notable columns & constraints):

- **`organizations`** — `name`, unique `domain`, `address`, `industry`, `admin_contact`,
  cost config (`fuel_cost_per_litre`, `cost_per_km`, `travel_cost` as `Numeric(12,2)`),
  `currency` (default INR). Has many `users`.
- **`users`** — `org_id` (FK, indexed), `name`, unique `email`, `phone` (BigInteger),
  `password_hash`, `role`, `status`, `photo_url` (Text — stores inline data URLs),
  `department`, `manager`, `office_location`, `revoked_at`/`revoked_by` (suspension audit).
  Has many `vehicles`.
- **`vehicles`** — `owner_id`, `model`, unique `reg_number`, `seating_capacity`,
  `fuel_type`, `mileage_kmpl`, `color`, `is_active` (soft-delete flag).
  Check constraints: seats ≥ 1, mileage > 0 (or null).
- **`saved_places`** — user's labelled lat/lng bookmarks.
- **`rides`** — `driver_id` (indexed), `vehicle_id`, optional `parent_ride_id` (recurrence),
  origin/destination text + lat/lng (origin coords indexed for bbox search),
  `departure_time` (indexed), `started_at`/`ended_at`, `total_seats`, `available_seats`,
  `fare_per_seat`, `distance_km`, `route_polyline`, recurrence fields, `status` (indexed),
  cancellation metadata. Check constraints: seats positive, available ∈ [0, total], fare ≥ 0.
- **`bookings`** — `ride_id` + `passenger_id` (both indexed), `seats`, pickup/drop coords,
  `fare_amount`, `status`, cancel metadata. **Partial unique index**
  `uq_booking_ride_passenger_active` (`ride_id, passenger_id` WHERE `status != 'cancelled'`)
  — one *active* booking per ride per passenger, but cancelled ones don't block a rebook.
- **`trip_locations`** — live-tracking pings (`ride_id`, lat/lng, `eta`, `recorded_at`).
- **`payments`** — `booking_id?`, `payer_id`, `payee_id?`, `type`, `amount`, `method`,
  `status`, `gateway_ref` (used for idempotency/replay protection).
- **`wallets`** — one per user (unique `user_id`), `balance` with check `balance >= 0`.
- **`wallet_transactions`** — ledger: `type`, `amount`, `balance_after`, `ref_payment_id`.
- **`messages`** — in-ride chat (`ride_id`, `sender_id`, `receiver_id`, `body`, `sent_at`);
  exposes a `sender_name` property.
- **`notifications`** — `user_id`, `type`, `title`, `body`, `is_read`, `created_at`.
- **`ratings`** — `stars` (check 1–5), `comment` per ride/rater/ratee.
- **`documents`** — `user_id` (indexed), `doc_type`, `doc_number`, `file_url` (inline data
  URL), `status`, `expiry_date`, verification metadata, `rejection_reason`.
- **`payment_methods`** — saved card/UPI (masked).
- **`support_tickets`** — subject/body/status.

### 3.4 `app/security.py` — Crypto

- `hash_password` / `verify_password` via passlib bcrypt context.
- `create_access_token(subject, extra?)` — builds `{sub, exp, ...extra}` and signs with
  `JWT_SECRET`/`HS256`; expiry = now + `ACCESS_TOKEN_MINUTES`.
- `decode_access_token(token)` — returns the payload dict or `None` on `JWTError`.

### 3.5 `app/deps.py` — Auth dependency chain

- `oauth2_scheme` — `OAuth2PasswordBearer(tokenUrl="api/auth/login")`.
- **`get_current_user`** — decodes the bearer token, loads the `User` by `sub`; raises
  `401 Could not validate credentials` on any failure.
- **`get_current_active_user`** — additionally rejects non-`active` users with
  `403 User account is <status>`.
- **`require_admin`** — active user whose `role == admin`, else `403 Admin privileges required`.

These three form a strict ladder used across all protected endpoints.

### 3.6 `app/utils.py` — Geo & cost math

- **`haversine(lat1,lng1,lat2,lng2)`** — great-circle distance in km (Earth radius 6371.0088).
- **`bbox_deg(lat, radius_km)`** — returns `(lat_delta, lng_delta)` in degrees for a bounding
  box; used as a cheap SQL pre-filter before the exact haversine. Guards against pole
  division by clamping `cos(lat)` at `1e-6`.
- **`match_score(origin_dist, dest_dist, radius)`** — 0..100 score:
  `max(0, (2·radius − (o+d)) / (2·radius)) · 100`, rounded to 2 dp. Closer combined
  pickup+drop → higher score.
- **`fuel_litres(distance, mileage)`** and **`trip_cost(distance, mileage, cost_per_litre)`**
  — `Decimal`-based fuel/cost computations (0 if mileage ≤ 0), quantized to 0.01.

### 3.7 `app/main.py` — Application assembly

- `lifespan` runs `Base.metadata.create_all(bind=engine)` on startup (auto-creates tables;
  no Alembic migrations).
- Instantiates `FastAPI(title="Enterprise Carpooling Platform API", version 1.0.0)`.
- CORS allows `http://localhost:5173` and `:3000` with all methods/headers + credentials.
- Mounts all 11 routers under **`/api`**.
- `GET /api/health` → `{"status":"ok","service":"carpool-api"}`.

### 3.8 `app/schemas.py` — Pydantic contracts

Response models inherit **`ORMModel`** (`from_attributes=True`) so they build directly from
ORM rows; request models use plain `BaseModel`. Reusable constrained types:
`Latitude` (±90), `Longitude` (±180), `Phone` (Indian 10-digit int, 6–9 leading), and a
`validate_strong_password` field validator (≥8 chars with lower/upper/digit/special).

Notable groups & quirks:

- **Auth/users**: `RegisterRequest` (uses `org_id`), `LoginRequest`, `UserOut` (never exposes
  password), `ProfileUpdate` (can't change email/role), `AdminEmployeeCreate` (password
  defaults to `Employee@123`), `TokenResponse`, `AdminStats`.
- **Money in/float out**: request models type fare/mileage/cost fields as `Decimal`;
  response models expose them as `float`.
- **Documents**: `MAX_FILE_URL_LEN = 7_500_000` (~5 MB raw ≈ 7 MB base64 data URL).
- **Rides**: `RideCreate`, `RideOut`, `RideMatchOut` (nested ride+driver+vehicle + score +
  distances), `RideDetailOut`.
- **Wallet/payments**: two recharge paths — simulated (`RechargeRequest`) vs real Razorpay
  (`RechargeOrderRequest` → `RechargeOrderOut` in paise → `RechargeVerifyRequest`).
- **Messages**: `MessageOut.created_at` uses `AliasChoices("sent_at","created_at")` — the DB
  column is `sent_at` but it's exposed to the client as `created_at`.

### 3.9 `app/services/` — Integrations

- **`email.py`** (`send_email`) — stdlib SMTP, **never raises** (returns bool). Short-circuits
  if email isn't configured. Builds a multipart HTML+text message, strips spaces from the
  app password (Gmail style), and uses explicit STARTTLS on port 587. Logger `carpool.email`.
  Designed to run as a background task.
- **`notifications.py`** (`push`) — creates a `Notification` row (added, *not committed*) and,
  when a `background_tasks` + `email` dict are supplied and the user has an email, queues
  `send_email`. Helpers `fmt_route(ride)` → `"origin → destination"`, `fmt_when(dt)`.
- **`payment_gateway.py`** — thin Razorpay wrapper with a cached singleton `get_client()`
  (returns `None` if unconfigured) and `verify_signature(order_id, payment_id, signature)`
  (HMAC verify; catches `SignatureVerificationError` → `False`).

### 3.10 `app/email_templates.py` — Transactional emails

Table-based, inline-styled HTML (email-client safe) under the "Twilight Transit" palette,
wordmark **CARPOOL/OS**. A `_render(...)` shell + `_button`, `_facts`, `_fact_row` helpers
build 9 templates, each returning `{subject, html, text}` with a CTA linking into
`FRONTEND_URL`:

| Template              | To        | Trigger                               | CTA               |
| --------------------- | --------- | ------------------------------------- | ----------------- |
| `welcome_employee`  | employee  | admin creates account (temp password) | Sign in           |
| `booking_created`   | driver    | passenger booked                      | View trip         |
| `booking_cancelled` | driver    | passenger cancelled                   | View trip         |
| `ride_cancelled`    | passenger | driver cancelled ride                 | Find another ride |
| `ride_started`      | passenger | ride started                          | Track live        |
| `ride_completed`    | passenger | ride done, fare due                   | Pay now           |
| `payment_received`  | driver    | payment credited                      | View wallet       |
| `document_verified` | user      | doc approved                          | Offer a ride      |
| `document_rejected` | user      | doc rejected (reason)                 | Re-upload         |

### 3.11 `app/seed.py` — Demo data

Idempotent seeder (`python -m app.seed`); every insert is existence-guarded. Creates:

- Org **Acme Corp** (`acme.com`, fuel ₹105.50/L, ₹8/km, INR).
- Admin `admin@acme.com` / `Admin@123` (wallet 0).
- **4 employees** (Ravi, Priya, Arjun, Neha) `Employee@123`, each with a ₹500 wallet.
- Vehicles: Toyota Innova (diesel, Ravi) and Tata Nexon EV (Priya).
- Documents: Ravi's **verified** licence (so he can offer rides) + Priya's **pending** licence.
- Rides: one upcoming `scheduled` (Koramangala→Whitefield) and one `completed`
  (Indiranagar→Electronic City) driven by Ravi.

### 3.12 Routers (`app/routers/`, all under `/api`)

Common dependencies: `get_current_active_user` (most), `require_admin` (admin router).

#### `auth.py` (`/auth`)

- `GET /organizations` (public) — org picker list.
- `POST /register` (public, 201) — validates org exists, unique email, hashes password,
  creates `User(role=employee, active)` + a zero-balance `Wallet`, returns a token.
- `POST /login` (public) — verifies credentials; blocks `suspended`; returns token.
- `GET /me` / `PATCH /me` — read/update own profile (`ProfileUpdate`).

#### `admin.py` (`/admin`, all `require_admin`, org-scoped)

- `GET /stats` — employee/vehicle/rides-this-month/pending-docs/suspended counts.
- `GET /users`, `POST /employees` (creates user + queues welcome email with temp password),
  `PATCH /users/{id}` (activate/suspend; sets/clears `revoked_at`/`revoked_by`).
- `GET /vehicles` (with `owner_name`), `GET /org`, `PATCH /org` (cost config).
- `GET /documents?status=pending`, `PATCH /documents/{id}/verify` (verify/reject +
  notification & email to owner).

#### `vehicles.py` (`/vehicles`, owner-scoped)

- `GET`, `POST` (unique `reg_number`, IntegrityError-guarded), `PATCH /{id}`,
  `DELETE /{id}` (**soft delete** → `is_active=False`).

#### `documents.py` (`/documents`, owner-scoped)

- `GET`, `POST` (always starts `pending`; file stored inline as data URL).

#### `places.py` (`/places`, owner-scoped)

- `GET`, `POST`, `DELETE /{id}` (hard delete).

#### `rides.py` (`/rides`) — the core matching engine

Helpers: `_load_ride_same_org` (404 on cross-org), `_load_own_ride` (403 if not driver),
`_active_passengers`, `_is_ride_participant`, `_has_valid_license` (verified + non-expired
`driving_license`), `SEARCH_RADIUS_KM = 5.0`.

- `POST /` (201) — offer a ride. Gates: valid licence → owned & **active** vehicle →
  `total_seats ≤ vehicle capacity` → departure in the future. Creates ride with
  `available_seats = total_seats`.
- **`GET /search`** — ranked matcher:
  1. `now` in UTC.
  2. **Bounding-box pre-filter** around origin (`bbox_deg(origin_lat, 5km)`).
  3. SQL candidates: `status=scheduled`, `available_seats ≥ seats`, **same org**, origin
     within bbox.
  4. Python refinement: skip past departures; optional `date` filter; compute exact
     haversine to origin *and* destination and **skip if either > 5 km**.
  5. Score with `match_score`, sort descending.
- `GET /mine`, `GET /{id}` (detail with driver+vehicle).
- `POST /{id}/start` → `in_progress` + notify passengers.
- `POST /{id}/complete` → `completed` + notify passengers (payment due).
- `POST /{id}/cancel` → cancels ride and **bulk-cancels** its booked bookings + notifies
  (no automatic seat restore/refund here).
- `POST /{id}/locations` (driver only) + `GET /{id}/locations` (latest ping, same-org).
- `GET /{id}/bookings` (driver only), `GET`/`POST /{id}/messages` (participants only).

#### `bookings.py` (`/bookings`)

- `POST /` (201) — validates same-org ride is `scheduled`, not self-booking, no existing
  active booking; **atomic seat decrement** via
  `UPDATE rides SET available_seats = available_seats - seats WHERE id=? AND available_seats >= seats`
  (rowcount 0 → `400 Not enough seats`, prevents oversell); inserts booking; then commits and
  notifies the driver.
- `GET /mine` (with hydrated ride).
- `POST /{id}/cancel` — sets cancelled, **restores seats** clamped to `total_seats`, notifies driver.

#### `wallet.py` (`/wallet`)

- `GET /` — get-or-create wallet + transaction ledger.
- `POST /recharge/order` — creates a Razorpay order (503 if unconfigured; min ₹1); **no DB write**.
- `POST /recharge/verify` — verifies HMAC signature; **idempotency** via existing
  `gateway_ref`; re-reads the **authoritative amount from Razorpay** (never trusts the client);
  credits wallet + writes payment & transaction rows.
- `POST /recharge` — simulated fallback (only when Razorpay is *not* configured).

#### `payments.py` (`/payments`)

- `POST /` (201) — pay for a booking. Creates a `Payment(pending)`; for **wallet** method
  debits the payer (insufficient balance → 400 + rollback); **always credits the driver's
  wallet** (cash/card/UPI settle off-app but earnings are tracked in-app); marks payment
  `success` + booking `completed`; notifies driver. Non-wallet gateway success is simulated.

#### `reports.py` (`/reports`)

- `GET /summary` — admins see all completed rides driven by their org; others see only their
  own. Aggregates trips, distance, fuel, cost; seat utilisation (`seats_used/seats_offered`);
  **CO₂ saved** = `distance · 0.121 · booked_seats` per ride; rolls up per-vehicle and
  per-month; computes `avg_cost_per_km` and `utilization_rate`.

#### `notifications.py` (`/notifications`)

- `GET /` (`unread_only`, `limit`), `GET /unread-count`, `PATCH /{id}/read`, `POST /read-all`.

---

## 4. Frontend — Module-by-Module

### 4.1 Entry & routing

- **`main.tsx`** — mounts under `StrictMode` with provider order
  `BrowserRouter → AuthProvider → App`.
- **`App.tsx`** — route tree:
  - Public: `/login`, `/signup`.
  - Protected shell: a parent `<ProtectedRoute><Layout/></ProtectedRoute>` wraps all
    authenticated routes; each child *also* carries its own `ProtectedRoute` with a role gate.
    - Employee-only: `/` (Dashboard), `/find`, `/offer`, `/trips`, `/trips/:id`, `/vehicles`,
      `/documents`, `/wallet`.
    - Shared: `/reports`, `/profile`. Admin-only: `/admin`.
  - `*` → redirect to `/`.
  - **Splash gating**: a framer-motion splash shows on `/login`|`/signup` only when there's no
    stored token and the session flag `cp_login_splash_seen` isn't set.

### 4.2 Auth & API client

- **`context/AuthContext.tsx`** — `user`/`token` seeded lazily from localStorage
  (`cp_access_token`, `cp_user`). `login`/`register`/`updateProfile` call the API and
  `persist` results; `logout` clears storage (client-side only); `refresh()` revalidates via
  `GET /auth/me` on mount but **keeps the cached user on failure** (offline tolerance).
- **`lib/api.ts`** — axios instance, base `http://localhost:8000/api` (**hardcoded**), 15 s
  timeout. **Request interceptor** attaches `Authorization: Bearer <token>` from localStorage
  per request. **Response interceptor** clears storage on **401** (next protected render
  bounces to `/login`); other errors propagate.
- **`components/ProtectedRoute.tsx`** — redirects unauthenticated users to `/login`
  (preserving origin) and role-mismatched users to their own home (`homeForRole`).

### 4.3 Library utilities (`lib/`)

- **`format.ts`** — `money` (₹, en-IN), `num`, `dateLabel`, `timeLabel`, `haversineKm`, and a
  defensive `toNumber` (coerces Decimal-as-string API fields).
- **`image.ts`** — 5 MB cap; `fileToAvatarDataUrl` (center-crop + downscale to a square JPEG
  data URL) and `fileToDataUrl` (documents: pdf/png/jpeg/webp, no resize). Uploads are inline
  data URLs, not multipart.
- **`razorpay.ts`** — lazily injects the Razorpay Checkout script and `openRazorpayCheckout`
  opens the modal, forwarding `{order_id, payment_id, signature}` to `onSuccess`.
- **`useAsync.ts`** — generic `{data, loading, error, reload}` hook with a stale-result guard;
  the standard data-loading + post-mutation refresh mechanism across pages.
- **`types/index.ts`** — shared domain types mirroring the backend (User, Organization, Ride,
  RideMatch, Booking, Wallet, Document, ReportSummary, etc.); IDs typed `string | number`.

### 4.4 Components (`components/`)

**Shell**: `Layout` (sidebar + topbar + animated `<Outlet/>` keyed by pathname), `Sidebar`
(role-based nav: 9 employee items / 3 admin items), `Topbar` (date, status badge, bell,
profile pill), `AuthShell` (two-column login/signup scaffold).

**Primitives**: `Avatar` (image or initials), `Button` (variant/size/block), `Card`,
`Field` (`Label`/`Input`/`Select`/`Textarea` with error/hint), `Modal` (Escape + scroll-lock),
`PageHeader`, `StatCard` (KPI tile), `StatusBadge` (maps status strings → 5 tones),
`Table` (generic, typed columns, row-click).

**Feature**: `Splash` (animated launch screen), `NotificationBell` (polls unread count every
30 s, dropdown list, optimistic mark-read), `MapView` (Google Maps via `useJsApiLoader`,
env key `VITE_GOOGLE_MAPS_API_KEY`, inline-SVG pins, placeholder when key missing).

### 4.5 Pages (`pages/`)

| Page                 | Route          | Loads                                                     | Purpose / key actions                                                                                      |
| -------------------- | -------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Login**      | `/login`     | —                                                        | `login()`, redirect to `from` or role home                                                             |
| **Signup**     | `/signup`    | `GET /auth/organizations`                               | org picker, photo, phone/password validation,`register()`                                                |
| **Dashboard**  | `/`          | `/reports/summary`, `/bookings/mine`, `/rides/mine` | KPI cards, recent bookings, quick actions                                                                  |
| **FindRide**   | `/find`      | `/rides/search`                                         | map pick origin/dest, ranked matches,`POST /bookings`                                                    |
| **OfferRide**  | `/offer`     | `/vehicles`, `/documents`                             | gated on verified licence + active vehicle;`POST /rides`                                                 |
| **Trips**      | `/trips`     | `/bookings/mine`, `/rides/mine`                       | passenger/driver tabs table                                                                                |
| **TripDetail** | `/trips/:id` | ride, locations, bookings, messages                       | lifecycle timeline, start/complete/cancel, pay, chat                                                       |
| **Vehicles**   | `/vehicles`  | `/vehicles`                                             | CRUD (modal), soft-delete                                                                                  |
| **Documents**  | `/documents` | `/documents`                                            | upload for verification, view status/rejection                                                             |
| **Wallet**     | `/wallet`    | `/wallet`                                               | balance + ledger, Razorpay recharge (order→verify)                                                        |
| **Profile**    | `/profile`   | (from AuthContext)                                        | edit profile + photo via`updateProfile`                                                                  |
| **Reports**    | `/reports`   | `/reports/summary`                                      | recharts line/bar + KPI cards + per-vehicle table                                                          |
| **Admin**      | `/admin`     | stats, users, vehicles, org, pending docs                 | 4 tabs: Employees (grant/revoke, add), Vehicles, Documents (verify/reject), Company Settings (cost config) |

**Cross-cutting frontend patterns**: error detail read as `err.response.data.detail`;
Mumbai default map center `{19.076, 72.8777}`; fare heuristic `distance · 8` ₹/km;
Indian phone regex `/^[6-9][0-9]{9}$/` in Signup/Profile/Admin; `useAsync().reload()` after
every mutation.

---

## 5. End-to-End Flows

### 5.1 Offer → search → book → ride → pay

1. **Offer** — Driver (with a verified licence + active vehicle) publishes a ride on
   `/offer` → `POST /rides` (`available_seats = total_seats`).
2. **Search** — Passenger picks origin/destination on `/find` → `GET /rides/search`; the
   backend bbox-prefilters same-org scheduled rides, exact-haversine-filters to a 5 km radius
   on both ends, scores and sorts them.
3. **Book** — `POST /bookings` atomically decrements seats (oversell-safe) and emails the
   driver.
4. **Ride** — Driver `start`s → `complete`s from `/trips/:id`; passengers get
   started/completed notifications + emails; live location pings render on the map.
5. **Pay** — Passenger pays via wallet/card/UPI/cash → `POST /payments`; wallet debits the
   payer (if wallet) and always credits the driver's wallet; booking → `completed`; driver is
   notified.

### 5.2 Wallet recharge (real Razorpay)

`POST /wallet/recharge/order` → frontend opens Razorpay Checkout → on success
`POST /wallet/recharge/verify` (HMAC-verified, amount re-read from Razorpay, idempotent by
`gateway_ref`) credits the wallet. When Razorpay is unconfigured, `POST /wallet/recharge`
simulates a successful credit for local dev.

### 5.3 Document verification gate

Employees upload documents (`pending`) → admin verifies/rejects on `/admin` →
owner is notified/emailed. Offering a ride is blocked until a **verified, non-expired
driving licence** exists (`_has_valid_license`).

---

## 6. Running the Project

### Backend

```bash
cd backend
py -3.13 -m venv .venv && .\.venv\Scripts\Activate.ps1   # Windows
pip install -r requirements.txt
copy .env.example .env          # set JWT_SECRET (required); Razorpay/SMTP optional
python -m app.seed              # demo org, admin, employees, rides
uvicorn app.main:app --reload   # http://127.0.0.1:8000  (Swagger at /docs)
```

> ⚠ `JWT_SECRET` is required — the app refuses to start without it.
> Use Python 3.11–3.13 (3.14 lacks prebuilt `pydantic-core` wheels).
> `razorpay` is in `requirements.txt` but **not** in `pyproject.toml` — install via requirements.

### Frontend

```bash
cd frontend
npm install
copy .env.example .env          # set VITE_GOOGLE_MAPS_API_KEY for maps
npm run dev                     # http://localhost:5173
```

### Seeded logins

- Admin: `admin@acme.com` / `Admin@123`
- Employees: `ravi@…` (can offer rides), `priya@…`, `arjun@…`, `neha@…` — all `Employee@123`

---

## 7. Notable Design Points & Caveats

- **Org isolation** is per-endpoint (not a global filter); ride cross-org access returns 404.
- **Concurrency safety** relies on a conditional `UPDATE ... WHERE available_seats >= seats`
  plus a partial unique booking index — no explicit row locks.
- **Ride cancellation** cancels bookings but does **not** auto-refund or restore seats
  (booking cancellation *does* restore seats).
- **Non-wallet payments are simulated** as successful; only the earnings ledger is real.
- **Configuration to review before deploy**: `API_BASE_URL` is hardcoded in `lib/api.ts`
  (no env / Vite proxy); the Maps key *is* env-driven. Emails/Razorpay degrade gracefully
  when unconfigured.
- **No migrations**: tables are auto-created via `create_all` at startup; schema changes to
  an existing SQLite DB require manual handling.
- **Brand naming**: code/email wordmark is "CARPOOL/OS" while the repo is "Shifted".

```

```
