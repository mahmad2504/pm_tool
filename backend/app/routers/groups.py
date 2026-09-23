from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Group, Project
from app.schemas.projects import GroupRead

router = APIRouter(prefix="/api/groups", tags=["groups"])

DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=list[GroupRead])
def list_groups(db: DbSession) -> list[GroupRead]:
    groups = db.scalars(select(Group).order_by(Group.name)).all()
    result: list[GroupRead] = []
    for group in groups:
        count = (
            db.scalar(
                select(func.count())
                .select_from(Project)
                .where(Project.parent_id.is_(None), Project.group_id == group.id)
            )
            or 0
        )
        result.append(GroupRead(id=group.id, name=group.name, project_count=count))
    return result
