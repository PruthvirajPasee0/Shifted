"""Razorpay gateway wrapper.

Thin helper around the Razorpay SDK. Returns None when Razorpay isn't
configured so callers can fall back to the simulated flow for local dev.
"""
from __future__ import annotations

import razorpay

from ..config import settings

_client: razorpay.Client | None = None


def get_client() -> razorpay.Client | None:
    global _client
    if not settings.razorpay_configured:
        return None
    if _client is None:
        _client = razorpay.Client(
            auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET)
        )
    return _client


def verify_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """Verify the Razorpay checkout signature. Returns False on any mismatch."""
    client = get_client()
    if client is None:
        return False
    try:
        client.utility.verify_payment_signature(
            {
                "razorpay_order_id": order_id,
                "razorpay_payment_id": payment_id,
                "razorpay_signature": signature,
            }
        )
        return True
    except razorpay.errors.SignatureVerificationError:
        return False
