from fastapi import APIRouter

from app.roles import roles_for_api
from app.schemas import RoleItem

router = APIRouter(prefix="/api", tags=["roles"])


@router.get("/roles", response_model=list[RoleItem])
def list_roles() -> list[dict[str, str]]:
    return roles_for_api()
