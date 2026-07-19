from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, engine
from . import models  # noqa: F401  (ensure models are registered before create_all)
from .schema_migrate import ensure_schema
from .routers import (
    auth,
    admin,
    vehicles,
    documents,
    places,
    rides,
    bookings,
    wallet,
    payment_methods,
    payments,
    ratings,
    reports,
    notifications,
    support,
    ws_chat,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_schema()
    yield


app = FastAPI(
    title="Enterprise Carpooling Platform API",
    version="1.0.0",
    lifespan=lifespan,
)

_cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins or ["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api"
for r in (
    auth,
    admin,
    vehicles,
    documents,
    places,
    rides,
    bookings,
    wallet,
    payment_methods,
    payments,
    ratings,
    reports,
    notifications,
    support,
):
    app.include_router(r.router, prefix=API_PREFIX)

# WebSocket chat: auth via first JSON message (not query-string token).
app.include_router(ws_chat.router, prefix=API_PREFIX)


@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok", "service": "carpool-api"}
