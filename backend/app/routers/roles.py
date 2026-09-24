from fastapi import APIRouter

from app.roles import project_roles_for_api, roles_for_api
from app.schemas import RoleItem

router = APIRouter(prefix="/api", tags=["roles"])


@router.get("/roles", response_model=list[RoleItem])
def list_roles() -> list[dict[str, str]]:
    return roles_for_api()


@router.get("/project-roles", response_model=list[RoleItem])
def list_project_roles() -> list[dict[str, str]]:
    return project_roles_for_api()
