from sqlalchemy import case, select
from sqlalchemy.orm import Session

from app.models import ProjectResource, Resource
from app.roles import ProjectRole
from app.schemas.projects import AssignedResourceRead
from app.schemas.resources import ResourceRead


def list_assigned_resources(db: Session, project_id: int) -> list[AssignedResourceRead]:
    role_rank = case(
        (ProjectResource.project_role == ProjectRole.director.value, 0),
        (ProjectResource.project_role == ProjectRole.lead.value, 1),
        else_=2,
    )
    rows = db.execute(
        select(ProjectResource, Resource)
        .join(Resource, Resource.id == ProjectResource.resource_id)
        .where(ProjectResource.project_id == project_id)
        .order_by(role_rank, Resource.name)
    ).all()
    return [
        AssignedResourceRead(
            resource=ResourceRead.model_validate(resource),
            utilization_percent=link.utilization_percent,
            project_role=ProjectRole(link.project_role),
            onboarded=link.onboarded,
        )
        for link, resource in rows
    ]
