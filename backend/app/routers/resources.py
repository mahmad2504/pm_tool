import csv
import io
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.database import get_db
from app.locations import ResourceLocation
from app.models import Project, ProjectResource, Resource, utc_now
from app.services.projects import get_project_or_404
from app.roles import ProjectLifecycle, ResourceRole, roles_for_api
from app.schemas import (
    CsvRowInput,
    ImportResult,
    ResourceCreate,
    ResourceListResponse,
    ResourcePatch,
    ResourceRead,
    ResourceUpdate,
    ResourceWithUtilization,
)
from app.services.resource_assignments import assignments_by_resource_ids, total_utilization

router = APIRouter(prefix="/api/resources", tags=["resources"])

DbSession = Annotated[Session, Depends(get_db)]

CSV_TEMPLATE = "name,role,email,notes,location\n"


def get_resource_or_404(db: Session, resource_id: int) -> Resource:
    resource = db.get(Resource, resource_id)
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
    return resource


def email_in_use(db: Session, email: str, exclude_id: int | None = None) -> bool:
    stmt = select(Resource.id).where(func.lower(Resource.email) == email.lower())
    if exclude_id is not None:
        stmt = stmt.where(Resource.id != exclude_id)
    return db.scalar(stmt) is not None


def resource_list_filters(
    db: Session,
    *,
    role: ResourceRole | None = None,
    location: ResourceLocation | None = None,
    q: str | None = None,
    project_id: int | None = None,
    over_utilized: bool = False,
) -> list:
    if project_id is not None:
        get_project_or_404(db, project_id)

    filters = []
    if role is not None:
        filters.append(Resource.role == role.value)
    if location is not None:
        filters.append(Resource.location == location.value)
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(or_(Resource.name.ilike(pattern), Resource.email.ilike(pattern)))
    if project_id is not None:
        assigned_ids = select(ProjectResource.resource_id).where(
            ProjectResource.project_id == project_id
        )
        filters.append(Resource.id.in_(assigned_ids))
    if over_utilized:
        Root = aliased(Project)
        over_ids = (
            select(ProjectResource.resource_id)
            .join(Project, ProjectResource.project_id == Project.id)
            .join(Root, Project.root_project_id == Root.id)
            .where(
                Project.status != ProjectLifecycle.completed.value,
                Root.status != ProjectLifecycle.completed.value,
            )
            .group_by(ProjectResource.resource_id)
            .having(func.sum(ProjectResource.utilization_percent) > 100)
        )
        filters.append(Resource.id.in_(over_ids))
    return filters


def apply_resource_fields(
    resource: Resource,
    *,
    name: str,
    role: ResourceRole,
    email: str,
    location: ResourceLocation | None,
    notes: str | None,
) -> None:
    resource.name = name
    resource.role = role.value
    resource.email = email
    resource.location = location.value if location is not None else None
    resource.notes = notes
    resource.updated_at = utc_now()


def with_utilization(db: Session, items: list[Resource]) -> list[ResourceWithUtilization]:
    assignment_map = assignments_by_resource_ids(db, [r.id for r in items])
    return [
        ResourceWithUtilization(
            **ResourceRead.model_validate(r).model_dump(),
            total_utilization_percent=total_utilization(assignment_map.get(r.id, [])),
            project_assignments=assignment_map.get(r.id, []),
        )
        for r in items
    ]


@router.get("", response_model=ResourceListResponse)
def list_resources(
    db: DbSession,
    role: ResourceRole | None = None,
    location: ResourceLocation | None = None,
    q: str | None = None,
    project_id: int | None = None,
    over_utilized: bool = False,
    sort: Literal["newest", "name"] = "newest",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> ResourceListResponse:
    filters = resource_list_filters(
        db,
        role=role,
        location=location,
        q=q,
        project_id=project_id,
        over_utilized=over_utilized,
    )

    count_stmt = select(func.count()).select_from(Resource)
    if sort == "name":
        order = (func.lower(Resource.name), Resource.id)
    else:
        order = (Resource.created_at.desc(), Resource.id.desc())
    list_stmt = select(Resource).order_by(*order)
    if filters:
        count_stmt = count_stmt.where(*filters)
        list_stmt = list_stmt.where(*filters)

    total = db.scalar(count_stmt) or 0
    items = db.scalars(list_stmt.offset(offset).limit(limit)).all()
    role_count_stmt = select(Resource.role, func.count()).group_by(Resource.role)
    if filters:
        role_count_stmt = role_count_stmt.where(*filters)
    role_counts = {
        role: int(count) for role, count in db.execute(role_count_stmt).all()
    }
    return ResourceListResponse(
        items=with_utilization(db, list(items)),
        total=total,
        role_counts=role_counts,
    )


@router.get("/report", response_model=ResourceListResponse)
def resource_report(
    db: DbSession,
    role: ResourceRole | None = None,
    location: ResourceLocation | None = None,
    q: str | None = None,
    project_id: int | None = None,
) -> ResourceListResponse:
    """Every person matching the directory filters, with utilization and assignments."""
    filters = resource_list_filters(
        db, role=role, location=location, q=q, project_id=project_id
    )
    stmt = select(Resource).order_by(func.lower(Resource.name), Resource.id)
    if filters:
        stmt = stmt.where(*filters)
    items = list(db.scalars(stmt).all())
    return ResourceListResponse(items=with_utilization(db, items), total=len(items))


@router.get("/export")
def export_resources(
    db: DbSession,
    role: ResourceRole | None = None,
    location: ResourceLocation | None = None,
    q: str | None = None,
    project_id: int | None = None,
) -> Response:
    """Name and email for every person matching the directory filters."""
    filters = resource_list_filters(
        db, role=role, location=location, q=q, project_id=project_id
    )
    stmt = select(Resource).order_by(Resource.created_at.desc(), Resource.id.desc())
    if filters:
        stmt = stmt.where(*filters)
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(["name", "email"])
    for resource in db.scalars(stmt).all():
        writer.writerow([resource.name, resource.email])
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="resources.csv"'},
    )


@router.get("/import/template", response_class=PlainTextResponse)
def download_import_template() -> PlainTextResponse:
    return PlainTextResponse(
        content=CSV_TEMPLATE,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="resources_template.csv"'},
    )


@router.post("/import", response_model=ImportResult)
async def import_resources(db: DbSession, file: UploadFile = File(...)) -> ImportResult:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is required")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be a CSV")

    raw = await file.read()
    if not raw.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file is empty")

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="CSV must be UTF-8 encoded"
        ) from exc

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV has no header row")

    expected = {"name", "role", "email", "notes"}
    headers = {h.strip().lower() for h in reader.fieldnames if h}
    if not expected.issubset(headers):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV must include columns: name, role, email, notes",
        )

    created = 0
    skipped = 0
    errors: list[dict[str, int | str]] = []
    seen_emails: set[str] = set()

    for row_num, row in enumerate(reader, start=2):
        normalized = {
            (key or "").strip().lower(): (value or "").strip()
            for key, value in row.items()
            if key
        }
        if not any(normalized.values()):
            continue

        name = normalized.get("name", "")
        role_raw = normalized.get("role", "")
        email = normalized.get("email", "")
        notes = normalized.get("notes", "")
        location_raw = normalized.get("location", "")

        try:
            parsed = CsvRowInput.from_csv_fields(name, role_raw, email, notes, location_raw)
        except Exception as exc:
            errors.append({"row": row_num, "detail": str(exc)})
            continue

        if parsed.email in seen_emails or email_in_use(db, parsed.email):
            skipped += 1
            seen_emails.add(parsed.email)
            continue

        resource = Resource(
            name=parsed.name,
            role=parsed.role.value,
            email=parsed.email,
            location=parsed.location.value if parsed.location is not None else None,
            notes=parsed.notes,
        )
        db.add(resource)
        try:
            db.commit()
            db.refresh(resource)
            created += 1
            seen_emails.add(parsed.email)
        except IntegrityError:
            db.rollback()
            skipped += 1
            seen_emails.add(parsed.email)

    return ImportResult(created=created, skipped=skipped, errors=errors)


@router.get("/{resource_id}", response_model=ResourceWithUtilization)
def get_resource(resource_id: int, db: DbSession) -> ResourceWithUtilization:
    resource = get_resource_or_404(db, resource_id)
    assignments = assignments_by_resource_ids(db, [resource.id]).get(resource.id, [])
    return ResourceWithUtilization(
        **ResourceRead.model_validate(resource).model_dump(),
        total_utilization_percent=total_utilization(assignments),
        project_assignments=assignments,
    )


@router.post("", response_model=ResourceRead, status_code=status.HTTP_201_CREATED)
def create_resource(payload: ResourceCreate, db: DbSession, response: Response) -> Resource:
    if email_in_use(db, payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already in use",
        )

    resource = Resource(
        name=payload.name,
        role=payload.role.value,
        email=payload.email,
        location=payload.location.value if payload.location is not None else None,
        notes=payload.notes,
    )
    db.add(resource)
    db.commit()
    db.refresh(resource)
    response.headers["Location"] = f"/api/resources/{resource.id}"
    return resource


@router.put("/{resource_id}", response_model=ResourceRead)
def update_resource(resource_id: int, payload: ResourceUpdate, db: DbSession) -> Resource:
    resource = get_resource_or_404(db, resource_id)
    if email_in_use(db, payload.email, exclude_id=resource_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already in use",
        )
    apply_resource_fields(
        resource,
        name=payload.name,
        role=payload.role,
        email=payload.email,
        location=payload.location,
        notes=payload.notes,
    )
    db.commit()
    db.refresh(resource)
    return resource


@router.patch("/{resource_id}", response_model=ResourceRead)
def patch_resource(resource_id: int, payload: ResourcePatch, db: DbSession) -> Resource:
    resource = get_resource_or_404(db, resource_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        return resource

    name = data.get("name", resource.name)
    role = data.get("role", ResourceRole(resource.role))
    email = data.get("email", resource.email)
    location = data.get(
        "location",
        ResourceLocation(resource.location) if resource.location else None,
    )
    notes = data.get("notes", resource.notes)

    if email_in_use(db, email, exclude_id=resource_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already in use",
        )

    apply_resource_fields(
        resource, name=name, role=role, email=email, location=location, notes=notes
    )
    db.commit()
    db.refresh(resource)
    return resource


def _assignment_label(project_name: str, parent_name: str | None) -> str:
    if parent_name:
        return f"{project_name} ({parent_name})"
    return project_name


@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource(resource_id: int, db: DbSession) -> None:
    resource = get_resource_or_404(db, resource_id)
    assignments = assignments_by_resource_ids(
        db, [resource.id], exclude_completed=False
    ).get(resource.id, [])
    if assignments:
        names = ", ".join(
            _assignment_label(item.project_name, item.parent_name) for item in assignments
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete {resource.name}. Assigned to: {names}",
        )
    db.delete(resource)
    db.commit()
