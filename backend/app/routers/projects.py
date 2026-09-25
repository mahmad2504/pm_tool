from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from app.database import get_db
from app.models import Group, Project, ProjectResource, ProjectStatusReport, Resource, utc_now
from app.roles import ProjectLifecycle
from app.schemas.projects import (
    AssignedResourceRead,
    DuplicateResource,
    ProjectCreateRoot,
    ProjectCreateSub,
    ProjectDetail,
    ProjectExportRecord,
    ProjectExportSubProject,
    ProjectListResponse,
    ProjectMove,
    ProjectReportResponse,
    ReportAssignment,
    ReportGroup,
    ReportProject,
    ReportSharedResource,
    ReportSubProject,
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
    move_sub_project,
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
            select(func.count(func.distinct(ProjectResource.resource_id)))
            .select_from(ProjectResource)
            .where(ProjectResource.project_id.in_(project_ids))
        )
        or 0
    )


def _resource_counts(db: Session, project_ids: list[int]) -> dict[int, int]:
    counts = {project_id: 0 for project_id in project_ids}
    if not project_ids:
        return counts
    rows = db.execute(
        select(ProjectResource.project_id, func.count())
        .where(ProjectResource.project_id.in_(project_ids))
        .group_by(ProjectResource.project_id)
    ).all()
    for project_id, count in rows:
        counts[project_id] = int(count)
    return counts


def _shared_counts(
    db: Session, project_ids: list[int], shared_resource_ids: set[int]
) -> dict[int, int]:
    counts = {project_id: 0 for project_id in project_ids}
    if not project_ids or not shared_resource_ids:
        return counts
    rows = db.execute(
        select(ProjectResource.project_id, func.count())
        .where(
            ProjectResource.project_id.in_(project_ids),
            ProjectResource.resource_id.in_(shared_resource_ids),
        )
        .group_by(ProjectResource.project_id)
    ).all()
    for project_id, count in rows:
        counts[project_id] = int(count)
    return counts


def _sub_project_summaries(
    db: Session,
    children: list[Project],
    shared_resource_ids: set[int] | None = None,
) -> list[SubProjectSummary]:
    ordered = sorted(children, key=lambda child: (child.name.lower(), child.id))
    ids = [child.id for child in ordered]
    counts = _resource_counts(db, ids)
    shared = _shared_counts(db, ids, shared_resource_ids or set())
    return [
        SubProjectSummary(
            id=child.id,
            name=child.name,
            description=child.description,
            status=ProjectLifecycle(child.status),
            resource_count=counts[child.id],
            shared_count=shared[child.id],
        )
        for child in ordered
    ]


def _load_children(db: Session, project_id: int) -> list[Project]:
    return list(db.scalars(select(Project).where(Project.parent_id == project_id)).all())


def _duplicate_resources(
    db: Session, children_by_parent: dict[int, list[Project]]
) -> dict[int, list[DuplicateResource]]:
    """Resources assigned to more than one project in a root and its sub-projects."""
    result = {parent_id: [] for parent_id in children_by_parent}
    project_ids = [
        project_id
        for parent_id, children in children_by_parent.items()
        for project_id in (parent_id, *(child.id for child in children))
    ]
    if not project_ids:
        return result
    rows = db.execute(
        select(ProjectResource.project_id, ProjectResource.resource_id, Resource.name)
        .join(Resource, Resource.id == ProjectResource.resource_id)
        .where(ProjectResource.project_id.in_(project_ids))
    ).all()
    by_project: dict[int, dict[int, str]] = {}
    for project_id, resource_id, name in rows:
        by_project.setdefault(project_id, {})[resource_id] = name
    for parent_id, children in children_by_parent.items():
        occurrences: dict[int, str] = {}
        counts: dict[int, int] = {}
        for project_id in (parent_id, *(child.id for child in children)):
            for resource_id, name in by_project.get(project_id, {}).items():
                occurrences[resource_id] = name
                counts[resource_id] = counts.get(resource_id, 0) + 1
        result[parent_id] = [
            DuplicateResource(id=resource_id, name=occurrences[resource_id])
            for resource_id, count in counts.items()
            if count > 1
        ]
        result[parent_id].sort(key=lambda item: item.name.lower())
    return result


def _to_summary(
    db: Session,
    project: Project,
    children: list[Project] | None = None,
    duplicate_resources: list[DuplicateResource] | None = None,
) -> ProjectSummary:
    if children is None:
        children = _load_children(db, project.id)
    if duplicate_resources is None:
        duplicate_resources = _duplicate_resources(db, {project.id: children})[project.id]
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
        status=ProjectLifecycle(project.status),
        resource_count=rc,
        status_report_count=src,
        sub_project_count=len(children),
        sub_projects=_sub_project_summaries(
            db, children, {item.id for item in duplicate_resources}
        ),
        duplicate_resources=duplicate_resources,
        created_at=project.created_at,
        updated_at=last_activity_at(db, project, children),
    )


def _latest_status_bodies(db: Session, project_ids: list[int]) -> dict[int, str]:
    if not project_ids:
        return {}
    ranked = (
        select(
            ProjectStatusReport.project_id,
            ProjectStatusReport.body,
            func.row_number()
            .over(
                partition_by=ProjectStatusReport.project_id,
                order_by=(
                    ProjectStatusReport.created_at.desc(),
                    ProjectStatusReport.id.desc(),
                ),
            )
            .label("status_rank"),
        )
        .where(ProjectStatusReport.project_id.in_(project_ids))
        .subquery()
    )
    rows = db.execute(
        select(ranked.c.project_id, ranked.c.body).where(ranked.c.status_rank == 1)
    ).all()
    return {int(project_id): body for project_id, body in rows}


def _recent_reports(db: Session, project_id: int, limit: int) -> list[ProjectStatusReport]:
    return list(
        db.scalars(
            select(ProjectStatusReport)
            .where(ProjectStatusReport.project_id == project_id)
            .order_by(ProjectStatusReport.created_at.desc(), ProjectStatusReport.id.desc())
            .limit(limit)
        ).all()
    )


def _filtered_projects(
    q: str | None = None,
    group_id: int | None = None,
    parent_id: int | None = None,
    roots_only: bool = False,
):
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
    return stmt


def _export_record(db: Session, project: Project, reports: int) -> ProjectExportRecord:
    children = _load_children(db, project.id)
    group = effective_group(db, project)
    return ProjectExportRecord(
        id=project.id,
        name=project.name,
        description=project.description,
        group_id=group.id if group else None,
        group_name=group.name if group else None,
        status=ProjectLifecycle(project.status),
        created_at=project.created_at,
        updated_at=project.updated_at,
        resources=list_assigned_resources(db, project.id),
        status_report_count=_status_report_count(db, project.id),
        status_reports=[
            StatusReportRead.model_validate(report)
            for report in _recent_reports(db, project.id, reports)
        ],
        sub_projects=[
            ProjectExportSubProject(
                id=child.id,
                name=child.name,
                description=child.description,
                status=ProjectLifecycle(child.status),
                created_at=child.created_at,
                updated_at=child.updated_at,
                resources=list_assigned_resources(db, child.id),
                status_report_count=_status_report_count(db, child.id),
                status_reports=[
                    StatusReportRead.model_validate(report)
                    for report in _recent_reports(db, child.id, reports)
                ],
            )
            for child in sorted(children, key=lambda child: (child.name.lower(), child.id))
        ],
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
    stmt = _filtered_projects(
        q=q, group_id=group_id, parent_id=parent_id, roots_only=roots_only
    )

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
    duplicates = _duplicate_resources(db, children_by_parent)
    return ProjectListResponse(
        items=[
            _to_summary(
                db,
                p,
                children_by_parent.get(p.id, []),
                duplicates.get(p.id, []),
            )
            for p in items
        ],
        total=total,
    )


@router.get("/export")
def export_projects(
    db: DbSession,
    q: str | None = None,
    group_id: int | None = None,
    reports: int = Query(default=3, ge=0, le=100),
) -> Response:
    projects = db.scalars(
        _filtered_projects(q=q, group_id=group_id, roots_only=True).order_by(
            latest_activity_order().desc(), Project.id.desc()
        )
    ).all()
    lines = [
        _export_record(db, project, reports).model_dump_json() + "\n" for project in projects
    ]
    return Response(
        content="".join(lines),
        media_type="application/jsonl",
        headers={"Content-Disposition": 'attachment; filename="projects.jsonl"'},
    )


def _listed_people(
    member_ids: set[int],
    shown_project_ids: set[int] | None,
    people: dict[int, tuple[str, list[ReportAssignment]]],
    *,
    outside_home_ids: set[int] | None = None,
    other_group_name: str | None = None,
) -> list[ReportSharedResource]:
    listed: list[ReportSharedResource] = []
    for resource_id in member_ids:
        name, assignments = people[resource_id]
        if outside_home_ids is not None and all(
            item.project_id in outside_home_ids for item in assignments
        ):
            continue
        if other_group_name is not None and all(
            (item.group_name or "No group") == other_group_name for item in assignments
        ):
            continue
        shown = (
            assignments
            if shown_project_ids is None
            else [item for item in assignments if item.project_id in shown_project_ids]
        )
        listed.append(ReportSharedResource(id=resource_id, name=name, assignments=shown))
    listed.sort(key=lambda item: item.name.lower())
    return listed


@router.get("/report", response_model=ProjectReportResponse)
def project_report(
    db: DbSession,
    q: str | None = None,
    group_id: int | None = None,
) -> ProjectReportResponse:
    """Root projects for the current filter, with people who are also on another project."""
    roots = db.scalars(
        _filtered_projects(q=q, group_id=group_id, roots_only=True).order_by(
            latest_activity_order().desc(), Project.id.desc()
        )
    ).all()
    root_ids = [project.id for project in roots]
    children_by_parent: dict[int, list[Project]] = {project_id: [] for project_id in root_ids}
    if root_ids:
        for child in db.scalars(select(Project).where(Project.parent_id.in_(root_ids))).all():
            if child.parent_id is not None:
                children_by_parent.setdefault(child.parent_id, []).append(child)
    all_ids = [
        project_id
        for root_id, children in children_by_parent.items()
        for project_id in (root_id, *(child.id for child in children))
    ]
    members: dict[int, set[int]] = {project_id: set() for project_id in all_ids}
    people: dict[int, tuple[str, list[ReportAssignment]]] = {}
    if all_ids:
        resource_ids = list(
            db.scalars(
                select(ProjectResource.resource_id)
                .where(ProjectResource.project_id.in_(all_ids))
                .distinct()
            ).all()
        )
        if resource_ids:
            Parent = aliased(Project)
            RootProject = aliased(Project)
            rows = db.execute(
                select(
                    ProjectResource.resource_id,
                    Resource.name,
                    Project.id,
                    Project.name,
                    Parent.name,
                    Group.name,
                    ProjectResource.utilization_percent,
                )
                .join(Resource, Resource.id == ProjectResource.resource_id)
                .join(Project, Project.id == ProjectResource.project_id)
                .outerjoin(Parent, Parent.id == Project.parent_id)
                .outerjoin(RootProject, RootProject.id == Project.root_project_id)
                .outerjoin(Group, Group.id == RootProject.group_id)
                .where(ProjectResource.resource_id.in_(resource_ids))
                .order_by(func.lower(Project.name), Project.id)
            ).all()
            for (
                resource_id,
                resource_name,
                project_id,
                project_name,
                parent_name,
                assignment_group,
                utilization,
            ) in rows:
                assignment = ReportAssignment(
                    project_id=project_id,
                    project_name=project_name,
                    parent_name=parent_name,
                    group_name=assignment_group,
                    utilization_percent=int(utilization),
                )
                name, assignments = people.get(resource_id, (resource_name, []))
                assignments.append(assignment)
                people[resource_id] = (name, assignments)
                if project_id in members:
                    members[project_id].add(resource_id)
    latest_status = _latest_status_bodies(db, all_ids)
    items: list[tuple[tuple[int | None, str], set[int], ReportProject]] = []
    for root in roots:
        children = sorted(
            children_by_parent.get(root.id, []),
            key=lambda child: (child.name.lower(), child.id),
        )
        home_ids = {root.id, *(child.id for child in children)}
        member_ids = set().union(*(members.get(project_id, set()) for project_id in home_ids))
        group = effective_group(db, root)
        group_key = (group.id if group else None, group.name if group else "No group")
        items.append(
            (
                group_key,
                home_ids,
                ReportProject(
                id=root.id,
                name=root.name,
                description=root.description,
                group_name=group.name if group else None,
                status=ProjectLifecycle(root.status),
                latest_status=latest_status.get(root.id),
                resource_count=len(member_ids),
                resources=_listed_people(member_ids, home_ids, people),
                shared_resources=_listed_people(
                    member_ids, None, people, outside_home_ids=home_ids
                ),
                sub_projects=[
                    ReportSubProject(
                        id=child.id,
                        name=child.name,
                        description=child.description,
                        status=ProjectLifecycle(child.status),
                        latest_status=latest_status.get(child.id),
                        resource_count=len(members.get(child.id, set())),
                        resources=_listed_people(
                            members.get(child.id, set()), {child.id}, people
                        ),
                        shared_resources=_listed_people(
                            members.get(child.id, set()),
                            None,
                            people,
                            outside_home_ids={child.id},
                        ),
                    )
                    for child in children
                ],
            ),
            )
        )
    panels: dict[tuple[int | None, str], list[tuple[set[int], ReportProject]]] = {}
    for group_key, home_ids, project in items:
        panels.setdefault(group_key, []).append((home_ids, project))
    groups: list[ReportGroup] = []
    for group_id, group_name in sorted(panels, key=lambda key: key[1].lower()):
        entries = panels[(group_id, group_name)]
        home_ids = set().union(*(entry_ids for entry_ids, _project in entries))
        member_ids = set().union(*(members.get(project_id, set()) for project_id in home_ids))
        group_resources = _listed_people(member_ids, home_ids, people)
        groups.append(
            ReportGroup(
                id=group_id,
                name=group_name,
                project_count=len(entries),
                resource_count=len(group_resources),
                resources=group_resources,
                shared_with_other_groups=_listed_people(
                    member_ids, None, people, other_group_name=group_name
                ),
                projects=[project for _entry_ids, project in entries],
            )
        )
    return ProjectReportResponse(groups=groups)


@router.post("", response_model=ProjectSummary, status_code=status.HTTP_201_CREATED)
def create_root_project(
    payload: ProjectCreateRoot, db: DbSession, response: Response
) -> ProjectSummary:
    project = Project(
        name=payload.name,
        description=payload.description,
        parent_id=None,
        group_id=None,
        status=payload.status.value,
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
        status=payload.status.value,
    )
    db.add(project)
    db.flush()
    touch_project(db, parent)
    db.commit()
    db.refresh(project)
    response.headers["Location"] = f"/api/projects/{project.id}"
    return _to_summary(db, project)


@router.post("/{project_id}/move", response_model=ProjectSummary)
def move_project(project_id: int, payload: ProjectMove, db: DbSession) -> ProjectSummary:
    project = get_project_or_404(db, project_id)
    move_sub_project(db, project, payload.parent_id)
    db.commit()
    db.refresh(project)
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
        status=ProjectLifecycle(project.status),
        resources=assignments,
        sub_projects=_sub_project_summaries(db, list(children)),
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
    if "status" in data and data["status"] is not None:
        project.status = data["status"].value

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
        existing.project_role = payload.project_role.value
        existing.onboarded = payload.onboarded
        touch_project(db, project)
        db.commit()
        response.status_code = status.HTTP_200_OK
        return {"status": "updated"}

    db.add(
        ProjectResource(
            project_id=project.id,
            resource_id=resource.id,
            utilization_percent=payload.utilization_percent,
            project_role=payload.project_role.value,
            onboarded=payload.onboarded,
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
    if payload.utilization_percent is not None:
        link.utilization_percent = payload.utilization_percent
    if payload.project_role is not None:
        link.project_role = payload.project_role.value
    if payload.onboarded is not None:
        link.onboarded = payload.onboarded
    touch_project(db, project)
    db.commit()
    return AssignedResourceRead(
        resource=ResourceRead.model_validate(resource),
        utilization_percent=link.utilization_percent,
        project_role=link.project_role,
        onboarded=link.onboarded,
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
    if payload.created_at is not None:
        report.created_at = payload.created_at
        report.updated_at = payload.created_at
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
