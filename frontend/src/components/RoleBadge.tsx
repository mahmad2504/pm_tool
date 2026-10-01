import { ResourceRole } from "../api";

const ROLE_STYLES: Record<ResourceRole, { label: string; className: string }> = {
  software_engineer: { label: "Software", className: "badge badge--software" },
  it_engineer: { label: "IT", className: "badge badge--it" },
  hardware_engineer: { label: "Hardware", className: "badge badge--hardware" },
  analog_design_engineer: { label: "Analog", className: "badge badge--analog" },
  pd_engineer: { label: "PD", className: "badge badge--pd" },
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
