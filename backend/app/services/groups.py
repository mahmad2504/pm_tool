from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Group, Project


def normalize_group_name(name: str) -> str:
    return name.strip()


def optional_group_name(name: str | None) -> str | None:
    if name is None:
        return None
    trimmed = name.strip()
    return trimmed if trimmed else None


def assign_root_group(
    db: Session,
    project: Project,
    group_name: str | None,
    *,
    previous_group_id: int | None = None,
) -> None:
    prev = previous_group_id if previous_group_id is not None else project.group_id
    resolved = optional_group_name(group_name)
    if resolved is None:
        project.group_id = None
    else:
        project.group_id = resolve_group(db, resolved).id
    db.flush()
    maybe_delete_empty_group(db, prev)


def resolve_group(db: Session, group_name: str) -> Group:
    normalized = normalize_group_name(group_name)
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Group name cannot be blank",
        )
    existing = db.scalar(
        select(Group).where(func.lower(Group.name) == normalized.lower())
    )
    if existing:
        return existing
    group = Group(name=normalized)
    db.add(group)
    db.flush()
    return group


def count_roots_in_group(db: Session, group_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Project)
            .where(Project.parent_id.is_(None), Project.group_id == group_id)
        )
        or 0
    )


def maybe_delete_empty_group(db: Session, group_id: int | None) -> None:
    if group_id is None:
        return
    if count_roots_in_group(db, group_id) == 0:
        group = db.get(Group, group_id)
        if group:
            db.delete(group)
