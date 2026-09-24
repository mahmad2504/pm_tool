from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from app.database import get_db
from app.models import Group, Project, ProjectResource, ProjectStatusReport, Resource, utc_now
from app.schemas.projects import (
    AssignedResourceRead,
    ProjectCreateRoot,
    ProjectCreateSub,
    ProjectDetail,
    ProjectListResponse,
    ProjectPatch,
    ProjectResourceAttach,
    ProjectResourceUpdate,
    ProjectSummary,
    ProjectUpdateRoot,
    StatusReportCreate,
    StatusReportListResponse,
    StatusReportRead,
    StatusReportUpdate,
    SubProjectSummary,
)
from app.schemas.resources import ResourceRead
from app.services.assignments import list_assigned_resources
from app.services.group_icons import group_icon_url
from app.services.groups import assign_root_group, maybe_delete_empty_group
from app.services.projects import (
    delete_project_subtree,
    effective_group,
    get_project_or_404,
    get_root,
    last_activity_at,
    latest_activity_order,
    touch_project,
    validate_parent_for_new_sub,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])

DbSession = Annotated[Session, Depends(get_db)]


def _status_report_count(db: Session, project_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(ProjectStatusReport)
            .where(ProjectStatusReport.project_id == project_id)
        )
        or 0
    )


def _resource_count(db: Session, project_ids: list[int]) -> int:
    if not project_ids:
        return 0
    return (
        db.scalar(
            select(func.count())
            .select_from(ProjectResource)
            .where(ProjectResource.project_id.in_(project_ids))
        )
        or 0
    )


def _sub_project_summaries(children: list[Project]) -> list[SubProjectSummary]:
    ordered = sorted(children, key=lambda child: (child.name.lower(), child.id))
    return [
        SubProjectSummary(id=child.id, name=child.name, description=child.description)
        for child in ordered
    ]


def _load_children(db: Session, project_id: int) -> list[Project]:
    return list(db.scalars(select(Project).where(Project.parent_id == project_id)).all())


def _to_summary(
    db: Session, project: Project, children: list[Project] | None = None
) -> ProjectSummary:
    if children is None:
        children = _load_children(db, project.id)
    rc = _resource_count(db, [project.id, *[child.id for child in children]])
    src = _status_report_count(db, project.id)
    parent_name = None
    if project.parent_id is not None:
        parent = db.get(Project, project.parent_id)
        parent_name = parent.name if parent else None
    group = effective_group(db, project)
    return ProjectSummary(
        id=project.id,
        name=project.name,
        description=project.description,
        parent_id=project.parent_id,
        parent_name=parent_name,
        root_project_id=project.root_project_id or project.id,
        is_root=project.parent_id is None,
        group_name=group.name if group else None,
        group_id=group.id if group else None,
        group_icon_url=group_icon_url(group),
        resource_count=rc,
        status_report_count=src,
        sub_project_count=len(children),
        sub_projects=_sub_project_summaries(children),
        created_at=project.created_at,
        updated_at=last_activity_at(db, project, children),
    )


def _recent_reports(db: Session, project_id: int, limit: int) -> list[ProjectStatusReport]:
    return list(
        db.scalars(
            select(ProjectStatusReport)
            .where(ProjectStatusReport.project_id == project_id)
            .order_by(ProjectStatusReport.created_at.desc(), ProjectStatusReport.id.desc())
            .limit(limit)
        ).all()
    )


@router.get("", response_model=ProjectListResponse)
def list_projects(
    db: DbSession,
    q: str | None = None,
    group_id: int | None = None,
    parent_id: int | None = None,
    roots_only: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> ProjectListResponse:
    Root = aliased(Project)
    stmt = select(Project).join(Root, Project.root_project_id == Root.id)
    stmt = stmt.outerjoin(Group, Root.group_id == Group.id)

    filters = []
    if roots_only:
        filters.append(Project.parent_id.is_(None))
    if parent_id is not None:
        filters.append(Project.parent_id == parent_id)
    if group_id is not None:
        filters.append(Root.group_id == group_id)
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                Project.name.ilike(pattern),
                Project.description.ilike(pattern),
                Group.name.ilike(pattern),
            )
        )
    if filters:
        stmt = stmt.where(*filters)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.scalar(count_stmt) or 0
    items = db.scalars(
        stmt.order_by(latest_activity_order().desc(), Project.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    ids = [p.id for p in items]
    children_by_parent: dict[int, list[Project]] = {project_id: [] for project_id in ids}
    if ids:
        for child in db.scalars(select(Project).where(Project.parent_id.in_(ids))).all():
            if child.parent_id is not None:
                children_by_parent.setdefault(child.parent_id, []).append(child)
    return ProjectListResponse(
        items=[_to_summary(db, p, children_by_parent.get(p.id, [])) for p in items],
        total=total,
    )


@router.post("", response_model=ProjectSummary, status_code=status.HTTP_201_CREATED)
def create_root_project(
    payload: ProjectCreateRoot, db: DbSession, response: Response
) -> ProjectSummary:
    project = Project(
        name=payload.name,
        description=payload.description,
        parent_id=None,
        group_id=None,
    )
    db.add(project)
    db.flush()
    project.root_project_id = project.id
    assign_root_group(db, project, payload.group_name)
    db.commit()
    db.refresh(project)
    response.headers["Location"] = f"/api/projects/{project.id}"
    return _to_summary(db, project)


@router.post("/{project_id}/sub-projects", response_model=ProjectSummary, status_code=201)
def create_sub_project(
    project_id: int, payload: ProjectCreateSub, db: DbSession, response: Response
) -> ProjectSummary:
    parent = validate_parent_for_new_sub(db, project_id)
    project = Project(
        name=payload.name,
        description=payload.description,
        parent_id=parent.id,
        group_id=None,
        root_project_id=parent.root_project_id or parent.id,
    )
    db.add(project)
    db.flush()
    touch_project(db, parent)
    db.commit()
    db.refresh(project)
    response.headers["Location"] = f"/api/projects/{project.id}"
    return _to_summary(db, project)


@router.get("/{project_id}/status-reports", response_model=StatusReportListResponse)
def list_status_reports(
    project_id: int,
    db: DbSession,
    limit: int | None = Query(default=None, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> StatusReportListResponse:
    get_project_or_404(db, project_id)
    base = select(ProjectStatusReport).where(ProjectStatusReport.project_id == project_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    stmt = base.order_by(
        ProjectStatusReport.created_at.desc(), ProjectStatusReport.id.desc()
    ).offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    items = db.scalars(stmt).all()
    return StatusReportListResponse(
        items=[StatusReportRead.model_validate(i) for i in items],
        total=total,
    )


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(
    project_id: int,
    db: DbSession,
    recent_status_count: int | None = Query(default=None, ge=1, le=100),
) -> ProjectDetail:
    project = get_project_or_404(db, project_id)
    root = get_root(db, project)
    parent_name = None
    if project.parent_id is not None:
        parent = db.get(Project, project.parent_id)
        parent_name = parent.name if parent else None

    children = db.scalars(select(Project).where(Project.parent_id == project.id)).all()
    assignments = list_assigned_resources(db, project.id)
    group = effective_group(db, project)

    recent: list[ProjectStatusReport] = []
    if recent_status_count is not None:
        recent = _recent_reports(db, project.id, recent_status_count)

    return ProjectDetail(
        id=project.id,
        name=project.name,
        description=project.description,
        parent_id=project.parent_id,
        parent_name=parent_name,
        root_project_id=root.id,
        root_name=root.name,
        is_root=project.parent_id is None,
        group_name=group.name if group else None,
        group_icon_url=group_icon_url(group),
        resources=assignments,
        sub_projects=[
            SubProjectSummary(id=c.id, name=c.name, description=c.description) for c in children
        ],
        recent_status_reports=[StatusReportRead.model_validate(r) for r in recent],
        created_at=project.created_at,
        updated_at=last_activity_at(db, project, list(children)),
    )


@router.put("/{project_id}", response_model=ProjectSummary)
def update_project(project_id: int, payload: ProjectUpdateRoot, db: DbSession) -> ProjectSummary:
    project = get_project_or_404(db, project_id)
    if project.parent_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Sub-projects cannot have a group; update name and description only",
        )
    project.name = payload.name
    project.description = payload.description
    assign_root_group(db, project, payload.group_name)
    touch_project(db, project)
    db.commit()
    db.refresh(project)
    return _to_summary(db, project)


@router.patch("/{project_id}", response_model=ProjectSummary)
def patch_project(project_id: int, payload: ProjectPatch, db: DbSession) -> ProjectSummary:
    project = get_project_or_404(db, project_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        return _to_summary(db, project)

    if project.parent_id is not None and "group_name" in data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Sub-projects cannot be assigned to a group",
        )

    if "group_name" in data:
        assign_root_group(db, project, data["group_name"])
    if "name" in data and data["name"] is not None:
        project.name = data["name"]
    if "description" in data:
        project.description = data["description"]

    touch_project(db, project)
    db.commit()
    db.refresh(project)
    return _to_summary(db, project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: DbSession) -> None:
    project = get_project_or_404(db, project_id)
    if project.parent_id is not None:
        root = get_root(db, project)
        touch_project(db, root)
    old_group_id = delete_project_subtree(db, project)
    db.commit()
    maybe_delete_empty_group(db, old_group_id)
    db.commit()


@router.post("/{project_id}/resources", status_code=status.HTTP_201_CREATED)
def attach_resource(
    project_id: int, payload: ProjectResourceAttach, db: DbSession, response: Response
) -> dict[str, str]:
    project = get_project_or_404(db, project_id)
    resource = db.get(Resource, payload.resource_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found")

    existing = db.get(
        ProjectResource,
        {"project_id": project_id, "resource_id": payload.resource_id},
    )
    if existing:
        existing.utilization_percent = payload.utilization_percent
        touch_project(db, project)
        db.commit()
        response.status_code = status.HTTP_200_OK
        return {"status": "updated"}

    db.add(
        ProjectResource(
            project_id=project.id,
            resource_id=resource.id,
            utilization_percent=payload.utilization_percent,
        )
    )
    touch_project(db, project)
    db.commit()
    return {"status": "assigned"}


@router.patch("/{project_id}/resources/{resource_id}", response_model=AssignedResourceRead)
def update_project_resource(
    project_id: int,
    resource_id: int,
    payload: ProjectResourceUpdate,
    db: DbSession,
) -> AssignedResourceRead:
    project = get_project_or_404(db, project_id)
    link = db.get(ProjectResource, {"project_id": project_id, "resource_id": resource_id})
    if link is None:
        raise HTTPException(status_code=404, detail="Resource not assigned to this project")
    resource = db.get(Resource, resource_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    link.utilization_percent = payload.utilization_percent
    touch_project(db, project)
    db.commit()
    return AssignedResourceRead(
        resource=ResourceRead.model_validate(resource),
        utilization_percent=link.utilization_percent,
    )


@router.delete(
    "/{project_id}/resources/{resource_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def detach_resource(project_id: int, resource_id: int, db: DbSession) -> None:
    project = get_project_or_404(db, project_id)
    link = db.get(ProjectResource, {"project_id": project_id, "resource_id": resource_id})
    if link is None:
        raise HTTPException(status_code=404, detail="Resource not assigned to this project")
    db.delete(link)
    touch_project(db, project)
    db.commit()


@router.post(
    "/{project_id}/status-reports",
    response_model=StatusReportRead,
    status_code=status.HTTP_201_CREATED,
)
def create_status_report(
    project_id: int, payload: StatusReportCreate, db: DbSession
) -> ProjectStatusReport:
    project = get_project_or_404(db, project_id)
    report = ProjectStatusReport(project_id=project.id, body=payload.body)
    db.add(report)
    touch_project(db, project)
    db.commit()
    db.refresh(report)
    return report


@router.patch(
    "/{project_id}/status-reports/{report_id}",
    response_model=StatusReportRead,
)
def update_status_report(
    project_id: int,
    report_id: int,
    payload: StatusReportUpdate,
    db: DbSession,
) -> ProjectStatusReport:
    project = get_project_or_404(db, project_id)
    report = db.get(ProjectStatusReport, report_id)
    if report is None or report.project_id != project_id:
        raise HTTPException(status_code=404, detail="Status report not found")
    report.body = payload.body
    report.updated_at = utc_now()
    touch_project(db, project)
    db.commit()
    db.refresh(report)
    return report


@router.delete(
    "/{project_id}/status-reports/{report_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_status_report(project_id: int, report_id: int, db: DbSession) -> None:
    project = get_project_or_404(db, project_id)
    report = db.get(ProjectStatusReport, report_id)
    if report is None or report.project_id != project_id:
        raise HTTPException(status_code=404, detail="Status report not found")
    db.delete(report)
    touch_project(db, project)
    db.commit()
