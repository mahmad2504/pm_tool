from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.roles import ProjectLifecycle, ResourceRole


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Resource(Base):
    __tablename__ = "resources"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(64), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    location: Mapped[str | None] = mapped_column(String(8), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    projects: Mapped[list["Project"]] = relationship(
        secondary="project_resources", back_populates="resources"
    )

    @property
    def role_enum(self) -> ResourceRole:
        return ResourceRole(self.role)


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    icon_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)

    root_projects: Mapped[list["Project"]] = relationship(
        back_populates="group",
        foreign_keys="Project.group_id",
    )


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    projects: Mapped[list["Project"]] = relationship(
        secondary="project_tags", back_populates="tags"
    )


class ProjectTag(Base):
    __tablename__ = "project_tags"
    __table_args__ = (UniqueConstraint("project_id", "tag_id", name="uq_project_tag"),)

    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    root_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=ProjectLifecycle.assessment.value
    )
    reports_with_pmo: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    chat_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    parent: Mapped["Project | None"] = relationship(
        remote_side="Project.id",
        foreign_keys=[parent_id],
        back_populates="children",
    )
    children: Mapped[list["Project"]] = relationship(
        back_populates="parent",
        foreign_keys=[parent_id],
    )
    group: Mapped["Group | None"] = relationship(
        back_populates="root_projects",
        foreign_keys=[group_id],
    )
    resources: Mapped[list["Resource"]] = relationship(
        secondary="project_resources", back_populates="projects"
    )
    tags: Mapped[list["Tag"]] = relationship(
        secondary="project_tags", back_populates="projects"
    )
    status_reports: Mapped[list["ProjectStatusReport"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ProjectResource(Base):
    __tablename__ = "project_resources"
    __table_args__ = (UniqueConstraint("project_id", "resource_id", name="uq_project_resource"),)

    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    resource_id: Mapped[int] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True
    )
    utilization_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    project_role: Mapped[str] = mapped_column(String(64), nullable=False, default="member")
    onboarded: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )


class ProjectStatusReport(Base):
    __tablename__ = "project_status_reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    project: Mapped["Project"] = relationship(back_populates="status_reports")
