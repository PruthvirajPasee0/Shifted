from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database import get_db
from .security import decode_access_token
from .models import User, UserStatus, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=True)

_CREDENTIALS_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_access_token(token)
    if not payload:
        raise _CREDENTIALS_EXC
    user_id = payload.get("sub")
    if not user_id:
        raise _CREDENTIALS_EXC
    user = db.get(User, user_id)
    if not user:
        raise _CREDENTIALS_EXC
    return user


def get_current_active_user(user: User = Depends(get_current_user)) -> User:
    if user.status != UserStatus.active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User account is {user.status.value}",
        )
    return user


def require_admin(user: User = Depends(get_current_active_user)) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return user
