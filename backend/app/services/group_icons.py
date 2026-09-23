import uuid
from pathlib import Path

from fastapi import HTTPException, status

from app.models import Group

ICON_DIR = Path(__file__).resolve().parents[2] / "data" / "group_icons"
MAX_ICON_BYTES = 2 * 1024 * 1024
ALLOWED_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MEDIA_TYPES = {ext: media for media, ext in ALLOWED_TYPES.items()}


def group_icon_url(group: Group | None) -> str | None:
    if group is None or not group.icon_filename:
        return None
    return f"/api/groups/{group.id}/icon?v={group.icon_filename}"


def icon_file_path(filename: str) -> Path:
    safe_name = Path(filename).name
    path = (ICON_DIR / safe_name).resolve()
    if path.parent != ICON_DIR.resolve() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group icon not found")
    return path


def delete_icon_file(filename: str | None) -> None:
    if not filename:
        return
    path = ICON_DIR / Path(filename).name
    if path.is_file():
        path.unlink()


def save_group_icon(group: Group, data: bytes, content_type: str | None) -> None:
    extension = ALLOWED_TYPES.get((content_type or "").split(";")[0].strip().lower())
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Icon must be a PNG, JPEG, WEBP, or GIF",
        )
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Icon file is empty")
    if len(data) > MAX_ICON_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Icon must be 2 MB or smaller",
        )

    ICON_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    (ICON_DIR / filename).write_bytes(data)
    previous = group.icon_filename
    group.icon_filename = filename
    if previous and previous != filename:
        delete_icon_file(previous)
