# Enterprise Carpooling Platform — Backend

A runnable FastAPI backend for an enterprise carpooling / ride-sharing platform.
Sync SQLAlchemy 2.0, Pydantic v2, JWT auth, SQLite by default (Postgres-ready).

## Requirements

- **Python 3.11 / 3.12 / 3.13** recommended.
  > Note: Python **3.14** currently has no prebuilt wheels for the pinned
  > `pydantic-core`, so `pip install` tries to compile Rust and fails.
  > Use 3.13 (`py -3.13`) or create the venv from a 3.11/3.12/3.13 interpreter.

## Run steps (Windows PowerShell)

```powershell
cd backend

# 1. Create & activate a virtual environment (use Python 3.13)
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. (optional) copy env file — defaults are fine for local SQLite
copy .env.example .env

# 4. Seed demo data (org, admin, 3 employees, vehicles, a verified licence, rides, wallets)
python -m app.seed

# 5. Run the API
uvicorn app.main:app --reload
```

macOS / Linux is the same with `python3 -m venv .venv` and `source .venv/bin/activate`.

## URLs

- API base URL: `http://127.0.0.1:8000/api`
- Health check: `GET http://127.0.0.1:8000/api/health`
- Interactive docs (Swagger): `http://127.0.0.1:8000/docs`
- OpenAPI JSON: `http://127.0.0.1:8000/openapi.json`

## Seeded login credentials

| Role     | Email             | Password       | Notes                                              |
|----------|-------------------|----------------|----------------------------------------------------|
| Admin    | `admin@acme.com`  | `Admin@123`    | Org admin (verify docs, manage users)              |
| Employee | `ravi@acme.com`   | `Employee@123` | Has a **verified licence** + active vehicle → can offer rides |
| Employee | `priya@acme.com`  | `Employee@123` | Owns an EV; has a **pending** licence to review    |
| Employee | `arjun@acme.com`  | `Employee@123` | Plain employee                                     |

Organization domain: `acme.com` (use it as `org_domain` when registering).

## Auth

1. `POST /api/auth/register` or `POST /api/auth/login` → returns `{ access_token, token_type, user }`.
2. Send the token on all protected routes: `Authorization: Bearer <access_token>`.
3. Access tokens expire after `ACCESS_TOKEN_MINUTES` (default 15).

## Configuration (`.env`)

| Var                   | Default                    | Description                          |
|-----------------------|----------------------------|--------------------------------------|
| `DATABASE_URL`        | `sqlite:///./carpool.db`   | Any SQLAlchemy URL (Postgres works). |
| `JWT_SECRET`          | dev placeholder            | Change in production.                |
| `ACCESS_TOKEN_MINUTES`| `15`                       | JWT lifetime.                        |

For Postgres:
`DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/carpool`

## API surface (prefix `/api`)

- **Auth:** `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- **Admin:** `GET /admin/users`, `PATCH /admin/users/{id}`, `GET /admin/documents?status=`, `PATCH /admin/documents/{id}/verify`
- **Vehicles:** `GET/POST /vehicles`, `PATCH/DELETE /vehicles/{id}` (delete = soft)
- **Documents:** `GET/POST /documents`
- **Places:** `GET/POST /places`, `DELETE /places/{id}`
- **Rides:** `POST /rides` (gated on verified licence + active vehicle), `GET /rides/search`,
  `GET /rides/mine`, `GET /rides/{id}`, `POST /rides/{id}/start|complete|cancel`,
  `POST/GET /rides/{id}/locations`, `GET/POST /rides/{id}/messages`
- **Bookings:** `POST /bookings`, `GET /bookings/mine`, `POST /bookings/{id}/cancel`
- **Wallet:** `GET /wallet`, `POST /wallet/recharge`
- **Payments:** `POST /payments`
- **Reports:** `GET /reports/summary`

## Notes

- Ride matching uses a Python **haversine** distance with a **bounding-box pre-filter**
  (`app/utils.py`) — no PostGIS, so it runs on SQLite. Default match radius is ~5 km
  for both origin and destination, within the same organization.
- UUID primary keys are portable `String(36)` values (work on SQLite and Postgres).
- Wallet recharge and card/UPI payments are simulated as successful (test-mode gateway).
- `TestClient`-based smoke tests need `httpx` (`pip install httpx`); it is not required to run the server.
