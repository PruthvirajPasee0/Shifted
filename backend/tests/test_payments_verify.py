from decimal import Decimal

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Booking, BookingStatus, PayStatus, PaymentType, Wallet, WalletTransaction
from app.routers.payments import verify_ride_payment
from app.schemas import RidePaymentVerifyRequest
from app.services import payment_gateway


class _FakeOrderApi:
    def __init__(self, order: dict):
        self._order = order

    def fetch(self, order_id: str) -> dict:
        return self._order


class _FakePaymentApi:
    def __init__(self, payment: dict):
        self._payment = payment

    def fetch(self, payment_id: str) -> dict:
        return self._payment


class _FakeRazorpayClient:
    def __init__(self, order: dict, payment: dict):
        self.order = _FakeOrderApi(order)
        self.payment = _FakePaymentApi(payment)


def _verify_payload() -> RidePaymentVerifyRequest:
    return RidePaymentVerifyRequest(
        razorpay_order_id="order_test_1",
        razorpay_payment_id="pay_test_1",
        razorpay_signature="sig_test_1",
    )


def test_verify_rejects_order_amount_mismatch(
    db_session: Session, payment_fixture: dict[str, object], monkeypatch: pytest.MonkeyPatch
):
    booking = payment_fixture["booking"]
    passenger = payment_fixture["passenger"]
    wrong_amount_paise = 5000
    order = {
        "id": "order_test_1",
        "amount": wrong_amount_paise,
        "currency": "INR",
        "status": "paid",
        "notes": {
            "booking_id": booking.id,
            "user_id": passenger.id,
            "method": "upi",
        },
    }
    payment = {
        "id": "pay_test_1",
        "order_id": "order_test_1",
        "status": "captured",
        "amount": wrong_amount_paise,
        "currency": "INR",
        "amount_refunded": 0,
        "method": "upi",
    }
    client = _FakeRazorpayClient(order=order, payment=payment)
    monkeypatch.setattr(payment_gateway, "get_client", lambda: client)
    monkeypatch.setattr(payment_gateway, "verify_signature", lambda *_args, **_kwargs: True)

    with pytest.raises(HTTPException) as exc:
        verify_ride_payment(_verify_payload(), BackgroundTasks(), db_session, passenger)

    assert exc.value.status_code == 400
    assert "order amount mismatch" in str(exc.value.detail).lower()


def test_verify_rejects_gateway_method_mismatch(
    db_session: Session, payment_fixture: dict[str, object], monkeypatch: pytest.MonkeyPatch
):
    booking = payment_fixture["booking"]
    passenger = payment_fixture["passenger"]
    amount_paise = 10_000
    order = {
        "id": "order_test_1",
        "amount": amount_paise,
        "currency": "INR",
        "status": "paid",
        "notes": {
            "booking_id": booking.id,
            "user_id": passenger.id,
            "method": "upi",
        },
    }
    payment = {
        "id": "pay_test_1",
        "order_id": "order_test_1",
        "status": "captured",
        "amount": amount_paise,
        "currency": "INR",
        "amount_refunded": 0,
        "method": "card",
    }
    client = _FakeRazorpayClient(order=order, payment=payment)
    monkeypatch.setattr(payment_gateway, "get_client", lambda: client)
    monkeypatch.setattr(payment_gateway, "verify_signature", lambda *_args, **_kwargs: True)

    with pytest.raises(HTTPException) as exc:
        verify_ride_payment(_verify_payload(), BackgroundTasks(), db_session, passenger)

    assert exc.value.status_code == 400
    assert "method mismatch" in str(exc.value.detail).lower()


def test_verify_success_marks_booking_paid_and_credits_driver_wallet(
    db_session: Session, payment_fixture: dict[str, object], monkeypatch: pytest.MonkeyPatch
):
    booking = payment_fixture["booking"]
    passenger = payment_fixture["passenger"]
    driver = payment_fixture["driver"]
    amount_paise = 10_000
    order = {
        "id": "order_test_1",
        "amount": amount_paise,
        "currency": "INR",
        "status": "paid",
        "notes": {
            "booking_id": booking.id,
            "user_id": passenger.id,
            "method": "upi",
        },
    }
    payment = {
        "id": "pay_test_1",
        "order_id": "order_test_1",
        "status": "captured",
        "amount": amount_paise,
        "currency": "INR",
        "amount_refunded": 0,
        "method": "upi",
    }
    client = _FakeRazorpayClient(order=order, payment=payment)
    monkeypatch.setattr(payment_gateway, "get_client", lambda: client)
    monkeypatch.setattr(payment_gateway, "verify_signature", lambda *_args, **_kwargs: True)

    paid = verify_ride_payment(_verify_payload(), BackgroundTasks(), db_session, passenger)

    assert paid.status == PayStatus.success
    assert paid.type == PaymentType.ride_payment
    assert paid.gateway_ref == "pay_test_1"
    assert Decimal(str(paid.amount)) == Decimal("100")

    booking_row = db_session.get(Booking, booking.id)
    assert booking_row is not None
    assert booking_row.status == BookingStatus.completed

    wallet = db_session.scalar(select(Wallet).where(Wallet.user_id == driver.id))
    assert wallet is not None
    assert Decimal(str(wallet.balance)) == Decimal("100")

    wtxns = db_session.scalars(
        select(WalletTransaction).where(WalletTransaction.wallet_id == wallet.id)
    ).all()
    assert len(wtxns) == 1
    assert Decimal(str(wtxns[0].amount)) == Decimal("100")
