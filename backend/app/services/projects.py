from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, aliased
from sqlalchemy.sql.functions import FunctionElement

from app.models import Group, Project, ProjectStatusReport, utc_now
from app.services.tags import delete_unused_tags, detach_project_tags

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


def effective_group(db: Session, project: Project) -> Group | None:
    root = get_root(db, project)
    if root.group_id is None:
        return None
    return db.get(Group, root.group_id)


def effective_group_name(db: Session, project: Project) -> str | None:
    group = effective_group(db, project)
    return group.name if group else None


def touch_project(db: Session, project: Project) -> None:
    now = utc_now()
    project.updated_at = now
    root_id = project.root_project_id
    if root_id is not None and root_id != project.id:
        root = db.get(Project, root_id)
        if root is not None:
            root.updated_at = now


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def last_activity_at(db: Session, project: Project, children: list[Project] | None = None) -> datetime:
    if children is None:
        children = list(db.scalars(select(Project).where(Project.parent_id == project.id)).all())
    ids = [project.id, *[child.id for child in children]]
    stamps = [project.updated_at, *[child.updated_at for child in children]]
    report_at = db.scalar(
        select(func.max(ProjectStatusReport.updated_at)).where(
            ProjectStatusReport.project_id.in_(ids)
        )
    )
    if report_at is not None:
        stamps.append(report_at)
    return max(_as_utc(stamp) for stamp in stamps)


class _ScalarMax(FunctionElement):
    inherit_cache = True
    name = "scalar_max"


@compiles(_ScalarMax)
def _compile_scalar_max(element, compiler, **kwargs):
    args = ", ".join(compiler.process(arg, **kwargs) for arg in element.clauses)
    return f"max({args})"


@compiles(_ScalarMax, "mysql")
def _compile_scalar_max_mysql(element, compiler, **kwargs):
    args = ", ".join(compiler.process(arg, **kwargs) for arg in element.clauses)
    return f"greatest({args})"


def latest_activity_order():
    child = aliased(Project)
    child_for_reports = aliased(Project)
    report = aliased(ProjectStatusReport)
    child_updated = (
        select(func.max(child.updated_at))
        .where(child.parent_id == Project.id)
        .scalar_subquery()
    )
    family_ids = (
        select(child_for_reports.id)
        .where(
            or_(
                child_for_reports.id == Project.id,
                child_for_reports.parent_id == Project.id,
            )
        )
        .correlate(Project)
        .scalar_subquery()
    )
    report_updated = (
        select(func.max(report.updated_at))
        .where(report.project_id.in_(family_ids))
        .correlate(Project)
        .scalar_subquery()
    )
    return _ScalarMax(
        Project.updated_at,
        func.coalesce(child_updated, Project.updated_at),
        func.coalesce(report_updated, Project.updated_at),
    )


def move_sub_project(db: Session, project: Project, new_parent_id: int) -> None:
    if project.parent_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only a sub-project can be moved",
        )
    if new_parent_id == project.parent_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose a different project",
        )
    new_parent = validate_parent_for_new_sub(db, new_parent_id)
    old_parent = db.get(Project, project.parent_id)
    project.parent_id = new_parent.id
    project.root_project_id = new_parent.root_project_id or new_parent.id
    touch_project(db, project)
    touch_project(db, new_parent)
    if old_parent is not None:
        touch_project(db, old_parent)


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
    detach_project_tags(db, subtree_ids)
    for pid in reversed(subtree_ids):
        p = db.get(Project, pid)
        if p:
            db.delete(p)
    db.flush()
    delete_unused_tags(db)
    return old_group_id
