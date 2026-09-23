from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Group, Project

def get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    return project


def get_root(db: Session, project: Project) -> Project:
    root = db.get(Project, project.root_project_id)
    if root is None:
        raise HTTPException(status_code=500, detail="Root project missing")
    return root


def effective_group_name(db: Session, project: Project) -> str | None:
    root = get_root(db, project)
    if root.group_id is None:
        return None
    group = db.get(Group, root.group_id)
    return group.name if group else None


def validate_parent_for_new_sub(db: Session, parent_id: int) -> Project:
    parent = get_project_or_404(db, parent_id)
    if parent.parent_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Sub-projects cannot have sub-projects; add under the root project",
        )
    return parent


def collect_subtree_ids(db: Session, root_id: int) -> list[int]:
    ids = [root_id]
    queue = [root_id]
    while queue:
        parent_id = queue.pop(0)
        children = db.scalars(
            select(Project.id).where(Project.parent_id == parent_id)
        ).all()
        for child_id in children:
            ids.append(child_id)
            queue.append(child_id)
    return ids


def delete_project_subtree(db: Session, project: Project) -> int | None:
    old_group_id: int | None = None
    if project.parent_id is None:
        old_group_id = project.group_id

    subtree_ids = collect_subtree_ids(db, project.id)
    for pid in reversed(subtree_ids):
        p = db.get(Project, pid)
        if p:
            db.delete(p)
    db.flush()
    return old_group_id
