from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.roles import ProjectLifecycle, ProjectRole
from app.schemas.resources import ResourceRead


def trim_optional_description(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


class ProjectCreateRoot(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    group_name: str = Field(min_length=1, max_length=255)
    status: ProjectLifecycle = ProjectLifecycle.assessment

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Cannot be blank")
        return trimmed

    @field_validator("group_name")
    @classmethod
    def trim_group(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Cannot be blank")
        return trimmed

    @field_validator("description")
    @classmethod
    def trim_description(cls, value: str | None) -> str | None:
        return trim_optional_description(value)


class ProjectMove(BaseModel):
    parent_id: int


class ProjectCreateSub(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    status: ProjectLifecycle = ProjectLifecycle.assessment

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
    group_name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Cannot be blank")
        return trimmed

    @field_validator("group_name")
    @classmethod
    def trim_group(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Cannot be blank")
        return trimmed

    @field_validator("description")
    @classmethod
    def trim_description(cls, value: str | None) -> str | None:
        return trim_optional_description(value)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    group_name: str | None = Field(default=None, max_length=255)
    status: ProjectLifecycle | None = None

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
        if value is None:
            raise ValueError("Cannot be blank")
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Cannot be blank")
        return trimmed

    @field_validator("description")
    @classmethod
    def trim_description(cls, value: str | None) -> str | None:
        return trim_optional_description(value)


class SubProjectSummary(BaseModel):
    id: int
    name: str
    description: str | None
    status: ProjectLifecycle
    resource_count: int = 0


class DuplicateResource(BaseModel):
    id: int
    name: str


class ProjectSummary(BaseModel):
    id: int
    name: str
    description: str | None
    parent_id: int | None
    parent_name: str | None = None
    root_project_id: int
    is_root: bool
    group_name: str | None
    group_id: int | None = None
    group_icon_url: str | None = None
    status: ProjectLifecycle
    resource_count: int
    status_report_count: int
    sub_project_count: int
    sub_projects: list[SubProjectSummary] = []
    duplicate_resources: list[DuplicateResource] = []
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
    group_icon_url: str | None = None
    status: ProjectLifecycle
    resources: list["AssignedResourceRead"]
    sub_projects: list[SubProjectSummary]
    recent_status_reports: list["StatusReportRead"] = []
    created_at: datetime
    updated_at: datetime


class AssignedResourceRead(BaseModel):
    resource: ResourceRead
    utilization_percent: int = Field(ge=0, le=100)
    project_role: ProjectRole
    onboarded: bool = False


class ProjectResourceAttach(BaseModel):
    resource_id: int
    utilization_percent: int = Field(default=100, ge=0, le=100)
    project_role: ProjectRole = ProjectRole.member
    onboarded: bool = False


class ProjectResourceUpdate(BaseModel):
    utilization_percent: int | None = Field(default=None, ge=0, le=100)
    project_role: ProjectRole | None = None
    onboarded: bool | None = None

    @model_validator(mode="after")
    def require_a_change(self) -> "ProjectResourceUpdate":
        if (
            self.utilization_percent is None
            and self.project_role is None
            and self.onboarded is None
        ):
            raise ValueError("Provide utilization_percent, project_role, or onboarded")
        return self


class StatusReportCreate(BaseModel):
    body: str = Field(min_length=1)
    created_at: datetime | None = None

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


class ProjectExportSubProject(BaseModel):
    id: int
    name: str
    description: str | None
    status: ProjectLifecycle
    created_at: datetime
    updated_at: datetime
    resources: list[AssignedResourceRead]
    status_report_count: int
    status_reports: list[StatusReportRead]


class ProjectExportRecord(BaseModel):
    id: int
    name: str
    description: str | None
    group_id: int | None
    group_name: str | None
    status: ProjectLifecycle
    created_at: datetime
    updated_at: datetime
    resources: list[AssignedResourceRead]
    status_report_count: int
    status_reports: list[StatusReportRead]
    sub_projects: list[ProjectExportSubProject]


class GroupRead(BaseModel):
    id: int
    name: str
    project_count: int
    icon_url: str | None = None


class GroupUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Cannot be blank")
        return trimmed
