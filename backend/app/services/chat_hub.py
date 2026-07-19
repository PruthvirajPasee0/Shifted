"""In-memory WebSocket hub for personal (1:1) ride chat."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket


def thread_key(ride_id: str, user_a: str, user_b: str) -> str:
    a, b = sorted((str(user_a), str(user_b)))
    return f"{ride_id}:{a}:{b}"


@dataclass(eq=False)
class _Client:
    ws: WebSocket
    user_id: str


class ChatHub:
    def __init__(self) -> None:
        self._rooms: dict[str, set[_Client]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, key: str, ws: WebSocket, user_id: str) -> None:
        """Register an already-accepted WebSocket into a thread room."""
        async with self._lock:
            # Drop stale sockets for the same user (refresh / reconnect).
            room = self._rooms[key]
            stale = [c for c in room if c.user_id == str(user_id)]
            for c in stale:
                room.discard(c)
            room.add(_Client(ws=ws, user_id=str(user_id)))

    async def disconnect(self, key: str, ws: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(key)
            if not room:
                return
            dead = [c for c in room if c.ws is ws]
            for c in dead:
                room.discard(c)
            if not room:
                self._rooms.pop(key, None)

    async def broadcast_message(self, payload: dict[str, Any]) -> None:
        """Push a new message to every connected client in the 1:1 thread."""
        ride_id = str(payload.get("ride_id", ""))
        sender_id = str(payload.get("sender_id", ""))
        receiver_id = str(payload.get("receiver_id", ""))
        if not ride_id or not sender_id or not receiver_id:
            return
        key = thread_key(ride_id, sender_id, receiver_id)
        async with self._lock:
            targets = list(self._rooms.get(key, ()))
        if not targets:
            return
        packet = {"type": "message", "data": payload}
        dead: list[WebSocket] = []
        for client in targets:
            try:
                await client.ws.send_json(packet)
            except Exception:
                dead.append(client.ws)
        for ws in dead:
            await self.disconnect(key, ws)

    def room_size(self, key: str) -> int:
        return len(self._rooms.get(key, ()))


chat_hub = ChatHub()
