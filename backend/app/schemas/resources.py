from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.roles import ProjectRole, ResourceRole, parse_role


def normalize_notes(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


class ResourceBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    role: ResourceRole
    email: EmailStr
    notes: str | None = None

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Name cannot be blank")
        return trimmed

    @field_validator("email")
    @classmethod
    def lower_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("notes")
    @classmethod
    def clean_notes(cls, value: str | None) -> str | None:
        return normalize_notes(value)


class ResourceCreate(ResourceBase):
    pass


class ResourceUpdate(ResourceBase):
    pass


class ResourcePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    role: ResourceRole | None = None
    email: EmailStr | None = None
    notes: str | None = None

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Name cannot be blank")
        return trimmed

    @field_validator("email")
    @classmethod
    def lower_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().lower()

    @field_validator("notes")
    @classmethod
    def clean_notes(cls, value: str | None) -> str | None:
        return normalize_notes(value)


class ResourceRead(ResourceBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class ResourceProjectAssignment(BaseModel):
    project_id: int
    project_name: str
    parent_name: str | None = None
    group_name: str | None
    utilization_percent: int = Field(ge=0, le=100)
    project_role: ProjectRole = ProjectRole.member


class ResourceWithUtilization(ResourceRead):
    total_utilization_percent: int = Field(ge=0)
    project_assignments: list[ResourceProjectAssignment] = []


class ResourceListResponse(BaseModel):
    items: list[ResourceWithUtilization]
    total: int


class ImportErrorItem(BaseModel):
    row: int
    detail: str


class ImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[ImportErrorItem]


class RoleItem(BaseModel):
    code: str
    label: str


class CsvRowInput(BaseModel):
    name: str
    role: ResourceRole
    email: EmailStr
    notes: str | None = None

    @classmethod
    def from_csv_fields(
        cls,
        name: str,
        role_raw: str,
        email: str,
        notes: str,
    ) -> "CsvRowInput":
        if not name.strip():
            raise ValueError("Name is required")
        if not email.strip():
            raise ValueError("Email is required")
        role = parse_role(role_raw)
        if role is None:
            raise ValueError(f"Unknown role: {role_raw!r}")
        return cls(
            name=name.strip(),
            role=role,
            email=email.strip().lower(),
            notes=normalize_notes(notes) if notes else None,
        )
