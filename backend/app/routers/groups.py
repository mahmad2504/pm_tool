from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Group
from app.schemas.projects import GroupRead, GroupUpdate
from app.services.group_icons import MEDIA_TYPES, group_icon_url, icon_file_path, save_group_icon
from app.services.groups import count_roots_in_group

router = APIRouter(prefix="/api/groups", tags=["groups"])

DbSession = Annotated[Session, Depends(get_db)]


def _to_group_read(db: Session, group: Group) -> GroupRead:
    return GroupRead(
        id=group.id,
        name=group.name,
        project_count=count_roots_in_group(db, group.id),
        icon_url=group_icon_url(group),
    )


def _get_group_or_404(db: Session, group_id: int) -> Group:
    group = db.get(Group, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group


@router.get("", response_model=list[GroupRead])
def list_groups(db: DbSession) -> list[GroupRead]:
    groups = db.scalars(select(Group).order_by(Group.name)).all()
    return [_to_group_read(db, group) for group in groups]


@router.get("/{group_id}/icon")
def get_group_icon(group_id: int, db: DbSession) -> FileResponse:
    group = _get_group_or_404(db, group_id)
    if not group.icon_filename:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group icon not found")
    path = icon_file_path(group.icon_filename)
    media_type = MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type)


@router.patch("/{group_id}", response_model=GroupRead)
def update_group(group_id: int, payload: GroupUpdate, db: DbSession) -> GroupRead:
    group = _get_group_or_404(db, group_id)
    taken = db.scalar(
        select(Group.id).where(func.lower(Group.name) == payload.name.lower(), Group.id != group.id)
    )
    if taken is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A group with that name already exists",
        )
    group.name = payload.name
    db.commit()
    db.refresh(group)
    return _to_group_read(db, group)


@router.post("/{group_id}/icon", response_model=GroupRead)
async def upload_group_icon(
    group_id: int, db: DbSession, file: UploadFile = File(...)
) -> GroupRead:
    group = _get_group_or_404(db, group_id)
    data = await file.read()
    save_group_icon(group, data, file.content_type)
    db.commit()
    db.refresh(group)
    return _to_group_read(db, group)
