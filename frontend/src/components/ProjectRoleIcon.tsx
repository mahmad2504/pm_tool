import { ReactNode } from "react";
import { ProjectRole, projectRoleLabel } from "../api";

function roleGlyph(role: ProjectRole): ReactNode {
  switch (role) {
    case "lead":
      return (
        <>
          <circle cx="9" cy="8" r="3.25" />
          <path d="M3 20.5v-.75A5 5 0 0 1 8 14.75h2.2" />
          <path d="m16.4 8.1.9 2.15 2.3.15-1.8 1.5.55 2.25L16.4 13l-1.95 1.15.55-2.25-1.8-1.5 2.3-.15z" />
        </>
      );
    case "director":
      return (
        <>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          <path d="M2 13h20" />
        </>
      );
    case "dv_engineer":
      return <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
    case "rtl_engineer":
      return (
        <>
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
          <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
        </>
      );
    case "software_engineer":
      return (
        <>
          <polyline points="8 7 3 12 8 17" />
          <polyline points="16 7 21 12 16 17" />
        </>
      );
    case "firmware_engineer":
      return (
        <>
          <rect x="5" y="5" width="14" height="14" rx="2" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
          <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
        </>
      );
    default:
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
        </>
      );
  }
}

export function ProjectRoleIcon({ role }: { role: ProjectRole }) {
  const label = projectRoleLabel(role);
  return (
    <span className="project-role-icon" title={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {roleGlyph(role)}
      </svg>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
