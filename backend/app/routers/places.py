from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_active_user
from ..models import User, SavedPlace
from ..schemas import PlaceCreate, PlaceOut

router = APIRouter(prefix="/places", tags=["places"])


@router.get("", response_model=list[PlaceOut])
def list_places(db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    return db.scalars(select(SavedPlace).where(SavedPlace.user_id == user.id)).all()


@router.post("", response_model=PlaceOut, status_code=201)
def create_place(
    payload: PlaceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    place = SavedPlace(user_id=user.id, **payload.model_dump())
    db.add(place)
    db.commit()
    db.refresh(place)
    return place


@router.delete("/{place_id}", status_code=200)
def delete_place(
    place_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    place = db.get(SavedPlace, place_id)
    if not place or place.user_id != user.id:
        raise HTTPException(status_code=404, detail="Place not found")
    db.delete(place)
    db.commit()
    return {"ok": True, "id": place_id}
