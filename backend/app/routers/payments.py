import uuid
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_active_user
from ..models import (
    User,
    Booking,
    Ride,
    Payment,
    Wallet,
    WalletTransaction,
    BookingStatus,
    PaymentType,
    PayMethod,
    PayStatus,
    RideStatus,
    WtxnType,
)
from ..schemas import (
    PaymentCreate,
    PaymentOut,
    RidePaymentOrderOut,
    RidePaymentOrderRequest,
    RidePaymentVerifyRequest,
)
from .. import email_templates as tpl
from ..services import notifications as notify
from ..services import payment_gateway

router = APIRouter(prefix="/payments", tags=["payments"])

# Real in-app settlement = wallet. Cash stays pending until driver confirms.
# Card/UPI are not silently faked as success.
ALLOWED_PASSENGER_METHODS = {PayMethod.wallet, PayMethod.cash}
RAZORPAY_METHODS = {PayMethod.card, PayMethod.upi}
RAZORPAY_CURRENCY = "INR"


def _as_int(raw: object) -> int | None:
    try:
        return int(str(raw))
    except (TypeError, ValueError):
        return None


def _pay_method_from_gateway(raw: object, *, fallback: PayMethod = PayMethod.upi) -> PayMethod:
    """Map Razorpay method strings onto our PayMethod enum.

    Checkout lets the passenger pick UPI/card/etc. regardless of the label they
    tapped in-app — never reject a valid paid order for a method mismatch.
    """
    method = str(raw or "").strip().lower()
    if method in {"upi", "upi_collect", "upi_intent"}:
        return PayMethod.upi
    if method in {"card", "debit", "credit"}:
        return PayMethod.card
    return fallback


def _load_payable_booking(
    db: Session, booking_id: str, user: User, *, lock: bool = False
) -> tuple[Booking, Ride, Decimal]:
    stmt = select(Booking).where(Booking.id == booking_id)
    if lock:
        stmt = stmt.with_for_update()
    booking = db.scalar(stmt)
    if not booking or booking.passenger_id != user.id:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status in (BookingStatus.cancelled, BookingStatus.rejected):
        raise HTTPException(status_code=400, detail="Booking is not payable")
    if booking.status not in (BookingStatus.booked, BookingStatus.completed):
        raise HTTPException(status_code=400, detail="Booking is not payable")

    ride = db.get(Ride, booking.ride_id)
    if not ride or ride.status != RideStatus.completed:
        raise HTTPException(
            status_code=400,
            detail="Ride must be completed before payment",
        )
    amount = Decimal(str(booking.fare_amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid fare amount")
    return booking, ride, amount


def _existing_success(db: Session, booking_id: str) -> Payment | None:
    return db.scalar(
        select(Payment).where(
            Payment.booking_id == booking_id,
            Payment.status == PayStatus.success,
            Payment.type == PaymentType.ride_payment,
        )
    )


def _pending_payment(
    db: Session, booking_id: str, *, lock: bool = False
) -> Payment | None:
    stmt = select(Payment).where(
        Payment.booking_id == booking_id,
        Payment.type == PaymentType.ride_payment,
        Payment.status == PayStatus.pending,
    )
    if lock:
        stmt = stmt.with_for_update()
    return db.scalar(stmt)


def _upsert_pending_payment(
    db: Session,
    *,
    booking: Booking,
    ride: Ride,
    payer_id: str,
    method: PayMethod,
    amount: Decimal,
) -> Payment:
    payment = _pending_payment(db, booking.id, lock=True)
    if payment:
        payment.method = method
        payment.amount = amount
        payment.payee_id = ride.driver_id
        return payment
    payment = Payment(
        booking_id=booking.id,
        payer_id=payer_id,
        payee_id=ride.driver_id,
        type=PaymentType.ride_payment,
        amount=amount,
        method=method,
        status=PayStatus.pending,
        gateway_ref=None,
    )
    db.add(payment)
    db.flush()
    return payment


def _credit_driver_wallet(db: Session, *, driver_id: str, amount: Decimal, payment_id: str) -> None:
    wallet = db.scalar(select(Wallet).where(Wallet.user_id == driver_id).with_for_update())
    if not wallet:
        wallet = Wallet(user_id=driver_id, balance=0)
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


@router.get("/booking/{booking_id}", response_model=PaymentOut | None)
def payment_for_booking(
    booking_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    booking = db.get(Booking, booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    ride = db.get(Ride, booking.ride_id)
    if not ride:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.passenger_id != user.id and ride.driver_id != user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    return db.scalar(
        select(Payment)
        .where(
            Payment.booking_id == booking.id,
            Payment.type == PaymentType.ride_payment,
        )
        .order_by(Payment.created_at.desc())
    )


@router.post("", response_model=PaymentOut, status_code=201)
def pay_booking(
    payload: PaymentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    booking, ride, amount = _load_payable_booking(db, payload.booking_id, user, lock=True)
    if booking.status == BookingStatus.completed:
        raise HTTPException(status_code=400, detail="Booking already paid/completed")

    if payload.method not in ALLOWED_PASSENGER_METHODS:
        raise HTTPException(
            status_code=400,
            detail="Use /payments/order + /payments/verify for UPI/card checkout.",
        )

    # Idempotency: an existing successful payment for this booking wins.
    existing = _existing_success(db, booking.id)
    if existing:
        raise HTTPException(status_code=400, detail="Booking already paid/completed")

    payee_id = ride.driver_id
    payment = _upsert_pending_payment(
        db,
        booking=booking,
        ride=ride,
        payer_id=user.id,
        method=payload.method,
        amount=amount,
    )

    if payload.method == PayMethod.cash:
        # Passenger marks cash intent; driver must confirm receipt.
        db.commit()
        db.refresh(payment)
        return payment

    # Wallet: debit passenger, credit driver, finalize.
    wallet = db.scalar(
        select(Wallet).where(Wallet.user_id == user.id).with_for_update()
    )
    if not wallet or Decimal(str(wallet.balance)) < amount:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")
    new_balance = Decimal(str(wallet.balance)) - amount
    wallet.balance = new_balance
    db.add(
        WalletTransaction(
            wallet_id=wallet.id,
            type=WtxnType.debit,
            amount=amount,
            balance_after=new_balance,
            ref_payment_id=payment.id,
        )
    )
    _credit_driver_wallet(db, driver_id=payee_id, amount=amount, payment_id=payment.id)

    payment.status = PayStatus.success
    booking.status = BookingStatus.completed
    payment.gateway_ref = f"wallet_{uuid.uuid4().hex[:16]}"

    driver = db.get(User, payee_id)
    if driver:
        amount_str = f"₹{amount:.2f}"
        route = f"{ride.origin} → {ride.destination}"
        notify.push(
            db,
            driver,
            "payment_received",
            "Payment received",
            f"{user.name} paid you {amount_str} for {route} (wallet).",
            ref_id=ride.id,
            background_tasks=background_tasks,
            email=tpl.payment_received(
                driver_name=driver.name,
                payer_name=user.name,
                amount=amount_str,
                route=route,
            ),
        )

    db.commit()
    db.refresh(payment)
    return payment


@router.post("/order", response_model=RidePaymentOrderOut)
def create_ride_payment_order(
    payload: RidePaymentOrderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    if payload.method not in RAZORPAY_METHODS:
        raise HTTPException(status_code=400, detail="Only card or upi supported for gateway checkout")
    client = payment_gateway.get_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Razorpay is not configured")

    booking, ride, amount = _load_payable_booking(db, payload.booking_id, user, lock=True)
    if booking.status == BookingStatus.completed:
        raise HTTPException(status_code=400, detail="Booking already paid/completed")
    if _existing_success(db, booking.id):
        raise HTTPException(status_code=400, detail="Booking already paid/completed")

    payment = _upsert_pending_payment(
        db,
        booking=booking,
        ride=ride,
        payer_id=user.id,
        method=payload.method,
        amount=amount,
    )

    amount_paise = int((amount * 100).to_integral_value())
    order = client.order.create(
        {
            "amount": amount_paise,
            "currency": "INR",
            "payment_capture": 1,
            "notes": {
                "purpose": "ride_payment",
                "booking_id": booking.id,
                "user_id": user.id,
                "method": payload.method.value,
            },
        }
    )
    payment.gateway_ref = str(order["id"])
    db.commit()

    return RidePaymentOrderOut(
        order_id=order["id"],
        amount=amount_paise,
        currency="INR",
        key_id=settings.RAZORPAY_KEY_ID,
    )


@router.post("/verify", response_model=PaymentOut)
def verify_ride_payment(
    payload: RidePaymentVerifyRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    client = payment_gateway.get_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Razorpay is not configured")
    if not payment_gateway.verify_signature(
        payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature
    ):
        raise HTTPException(status_code=400, detail="Payment signature verification failed")

    replay = db.scalar(
        select(Payment).where(
            Payment.type == PaymentType.ride_payment,
            Payment.gateway_ref == payload.razorpay_payment_id,
            Payment.status == PayStatus.success,
        )
    )
    if replay:
        if replay.payer_id != user.id:
            raise HTTPException(status_code=403, detail="Payment belongs to another user")
        return replay

    order = client.order.fetch(payload.razorpay_order_id)
    if str(order.get("id") or "") != payload.razorpay_order_id:
        raise HTTPException(status_code=400, detail="Gateway order mismatch")
    notes = order.get("notes") or {}
    booking_id = str(notes.get("booking_id") or "")
    order_user_id = str(notes.get("user_id") or "")
    declared_s = str(notes.get("method") or "upi").lower()
    declared_method = PayMethod.upi if declared_s == "upi" else PayMethod.card
    if order_user_id != str(user.id):
        raise HTTPException(status_code=403, detail="Order does not belong to this user")
    if not booking_id:
        raise HTTPException(status_code=400, detail="Invalid order metadata")

    booking, ride, amount = _load_payable_booking(db, booking_id, user, lock=True)
    expected_amount_paise = int((amount * 100).to_integral_value())
    order_amount = _as_int(order.get("amount"))
    if order_amount != expected_amount_paise:
        raise HTTPException(status_code=400, detail="Gateway order amount mismatch")
    if str(order.get("currency") or "").upper() != RAZORPAY_CURRENCY:
        raise HTTPException(status_code=400, detail="Gateway order currency mismatch")

    order_status = str(order.get("status") or "").lower()
    rp_payment = client.payment.fetch(payload.razorpay_payment_id)
    if str(rp_payment.get("order_id") or "") != payload.razorpay_order_id:
        raise HTTPException(status_code=400, detail="Gateway payment-order mismatch")
    pay_status = str(rp_payment.get("status") or "").lower()
    # Auto-capture orders usually land as captured + order paid; accept either
    # successful gateway state so verify is not flaky in test mode.
    if pay_status not in {"captured", "authorized"} and order_status != "paid":
        raise HTTPException(
            status_code=400,
            detail=f"Gateway payment not successful (payment={pay_status}, order={order_status})",
        )
    if _as_int(rp_payment.get("amount")) != expected_amount_paise:
        raise HTTPException(status_code=400, detail="Gateway payment amount mismatch")
    if str(rp_payment.get("currency") or "").upper() != RAZORPAY_CURRENCY:
        raise HTTPException(status_code=400, detail="Gateway payment currency mismatch")
    if (_as_int(rp_payment.get("amount_refunded")) or 0) > 0:
        raise HTTPException(status_code=400, detail="Gateway payment already refunded")

    gateway_method = _pay_method_from_gateway(
        rp_payment.get("method") or declared_s, fallback=declared_method
    )

    existing = _existing_success(db, booking.id)
    if existing:
        return existing

    payment = _upsert_pending_payment(
        db,
        booking=booking,
        ride=ride,
        payer_id=user.id,
        method=gateway_method,
        amount=amount,
    )
    payment.status = PayStatus.success
    payment.gateway_ref = payload.razorpay_payment_id
    booking.status = BookingStatus.completed

    # Gateway settled externally; mirror receivable in driver's in-app wallet ledger.
    _credit_driver_wallet(db, driver_id=ride.driver_id, amount=amount, payment_id=payment.id)

    driver = db.get(User, ride.driver_id)
    if driver:
        amount_str = f"₹{amount:.2f}"
        route = f"{ride.origin} → {ride.destination}"
        notify.push(
            db,
            driver,
            "payment_received",
            "Payment received",
            f"{user.name} paid you {amount_str} for {route} ({gateway_method.value}).",
            ref_id=ride.id,
            background_tasks=background_tasks,
            email=tpl.payment_received(
                driver_name=driver.name,
                payer_name=user.name,
                amount=amount_str,
                route=route,
            ),
        )

    db.commit()
    db.refresh(payment)
    return payment


@router.post("/{payment_id}/confirm-cash", response_model=PaymentOut)
def confirm_cash(
    payment_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Driver confirms cash was received offline."""
    payment = db.scalar(
        select(Payment).where(Payment.id == payment_id).with_for_update()
    )
    if not payment or payment.type != PaymentType.ride_payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.payee_id != user.id:
        raise HTTPException(status_code=403, detail="Only the driver can confirm cash")
    if payment.method != PayMethod.cash:
        raise HTTPException(status_code=400, detail="Not a cash payment")
    if payment.status == PayStatus.success:
        return payment
    if payment.status != PayStatus.pending:
        raise HTTPException(status_code=400, detail=f"Cannot confirm {payment.status.value}")

    booking = db.get(Booking, payment.booking_id)
    if not booking or booking.status == BookingStatus.cancelled:
        raise HTTPException(status_code=400, detail="Booking unavailable")

    payment.status = PayStatus.success
    booking.status = BookingStatus.completed

    payer = db.get(User, payment.payer_id)
    ride = db.get(Ride, booking.ride_id) if booking else None
    if payer and ride:
        amount_str = f"₹{Decimal(str(payment.amount)):.2f}"
        route = f"{ride.origin} → {ride.destination}"
        notify.push(
            db,
            payer,
            "payment_confirmed",
            "Cash payment confirmed",
            f"Driver confirmed your cash payment of {amount_str} for {route}.",
            ref_id=ride.id,
            background_tasks=background_tasks,
        )

    db.commit()
    db.refresh(payment)
    return payment
