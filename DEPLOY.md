# Shifted — Deploy checklist

## Required

| Variable | Where | Notes |
|----------|--------|--------|
| `JWT_SECRET` | `backend/.env` | Strong random secret; app refuses to start without it |
| `DATABASE_URL` | `backend/.env` | Use Postgres in production (`postgresql+psycopg://…`) |
| `CORS_ORIGINS` | `backend/.env` | Exact frontend origins, comma-separated |
| `FRONTEND_URL` | `backend/.env` | Used in email CTA links |
| `VITE_API_BASE_URL` | `frontend/.env` | Public API URL ending in `/api` |
| `VITE_GOOGLE_MAPS_API_KEY` | `frontend/.env` | Maps + places |

## Optional integrations

| Variable | Purpose |
|----------|---------|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Wallet recharge + UPI/card ride pay |
| `SMTP_*` / `EMAIL_ENABLED` | Transactional email |
| `SMS_ENABLED` / `SMS_PROVIDER_URL` / `SMS_API_KEY` | SMS alerts (stub; logs when off) |

## Before go-live

1. Do **not** use seed passwords (`Admin@123`, `Employee@123`) in production.
2. Serve document uploads from a durable volume (`backend/uploads/`).
3. Prefer HTTPS for both SPA and API; set cookie/CORS accordingly.
4. Restart API after schema changes so `ensure_schema()` runs (refund + chat columns).
5. Brand is **Shifted** (product); **CARPOOL/OS** remains the suite label in UI chrome.
