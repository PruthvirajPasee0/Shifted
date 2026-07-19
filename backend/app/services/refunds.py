"""Refund orchestration for cancelled bookings / rides."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Booking,
    Payment,
    PaymentRefund,
    PaymentType,
    PayMethod,
    PayStatus,
    RefundSource,
    RefundStatus,
    Ride,
    RideStatus,
    Wallet,
    WalletTransaction,
    WtxnType,
)
from . import payment_gateway


@dataclass
class RefundResult:
    applied: bool
    status: RefundStatus
    amount: Decimal
    message: str
    refund_id: str | None = None


def _reason_category(reason: str | None) -> str:
    text = (reason or "cancel").strip().lower()
    if "driver" in text:
        return "driver_cancel"
    if "reject" in text:
        return "driver_reject"
    if "passenger" in text:
        return "passenger_cancel"
    return "cancel"


def _credit_wallet(
    db: Session, *, user_id: str, amount: Decimal, payment_id: str
) -> None:
    wallet = db.scalar(select(Wallet).where(Wallet.user_id == user_id).with_for_update())
    if not wallet:
        wallet = Wallet(user_id=user_id, balance=0)
        db.add(wallet)
        db.flush()
    new_balance = Decimal(str(wallet.balance)) + amount
    wallet.balance = new_balance
    db.add(
        WalletTransaction(
            wallet_id=wallet.id,
            type=WtxnType.credit,
            amount=amount,
            balance_after=new_balance,
            ref_payment_id=payment_id,
        )
    )


def _debit_wallet(
    db: Session, *, user_id: str, amount: Decimal, payment_id: str
) -> bool:
    wallet = db.scalar(select(Wallet).where(Wallet.user_id == user_id).with_for_update())
    if not wallet or Decimal(str(wallet.balance)) < amount:
        return False
    new_balance = Decimal(str(wallet.balance)) - amount
    wallet.balance = new_balance
    db.add(
        WalletTransaction(
            wallet_id=wallet.id,
            type=WtxnType.debit,
            amount=amount,
            balance_after=new_balance,
            ref_payment_id=payment_id,
        )
    )
    return True


def issue_refund(
    db: Session,
    booking: Booking,
    *,
    reason: str | None,
    actor_id: str | None,
    ride: Ride | None = None,
) -> RefundResult:
    """Refund a successful ride payment for a booking (idempotent).

    Policy (Phase 1):
    - Only when a success ride_payment exists.
    - Before ride completion: full refund for passenger/driver cancel.
    - After ride completion: no automatic refund.
    """
    ride = ride or db.get(Ride, booking.ride_id)
    if ride and ride.status == RideStatus.completed:
        return RefundResult(
            applied=False,
            status=RefundStatus.none,
            amount=Decimal("0"),
            message="No automatic refund after ride completion",
        )

    payment = db.scalar(
        select(Payment)
        .where(
            Payment.booking_id == booking.id,
            Payment.type == PaymentType.ride_payment,
            Payment.status == PayStatus.success,
        )
        .with_for_update()
    )
    if not payment:
        return RefundResult(
            applied=False,
            status=RefundStatus.none,
            amount=Decimal("0"),
            message="No successful payment to refund",
        )

    already = Decimal(str(payment.refunded_amount or 0))
    amount = Decimal(str(payment.amount)) - already
    if amount <= 0 or payment.refund_status == RefundStatus.success:
        return RefundResult(
            applied=False,
            status=RefundStatus.success,
            amount=Decimal("0"),
            message="Already refunded",
            refund_id=payment.refund_ref,
        )

    category = _reason_category(reason)
    existing_event = db.scalar(
        select(PaymentRefund).where(
            PaymentRefund.payment_id == payment.id,
            PaymentRefund.booking_id == booking.id,
            PaymentRefund.reason_category == category,
            PaymentRefund.status == RefundStatus.success,
        )
    )
    if existing_event:
        return RefundResult(
            applied=False,
            status=RefundStatus.success,
            amount=Decimal("0"),
            message="Already refunded",
            refund_id=existing_event.id,
        )

    source = (
        RefundSource.wallet
        if payment.method == PayMethod.wallet
        else RefundSource.gateway
        if payment.method in (PayMethod.card, PayMethod.upi)
        else RefundSource.manual
    )

    event = PaymentRefund(
        payment_id=payment.id,
        booking_id=booking.id,
        amount=amount,
        reason=reason,
        reason_category=category,
        source=source,
        status=RefundStatus.pending,
        actor_id=actor_id,
    )
    db.add(event)
    db.flush()

    if payment.method == PayMethod.wallet:
        _credit_wallet(db, user_id=payment.payer_id, amount=amount, payment_id=payment.id)
        if payment.payee_id:
            # Best-effort clawback of driver credit; ledger stays consistent if short.
            _debit_wallet(
                db, user_id=payment.payee_id, amount=amount, payment_id=payment.id
            )
        event.status = RefundStatus.success
        payment.refund_status = RefundStatus.success
        payment.refunded_amount = already + amount
        payment.refund_ref = event.id
        return RefundResult(
            applied=True,
            status=RefundStatus.success,
            amount=amount,
            message="Wallet refund applied",
            refund_id=event.id,
        )

    if payment.method in (PayMethod.card, PayMethod.upi) and payment.gateway_ref:
        client = payment_gateway.get_client()
        if client is None:
            event.status = RefundStatus.failed
            payment.refund_status = RefundStatus.failed
            return RefundResult(
                applied=False,
                status=RefundStatus.failed,
                amount=amount,
                message="Razorpay not configured for refund",
                refund_id=event.id,
            )
        try:
            amount_paise = int((amount * 100).to_integral_value())
            rp = client.payment.refund(
                payment.gateway_ref, {"amount": amount_paise}
            )
            event.gateway_ref = str(rp.get("id") or "")
            event.status = RefundStatus.success
            payment.refund_status = RefundStatus.success
            payment.refunded_amount = already + amount
            payment.refund_ref = event.gateway_ref or event.id
            return RefundResult(
                applied=True,
                status=RefundStatus.success,
                amount=amount,
                message="Gateway refund initiated",
                refund_id=event.id,
            )
        except Exception as exc:  # noqa: BLE001 — persist failure state
            event.status = RefundStatus.failed
            payment.refund_status = RefundStatus.failed
            event.reason = f"{reason or ''} | gateway error: {exc}"[:500]
            return RefundResult(
                applied=False,
                status=RefundStatus.failed,
                amount=amount,
                message="Gateway refund failed",
                refund_id=event.id,
            )

    # Cash / offline — mark manual; no wallet movement.
    event.status = RefundStatus.success
    event.source = RefundSource.manual
    payment.refund_status = RefundStatus.success
    payment.refunded_amount = already + amount
    payment.refund_ref = event.id
    return RefundResult(
        applied=True,
        status=RefundStatus.success,
        amount=amount,
        message="Marked for offline/manual refund",
        refund_id=event.id,
    )


def refund_booking_if_paid(
    db: Session,
    booking: Booking,
    *,
    reason: str | None,
    actor_id: str | None,
    ride: Ride | None = None,
) -> RefundResult:
    return issue_refund(db, booking, reason=reason, actor_id=actor_id, ride=ride)
