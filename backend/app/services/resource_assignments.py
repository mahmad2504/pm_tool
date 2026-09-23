from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.models import Group, Project, ProjectResource
from app.schemas.resources import ResourceProjectAssignment


def assignments_by_resource_ids(
    db: Session, resource_ids: list[int]
) -> dict[int, list[ResourceProjectAssignment]]:
    if not resource_ids:
        return {}

    Root = aliased(Project)
    Parent = aliased(Project)
    rows = db.execute(
        select(
            ProjectResource.resource_id,
            Project.id,
            Project.name,
            Parent.name,
            Group.name,
            ProjectResource.utilization_percent,
        )
        .join(Project, ProjectResource.project_id == Project.id)
        .join(Root, Project.root_project_id == Root.id)
        .outerjoin(Parent, Project.parent_id == Parent.id)
        .outerjoin(Group, Root.group_id == Group.id)
        .where(ProjectResource.resource_id.in_(resource_ids))
        .order_by(Project.name)
    ).all()

    result: dict[int, list[ResourceProjectAssignment]] = {rid: [] for rid in resource_ids}
    for resource_id, project_id, project_name, parent_name, group_name, utilization in rows:
        result[resource_id].append(
            ResourceProjectAssignment(
                project_id=project_id,
                project_name=project_name,
                parent_name=parent_name,
                group_name=group_name,
                utilization_percent=utilization,
            )
        )
    return result


def total_utilization(assignments: list[ResourceProjectAssignment]) -> int:
    return sum(a.utilization_percent for a in assignments)
