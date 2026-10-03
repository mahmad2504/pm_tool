from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.models import Group, Project, ProjectResource
from app.roles import ProjectLifecycle
from app.schemas.resources import ResourceProjectAssignment


def assignments_by_resource_ids(
    db: Session,
    resource_ids: list[int],
    *,
    exclude_completed: bool = True,
) -> dict[int, list[ResourceProjectAssignment]]:
    if not resource_ids:
        return {}

    Root = aliased(Project)
    Parent = aliased(Project)
    stmt = (
        select(
            ProjectResource.resource_id,
            Project.id,
            Project.name,
            Parent.name,
            Group.name,
            ProjectResource.utilization_percent,
            ProjectResource.project_role,
            ProjectResource.onboarded,
        )
        .join(Project, ProjectResource.project_id == Project.id)
        .join(Root, Project.root_project_id == Root.id)
        .outerjoin(Parent, Project.parent_id == Parent.id)
        .outerjoin(Group, Root.group_id == Group.id)
        .where(ProjectResource.resource_id.in_(resource_ids))
        .order_by(Project.name)
    )
    if exclude_completed:
        stmt = stmt.where(
            Project.status != ProjectLifecycle.completed.value,
            Root.status != ProjectLifecycle.completed.value,
        )
    rows = db.execute(stmt).all()

    result: dict[int, list[ResourceProjectAssignment]] = {rid: [] for rid in resource_ids}
    for (
        resource_id,
        project_id,
        project_name,
        parent_name,
        group_name,
        utilization,
        project_role,
        onboarded,
    ) in rows:
        result[resource_id].append(
            ResourceProjectAssignment(
                project_id=project_id,
                project_name=project_name,
                parent_name=parent_name,
                group_name=group_name,
                utilization_percent=utilization,
                project_role=project_role,
                onboarded=bool(onboarded),
            )
        )
    return result


def total_utilization(assignments: list[ResourceProjectAssignment]) -> int:
    return sum(a.utilization_percent for a in assignments)
