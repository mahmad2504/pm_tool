from enum import Enum


class ResourceLocation(str, Enum):
    KHI = "KHI"
    ISB = "ISB"
    LHR = "LHR"


def parse_location(value: str) -> ResourceLocation | None:
    normalized = value.strip().upper()
    try:
        return ResourceLocation(normalized)
    except ValueError:
        return None


def locations_for_api() -> list[dict[str, str]]:
    return [{"code": location.value, "label": location.value} for location in ResourceLocation]
