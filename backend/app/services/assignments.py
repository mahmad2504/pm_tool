from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ProjectResource, Resource
from app.schemas.projects import AssignedResourceRead
from app.schemas.resources import ResourceRead


def list_assigned_resources(db: Session, project_id: int) -> list[AssignedResourceRead]:
    rows = db.execute(
        select(ProjectResource, Resource)
        .join(Resource, Resource.id == ProjectResource.resource_id)
        .where(ProjectResource.project_id == project_id)
        .order_by(Resource.name)
    ).all()
    return [
        AssignedResourceRead(
            resource=ResourceRead.model_validate(resource),
            utilization_percent=link.utilization_percent,
        )
        for link, resource in rows
    ]
