"""WebSocket endpoint for personal ride chat (realtime, no page reload)."""

import asyncio
import json

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Booking, BookingStatus, Ride, RideStatus, User, UserStatus
from ..security import decode_access_token
from ..services.chat_hub import chat_hub, thread_key

router = APIRouter(tags=["ws"])


def _user_from_token(token: str, db: Session) -> User | None:
    payload = decode_access_token(token)
    if not payload:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    user = db.get(User, user_id)
    if not user or user.status != UserStatus.active:
        return None
    return user


def _is_participant(ride: Ride, user: User, db: Session) -> bool:
    if ride.driver_id == user.id:
        return True
    booking = db.scalar(
        select(Booking).where(
            Booking.ride_id == ride.id,
            Booking.passenger_id == user.id,
            Booking.status != BookingStatus.cancelled,
        )
    )
    return booking is not None


def _token_from_headers(websocket: WebSocket) -> str | None:
    """Prefer Sec-WebSocket-Protocol: bearer.<jwt> over query string."""
    proto = websocket.headers.get("sec-websocket-protocol") or ""
    for part in proto.split(","):
        part = part.strip()
        if part.lower().startswith("bearer."):
            return part[7:]
    return None


@router.websocket("/ws/rides/{ride_id}/chat")
async def ride_chat_ws(
    websocket: WebSocket,
    ride_id: str,
    peer_id: str = Query(...),
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    # Accept once here — ChatHub must NOT call accept() again.
    requested = websocket.headers.get("sec-websocket-protocol")
    if requested and "bearer." in requested.lower():
        chosen = next(
            (p.strip() for p in requested.split(",") if "bearer." in p.lower()),
            None,
        )
        await websocket.accept(subprotocol=chosen)
    else:
        await websocket.accept()

    auth_token = _token_from_headers(websocket) or token
    if not auth_token:
        # First-message auth: {"type":"auth","token":"..."}
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=15.0)
            packet = json.loads(raw)
            if packet.get("type") == "auth" and packet.get("token"):
                auth_token = str(packet["token"])
        except Exception:
            auth_token = None

    user = _user_from_token(auth_token, db) if auth_token else None
    if user is None:
        await websocket.close(code=4401)
        return

    ride = db.get(Ride, ride_id)
    if not ride:
        await websocket.close(code=4404)
        return
    if ride.status == RideStatus.cancelled:
        await websocket.close(code=4403)
        return

    driver = db.get(User, ride.driver_id)
    if not driver or driver.org_id != user.org_id:
        await websocket.close(code=4404)
        return

    peer = db.get(User, peer_id)
    if (
        peer is None
        or not _is_participant(ride, user, db)
        or not _is_participant(ride, peer, db)
        or peer_id == user.id
    ):
        await websocket.close(code=4403)
        return

    key = thread_key(ride_id, user.id, peer_id)
    await chat_hub.connect(key, websocket, user_id=user.id)
    try:
        await websocket.send_json(
            {
                "type": "ready",
                "peer_id": peer_id,
                "user_id": user.id,
                "room": key,
            }
        )
        while True:
            # Keepalive / client pings. Messages travel REST → hub broadcast.
            raw = await websocket.receive_text()
            if raw in ("ping", '{"type":"ping"}'):
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await chat_hub.disconnect(key, websocket)
