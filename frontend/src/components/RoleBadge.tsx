import { ResourceRole } from "../api";

const ROLE_STYLES: Record<ResourceRole, { label: string; className: string }> = {
  software_engineer: { label: "Software", className: "badge badge--software" },
  hardware_engineer: { label: "Hardware", className: "badge badge--hardware" },
  lead: { label: "Lead", className: "badge badge--lead" },
};

export function RoleBadge({
  role,
  displayLabel,
}: {
  role: ResourceRole;
  displayLabel?: string;
}) {
  const style = ROLE_STYLES[role];
  return (
    <span className={style.className}>{displayLabel ?? style.label}</span>
  );
}
