import { useState, type ReactNode } from "react";
import { getProject } from "../api";

type Person = {
  key: string;
  name: string;
  onMain: boolean;
};

export function PeopleNameHover({
  projectIds,
  mainProjectId,
  className,
  align = "start",
  children,
}: {
  projectIds: number[];
  mainProjectId?: number;
  className?: string;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    if (people) return;
    try {
      const details = await Promise.all(projectIds.map((id) => getProject(id)));
      const rows: Person[] = [];
      for (const detail of details) {
        const onMain = mainProjectId != null && detail.id === mainProjectId;
        for (const assignment of detail.resources) {
          rows.push({
            key: `${detail.id}-${assignment.resource.id}`,
            name: assignment.resource.name,
            onMain,
          });
        }
      }
      setPeople(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load people");
    }
  }

  return (
    <span
      className={className}
      onMouseEnter={() => void show()}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => void show()}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          className={`project-card__people-pop${align === "end" ? " project-card__people-pop--end" : ""}`}
          role="tooltip"
        >
          {error && <span>{error}</span>}
          {!error && people === null && <span>Loading…</span>}
          {!error && people && people.length === 0 && <span>No people assigned.</span>}
          {!error && people && people.length > 0 && (
            <ul>
              {people.map((person) => (
                <li
                  key={person.key}
                  className={person.onMain ? "project-card__people-pop-main" : undefined}
                >
                  {`. ${person.name}`}
                </li>
              ))}
            </ul>
          )}
        </span>
      )}
    </span>
  );
}

export function SubProjectPeopleHint({
  projectId,
  count,
}: {
  projectId: number;
  count: number;
}) {
  return (
    <PeopleNameHover projectIds={[projectId]} className="project-card__sub-count">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
      {count}
    </PeopleNameHover>
  );
}
