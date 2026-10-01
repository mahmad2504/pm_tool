import { Resource, RoleItem } from "./api";

export const RESOURCE_REPORT_SORTS = [
  "name",
  "name_desc",
  "role",
  "email",
  "utilization",
  "utilization_asc",
] as const;

export type ResourceReportSort = (typeof RESOURCE_REPORT_SORTS)[number];

export function resourceReportSortFromParam(value: string | null): ResourceReportSort {
  if (value && (RESOURCE_REPORT_SORTS as readonly string[]).includes(value)) {
    return value as ResourceReportSort;
  }
  return "name";
}

export function resourceReportSortLabel(sort: ResourceReportSort): string {
  switch (sort) {
    case "name":
      return "Ordered by name";
    case "name_desc":
      return "Ordered by name, Z to A";
    case "role":
      return "Ordered by organization role";
    case "email":
      return "Ordered by email";
    case "utilization":
      return "Ordered by utilization, highest first";
    case "utilization_asc":
      return "Ordered by utilization, lowest first";
  }
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function sortResourceReport(
  items: Resource[],
  sort: ResourceReportSort,
  roles: RoleItem[],
): Resource[] {
  const labels = new Map(roles.map((role) => [role.code, role.label]));
  const roleLabel = (person: Resource) => labels.get(person.role) ?? person.role;
  return [...items].sort((a, b) => {
    const byName = compareText(a.name, b.name) || a.id - b.id;
    switch (sort) {
      case "name":
        return byName;
      case "name_desc":
        return compareText(b.name, a.name) || a.id - b.id;
      case "email":
        return compareText(a.email, b.email) || byName;
      case "role":
        return compareText(roleLabel(a), roleLabel(b)) || byName;
      case "utilization":
        return (b.total_utilization_percent ?? 0) - (a.total_utilization_percent ?? 0) || byName;
      case "utilization_asc":
        return (a.total_utilization_percent ?? 0) - (b.total_utilization_percent ?? 0) || byName;
    }
  });
}
