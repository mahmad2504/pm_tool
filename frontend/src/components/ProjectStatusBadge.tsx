import { PROJECT_STATUSES, ProjectStatus } from "../api";

export function ProjectStatusSelect({
  status,
  label,
  onChange,
  reportsWithPmo = true,
}: {
  status: ProjectStatus;
  label: string;
  onChange: (status: ProjectStatus) => void;
  reportsWithPmo?: boolean;
}) {
  const dormant = reportsWithPmo === false;
  return (
    <span
      className={`project-status project-status--${status} project-status-select${
        dormant ? " project-status--not-pmo" : ""
      }`}
      title={dormant ? "Reporting is not with PMO" : undefined}
    >
      <select
        className="project-status-select__input"
        aria-label={label}
        value={status}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value as ProjectStatus)}
      >
        {PROJECT_STATUSES.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </span>
  );
}
