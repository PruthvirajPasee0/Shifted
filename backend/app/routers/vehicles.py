from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_active_user
from ..models import User, Vehicle
from ..schemas import VehicleCreate, VehicleUpdate, VehicleOut

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("", response_model=list[VehicleOut])
def list_my_vehicles(db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    return db.scalars(select(Vehicle).where(Vehicle.owner_id == user.id)).all()


@router.post("", response_model=VehicleOut, status_code=201)
def create_vehicle(
    payload: VehicleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    if db.scalar(select(Vehicle).where(Vehicle.reg_number == payload.reg_number)):
        raise HTTPException(status_code=400, detail="reg_number already exists")
    vehicle = Vehicle(owner_id=user.id, **payload.model_dump())
    db.add(vehicle)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="reg_number already exists")
    db.refresh(vehicle)
    return vehicle


@router.patch("/{vehicle_id}", response_model=VehicleOut)
def update_vehicle(
    vehicle_id: str,
    payload: VehicleUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle or vehicle.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(vehicle, k, v)
    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.delete("/{vehicle_id}", status_code=200)
def delete_vehicle(
    vehicle_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle or vehicle.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    vehicle.is_active = False
    db.commit()
    return {"ok": True, "id": vehicle_id, "is_active": False}
