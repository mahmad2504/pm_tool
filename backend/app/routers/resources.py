import csv
import io
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Resource, utc_now
from app.roles import ResourceRole, roles_for_api
from app.schemas import (
    CsvRowInput,
    ImportResult,
    ResourceCreate,
    ResourceListResponse,
    ResourcePatch,
    ResourceRead,
    ResourceUpdate,
)

router = APIRouter(prefix="/api/resources", tags=["resources"])

DbSession = Annotated[Session, Depends(get_db)]

CSV_TEMPLATE = "name,role,email,notes\n"


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


def apply_resource_fields(resource: Resource, *, name: str, role: ResourceRole, email: str, notes: str | None) -> None:
    resource.name = name
    resource.role = role.value
    resource.email = email
    resource.notes = notes
    resource.updated_at = utc_now()


@router.get("", response_model=ResourceListResponse)
def list_resources(
    db: DbSession,
    role: ResourceRole | None = None,
    q: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> ResourceListResponse:
    filters = []
    if role is not None:
        filters.append(Resource.role == role.value)
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(or_(Resource.name.ilike(pattern), Resource.email.ilike(pattern)))

    count_stmt = select(func.count()).select_from(Resource)
    list_stmt = select(Resource).order_by(Resource.created_at.desc(), Resource.id.desc())
    if filters:
        count_stmt = count_stmt.where(*filters)
        list_stmt = list_stmt.where(*filters)

    total = db.scalar(count_stmt) or 0
    items = db.scalars(list_stmt.offset(offset).limit(limit)).all()
    return ResourceListResponse(items=items, total=total)


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

        try:
            parsed = CsvRowInput.from_csv_fields(name, role_raw, email, notes)
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


@router.get("/{resource_id}", response_model=ResourceRead)
def get_resource(resource_id: int, db: DbSession) -> Resource:
    return get_resource_or_404(db, resource_id)


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
    notes = data.get("notes", resource.notes)

    if email_in_use(db, email, exclude_id=resource_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already in use",
        )

    apply_resource_fields(resource, name=name, role=role, email=email, notes=notes)
    db.commit()
    db.refresh(resource)
    return resource


@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource(resource_id: int, db: DbSession) -> None:
    resource = get_resource_or_404(db, resource_id)
    db.delete(resource)
    db.commit()
