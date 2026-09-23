from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.resources import ResourceRead


def trim_optional_description(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


class ProjectCreateRoot(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    group_name: str | None = Field(default=None, max_length=255)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Cannot be blank")
        return trimmed

    @field_validator("group_name")
    @classmethod
    def trim_group(cls, value: str | None) -> str | None:
        return trim_optional_description(value)

    @field_validator("description")
    @classmethod
    def trim_description(cls, value: str | None) -> str | None:
        return trim_optional_description(value)


class ProjectCreateSub(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Name cannot be blank")
        return trimmed

    @field_validator("description")
    @classmethod
    def trim_description(cls, value: str | None) -> str | None:
        return trim_optional_description(value)


class ProjectUpdateRoot(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    group_name: str | None = Field(default=None, max_length=255)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Cannot be blank")
        return trimmed

    @field_validator("group_name")
    @classmethod
    def trim_group(cls, value: str | None) -> str | None:
        return trim_optional_description(value)

    @field_validator("description")
    @classmethod
    def trim_description(cls, value: str | None) -> str | None:
        return trim_optional_description(value)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    group_name: str | None = Field(default=None, max_length=255)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Cannot be blank")
        return trimmed

    @field_validator("group_name")
    @classmethod
    def trim_group(cls, value: str | None) -> str | None:
        return trim_optional_description(value)

    @field_validator("description")
    @classmethod
    def trim_description(cls, value: str | None) -> str | None:
        return trim_optional_description(value)


class SubProjectSummary(BaseModel):
    id: int
    name: str
    description: str | None


class ProjectSummary(BaseModel):
    id: int
    name: str
    description: str | None
    parent_id: int | None
    parent_name: str | None = None
    root_project_id: int
    is_root: bool
    group_name: str | None
    resource_count: int
    status_report_count: int
    sub_project_count: int
    sub_projects: list[SubProjectSummary] = []
    created_at: datetime
    updated_at: datetime


class ProjectListResponse(BaseModel):
    items: list[ProjectSummary]
    total: int


class ProjectDetail(BaseModel):
    id: int
    name: str
    description: str | None
    parent_id: int | None
    parent_name: str | None
    root_project_id: int
    root_name: str
    is_root: bool
    group_name: str | None
    resources: list["AssignedResourceRead"]
    sub_projects: list[SubProjectSummary]
    recent_status_reports: list["StatusReportRead"] = []
    created_at: datetime
    updated_at: datetime


class AssignedResourceRead(BaseModel):
    resource: ResourceRead
    utilization_percent: int = Field(ge=0, le=100)


class ProjectResourceAttach(BaseModel):
    resource_id: int
    utilization_percent: int = Field(default=100, ge=0, le=100)


class ProjectResourceUpdate(BaseModel):
    utilization_percent: int = Field(ge=0, le=100)


class StatusReportCreate(BaseModel):
    body: str = Field(min_length=1)

    @field_validator("body")
    @classmethod
    def trim_body(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Body cannot be blank")
        return trimmed


class StatusReportUpdate(BaseModel):
    body: str = Field(min_length=1)

    @field_validator("body")
    @classmethod
    def trim_body(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Body cannot be blank")
        return trimmed


class StatusReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    body: str
    created_at: datetime
    updated_at: datetime


class StatusReportListResponse(BaseModel):
    items: list[StatusReportRead]
    total: int


class GroupRead(BaseModel):
    id: int
    name: str
    project_count: int
