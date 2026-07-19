"""Organization isolation helpers — prefer these over ad-hoc org checks."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import Ride, User


def same_org(a: User | None, b: User | None) -> bool:
    return bool(a and b and a.org_id == b.org_id)


def require_same_org_user(
    actor: User, other: User | None, *, not_found: str = "Not found"
) -> User:
    if not other or other.org_id != actor.org_id:
        raise HTTPException(status_code=404, detail=not_found)
    return other


def load_ride_same_org(db: Session, ride_id: str, actor: User) -> Ride:
    """Load ride only when actor shares org with the driver. Cross-org → 404."""
    ride = db.get(Ride, ride_id)
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    driver = db.get(User, ride.driver_id)
    if not driver or driver.org_id != actor.org_id:
        raise HTTPException(status_code=404, detail="Ride not found")
    return ride
