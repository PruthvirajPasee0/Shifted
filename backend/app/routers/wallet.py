import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_active_user
from ..models import (
    User,
    Wallet,
    WalletTransaction,
    Payment,
    WtxnType,
    PayMethod,
    PaymentType,
    PayStatus,
)
from ..schemas import (
    WalletOut,
    WalletTxnOut,
    RechargeRequest,
    RechargeOrderRequest,
    RechargeOrderOut,
    RechargeVerifyRequest,
)
from ..services import payment_gateway

router = APIRouter(prefix="/wallet", tags=["wallet"])


def _get_or_create_wallet(db: Session, user_id: str) -> Wallet:
    wallet = db.scalar(select(Wallet).where(Wallet.user_id == user_id))
    if not wallet:
        wallet = Wallet(user_id=user_id, balance=0)
        db.add(wallet)
        db.flush()
    return wallet


def _wallet_out(db: Session, wallet: Wallet) -> WalletOut:
    txns = db.scalars(
        select(WalletTransaction)
        .where(WalletTransaction.wallet_id == wallet.id)
        .order_by(WalletTransaction.created_at.desc())
    ).all()
    return WalletOut(
        id=wallet.id,
        balance=Decimal(str(wallet.balance)),
        transactions=[WalletTxnOut.model_validate(t) for t in txns],
    )


def _credit_recharge(db: Session, wallet: Wallet, amount: Decimal, gateway_ref: str) -> None:
    """Record a successful wallet recharge: payment row + credit transaction."""
    payment = Payment(
        payer_id=wallet.user_id,
        type=PaymentType.wallet_recharge,
        amount=amount,
        method=PayMethod.upi,
        status=PayStatus.success,
        gateway_ref=gateway_ref,
    )
    db.add(payment)
    db.flush()

    new_balance = Decimal(str(wallet.balance)) + amount
    wallet.balance = new_balance
    db.add(
        WalletTransaction(
            wallet_id=wallet.id,
            type=WtxnType.recharge,
            amount=amount,
            balance_after=new_balance,
            ref_payment_id=payment.id,
        )
    )


@router.get("", response_model=WalletOut)
def get_wallet(db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    wallet = _get_or_create_wallet(db, user.id)
    db.commit()
    return _wallet_out(db, wallet)


@router.post("/recharge/order", response_model=RechargeOrderOut)
def create_recharge_order(
    payload: RechargeOrderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Create a Razorpay order the frontend Checkout will open."""
    client = payment_gateway.get_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Razorpay is not configured")

    amount_paise = int((Decimal(str(payload.amount)) * 100).to_integral_value())
    if amount_paise < 100:
        raise HTTPException(status_code=400, detail="Minimum recharge is ₹1")

    order = client.order.create(
        {
            "amount": amount_paise,
            "currency": "INR",
            "payment_capture": 1,
            "notes": {"user_id": user.id, "purpose": "wallet_recharge"},
        }
    )
    return RechargeOrderOut(
        order_id=order["id"],
        amount=amount_paise,
        currency="INR",
        key_id=settings.RAZORPAY_KEY_ID,
    )


@router.post("/recharge/verify", response_model=WalletOut)
def verify_recharge(
    payload: RechargeVerifyRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Verify the Razorpay signature, then credit the wallet.

    The amount is read back from Razorpay (the authoritative order record),
    never trusted from the client, so a tampered amount can't inflate a wallet.
    """
    client = payment_gateway.get_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Razorpay is not configured")

    if not payment_gateway.verify_signature(
        payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature
    ):
        raise HTTPException(status_code=400, detail="Payment signature verification failed")

    # Guard against a replayed payment crediting twice.
    already = db.scalar(
        select(Payment).where(Payment.gateway_ref == payload.razorpay_payment_id)
    )
    if already:
        # Replay must still belong to the original payer.
        if already.payer_id != user.id:
            raise HTTPException(status_code=403, detail="Payment belongs to another user")
        wallet = _get_or_create_wallet(db, user.id)
        db.commit()
        return _wallet_out(db, wallet)

    order = client.order.fetch(payload.razorpay_order_id)
    notes = order.get("notes") or {}
    order_user_id = str(notes.get("user_id") or "")
    if order_user_id != str(user.id):
        raise HTTPException(status_code=403, detail="Order does not belong to this user")

    order_status = str(order.get("status") or "").lower()
    if order_status not in ("paid", "attempted", "created"):
        raise HTTPException(status_code=400, detail=f"Order is not payable (status={order_status})")

    amount = (Decimal(str(order["amount"])) / 100).quantize(Decimal("0.01"))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid order amount")

    wallet = _get_or_create_wallet(db, user.id)
    _credit_recharge(db, wallet, amount, gateway_ref=payload.razorpay_payment_id)
    db.commit()
    return _wallet_out(db, wallet)


@router.post("/recharge", response_model=WalletOut)
def recharge(
    payload: RechargeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """Simulated recharge — fallback used only when Razorpay isn't configured.

    With Razorpay configured, the frontend uses /recharge/order + /recharge/verify
    instead so real (test-mode) payments flow through the gateway.
    """
    if settings.razorpay_configured:
        raise HTTPException(
            status_code=400,
            detail="Use /wallet/recharge/order then /wallet/recharge/verify (Razorpay is enabled)",
        )
    wallet = _get_or_create_wallet(db, user.id)
    _credit_recharge(db, wallet, Decimal(str(payload.amount)), gateway_ref=f"sim_{uuid.uuid4().hex[:16]}")
    db.commit()
    return _wallet_out(db, wallet)
