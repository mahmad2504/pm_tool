from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.models import Project, ProjectTag, Tag

MAX_TAG_LENGTH = 64
MAX_TAGS_PER_PROJECT = 20


def normalize_tag_list(value: list[str] | None) -> list[str] | None:
    if value is None:
        return None
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in value:
        name = " ".join(raw.split())
        if not name:
            continue
        if len(name) > MAX_TAG_LENGTH:
            raise ValueError(f"Tag cannot be longer than {MAX_TAG_LENGTH} characters")
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(name)
    if len(cleaned) > MAX_TAGS_PER_PROJECT:
        raise ValueError(f"A project can have at most {MAX_TAGS_PER_PROJECT} tags")
    return cleaned


def resolve_tag(db: Session, name: str) -> Tag:
    normalized = " ".join(name.split())
    existing = db.scalar(select(Tag).where(func.lower(Tag.name) == normalized.lower()))
    if existing is not None:
        return existing
    tag = Tag(name=normalized)
    db.add(tag)
    db.flush()
    return tag


def set_project_tags(db: Session, project: Project, names: list[str]) -> None:
    resolved: list[Tag] = []
    seen: set[int] = set()
    for name in names:
        tag = resolve_tag(db, name)
        if tag.id in seen:
            continue
        seen.add(tag.id)
        resolved.append(tag)
    project.tags = resolved
    db.flush()
    delete_unused_tags(db)


def detach_project_tags(db: Session, project_ids: list[int]) -> None:
    if not project_ids:
        return
    db.execute(delete(ProjectTag).where(ProjectTag.project_id.in_(project_ids)))


def delete_unused_tags(db: Session) -> None:
    used = select(ProjectTag.tag_id)
    unused = list(db.scalars(select(Tag).where(Tag.id.not_in(used))).all())
    for tag in unused:
        db.delete(tag)
    if unused:
        db.flush()


def tags_for_projects(db: Session, project_ids: list[int]) -> dict[int, list[tuple[int, str]]]:
    grouped: dict[int, list[tuple[int, str]]] = {project_id: [] for project_id in project_ids}
    if not project_ids:
        return grouped
    rows = db.execute(
        select(ProjectTag.project_id, Tag.id, Tag.name)
        .join(Tag, Tag.id == ProjectTag.tag_id)
        .where(ProjectTag.project_id.in_(project_ids))
        .order_by(func.lower(Tag.name), Tag.id)
    ).all()
    for project_id, tag_id, name in rows:
        grouped.setdefault(int(project_id), []).append((int(tag_id), name))
    return grouped


def list_tags_with_counts(db: Session) -> list[tuple[int, str, int]]:
    root_id = func.coalesce(Project.root_project_id, Project.id)
    rows = db.execute(
        select(Tag.id, Tag.name, func.count(func.distinct(root_id)))
        .select_from(Tag)
        .outerjoin(ProjectTag, ProjectTag.tag_id == Tag.id)
        .outerjoin(Project, Project.id == ProjectTag.project_id)
        .group_by(Tag.id, Tag.name)
        .order_by(func.lower(Tag.name), Tag.id)
    ).all()
    return [(int(tag_id), name, int(count)) for tag_id, name, count in rows]


def project_has_tag(tag_id: int):
    return (
        select(ProjectTag.project_id)
        .where(ProjectTag.project_id == Project.id, ProjectTag.tag_id == tag_id)
        .correlate(Project)
        .exists()
    )


def family_has_tag(tag_id: int):
    family = aliased(Project)
    return (
        select(ProjectTag.project_id)
        .join(family, family.id == ProjectTag.project_id)
        .where(
            ProjectTag.tag_id == tag_id,
            or_(family.id == Project.id, family.root_project_id == Project.id),
        )
        .correlate(Project)
        .exists()
    )


def project_tag_name_matches(pattern: str):
    return (
        select(ProjectTag.project_id)
        .join(Tag, Tag.id == ProjectTag.tag_id)
        .where(ProjectTag.project_id == Project.id, Tag.name.ilike(pattern))
        .correlate(Project)
        .exists()
    )


def family_tag_name_matches(pattern: str):
    family = aliased(Project)
    return (
        select(ProjectTag.project_id)
        .join(Tag, Tag.id == ProjectTag.tag_id)
        .join(family, family.id == ProjectTag.project_id)
        .where(
            Tag.name.ilike(pattern),
            or_(family.id == Project.id, family.root_project_id == Project.id),
        )
        .correlate(Project)
        .exists()
    )
