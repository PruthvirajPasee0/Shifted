"""Optional SMS channel (Phase 3). No-ops unless SMS_* settings are set."""

from __future__ import annotations

import logging
import urllib.error
import urllib.request

from ..config import settings

logger = logging.getLogger("shifted.sms")


def send_sms(phone: str | int | None, body: str) -> bool:
    if not phone or not body:
        return False
    if not settings.sms_configured:
        logger.info("SMS skipped (unconfigured): to=%s body=%s", phone, body[:80])
        return False
    try:
        payload = f"to={phone}&message={urllib.request.quote(body)}".encode()
        req = urllib.request.Request(
            settings.SMS_PROVIDER_URL or "",
            data=payload,
            headers={"Authorization": f"Bearer {settings.SMS_API_KEY}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
            return 200 <= resp.status < 300
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        logger.warning("SMS send failed: %s", exc)
        return False
