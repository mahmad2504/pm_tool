from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.locations import ResourceLocation, parse_location
from app.roles import ProjectRole, ResourceRole, parse_role


def normalize_location(value: object) -> ResourceLocation | None:
    if value is None or isinstance(value, ResourceLocation):
        return value
    text = str(value).strip()
    if not text:
        return None
    parsed = parse_location(text)
    if parsed is None:
        raise ValueError("Location must be KHI, ISB, or LHR")
    return parsed


def normalize_notes(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


class ResourceBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    role: ResourceRole
    email: EmailStr
    location: ResourceLocation | None = None
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

    @field_validator("location", mode="before")
    @classmethod
    def clean_location(cls, value: object) -> ResourceLocation | None:
        return normalize_location(value)


class ResourceCreate(ResourceBase):
    pass


class ResourceUpdate(ResourceBase):
    pass


class ResourcePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    role: ResourceRole | None = None
    email: EmailStr | None = None
    location: ResourceLocation | None = None
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

    @field_validator("location", mode="before")
    @classmethod
    def clean_location(cls, value: object) -> ResourceLocation | None:
        return normalize_location(value)


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
    onboarded: bool = False


class ResourceWithUtilization(ResourceRead):
    total_utilization_percent: int = Field(ge=0)
    project_assignments: list[ResourceProjectAssignment] = []


class ResourceListResponse(BaseModel):
    items: list[ResourceWithUtilization]
    total: int
    role_counts: dict[str, int] = Field(default_factory=dict)


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
    location: ResourceLocation | None = None
    notes: str | None = None

    @classmethod
    def from_csv_fields(
        cls,
        name: str,
        role_raw: str,
        email: str,
        notes: str,
        location_raw: str = "",
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
            location=normalize_location(location_raw),
            notes=normalize_notes(notes) if notes else None,
        )
