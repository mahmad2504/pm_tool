from enum import Enum


class ResourceRole(str, Enum):
    software_engineer = "software_engineer"
    hardware_engineer = "hardware_engineer"
    lead = "lead"


ROLE_LABELS: dict[ResourceRole, str] = {
    ResourceRole.software_engineer: "Software engineer",
    ResourceRole.hardware_engineer: "Hardware engineer",
    ResourceRole.lead: "Lead",
}

_LABEL_TO_ROLE: dict[str, ResourceRole] = {
    label.lower(): role for role, label in ROLE_LABELS.items()
}
_CODE_TO_ROLE: dict[str, ResourceRole] = {
    role.value: role for role in ResourceRole
}


def parse_role(value: str) -> ResourceRole | None:
    normalized = value.strip().lower()
    if normalized in _CODE_TO_ROLE:
        return _CODE_TO_ROLE[normalized]
    return _LABEL_TO_ROLE.get(normalized)


def roles_for_api() -> list[dict[str, str]]:
    return [{"code": role.value, "label": ROLE_LABELS[role]} for role in ResourceRole]


class ProjectRole(str, Enum):
    member = "member"
    lead = "lead"
    director = "director"
    dv_engineer = "dv_engineer"
    rtl_engineer = "rtl_engineer"
    software_engineer = "software_engineer"
    firmware_engineer = "firmware_engineer"


PROJECT_ROLE_LABELS: dict[ProjectRole, str] = {
    ProjectRole.member: "Member",
    ProjectRole.lead: "Lead",
    ProjectRole.director: "Director",
    ProjectRole.dv_engineer: "DV engineer",
    ProjectRole.rtl_engineer: "RTL engineer",
    ProjectRole.software_engineer: "Software engineer",
    ProjectRole.firmware_engineer: "Firmware engineer",
}


def project_roles_for_api() -> list[dict[str, str]]:
    return [
        {"code": role.value, "label": PROJECT_ROLE_LABELS[role]} for role in ProjectRole
    ]
