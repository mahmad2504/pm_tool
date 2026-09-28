from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.projects import TagRead
from app.services.tags import list_tags_with_counts

router = APIRouter(prefix="/api/tags", tags=["tags"])

DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=list[TagRead])
def list_tags(db: DbSession) -> list[TagRead]:
    return [
        TagRead(id=tag_id, name=name, project_count=project_count)
        for tag_id, name, project_count in list_tags_with_counts(db)
    ]
