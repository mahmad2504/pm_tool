import { ProjectStatus, projectStatusLabel } from "../api";

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`project-status project-status--${status}`}>
      {projectStatusLabel(status)}
    </span>
  );
}
