import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  PROJECT_ROLES,
  ProjectRole,
  Resource,
  ResourceProjectAssignment,
  listResources,
  projectRoleLabel,
  updateProjectResourceRole,
  updateProjectResourceUtilization,
} from "../api";
import { projectListLabel } from "../utils/projectLabel";

const UTILIZATION_CHANGED = "pm-utilization-changed";

export function notifyUtilizationChanged() {
  window.dispatchEvent(new Event(UTILIZATION_CHANGED));
}

type UtilizationKind = "over" | "under" | "unassigned";

const NOTICE = {
  over: {
    matches: (total: number) => total > 100,
    query: { over_utilized: true, limit: 200 },
    singular: "1 person is over 100% utilization",
    plural: (count: number) => `${count} people are over 100% utilization`,
    title: "Over-utilization",
    bannerClass: "over-notice",
    percentClass: "utilization-over",
    titleId: "over-utilization-title",
  },
  under: {
    matches: (total: number) => total > 0 && total < 100,
    query: { under_utilized: true, sort: "name" as const, limit: 200 },
    singular: "1 person is under 100% utilization",
    plural: (count: number) => `${count} people are under 100% utilization`,
    title: "Under-utilization",
    bannerClass: "under-notice",
    percentClass: "utilization-under",
    titleId: "under-utilization-title",
  },
  unassigned: {
    matches: (total: number) => total === 0,
    query: { unassigned: true, sort: "name" as const, limit: 200 },
    singular: "1 person is not assigned any task",
    plural: (count: number) => `${count} people are not assigned any task`,
    title: "Not assigned",
    bannerClass: "unassigned-notice",
    percentClass: "utilization-unassigned",
    titleId: "unassigned-title",
  },
} as const;

function AssignmentEditor({
  resourceId,
  assignment,
  onUtilizationSaved,
  onRoleSaved,
  onError,
}: {
  resourceId: number;
  assignment: ResourceProjectAssignment;
  onUtilizationSaved: (percent: number) => void;
  onRoleSaved: (role: ProjectRole) => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState(String(assignment.utilization_percent));
  const [role, setRole] = useState(assignment.project_role);
  const projectLabel = projectListLabel(
    assignment.project_name,
    !assignment.parent_name,
    assignment.parent_name,
  );

  useEffect(() => {
    setValue(String(assignment.utilization_percent));
  }, [assignment.utilization_percent]);

  useEffect(() => {
    setRole(assignment.project_role);
  }, [assignment.project_role]);

  async function commitUtilization() {
    const trimmed = value.trim();
    const percent = Number(trimmed);
    if (trimmed === "" || !Number.isInteger(percent) || percent < 0 || percent > 100) {
      onError("Utilization must be between 0 and 100");
      setValue(String(assignment.utilization_percent));
      return;
    }
    if (percent === assignment.utilization_percent) {
      setValue(String(assignment.utilization_percent));
      return;
    }
    try {
      await updateProjectResourceUtilization(assignment.project_id, resourceId, percent);
      onUtilizationSaved(percent);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update utilization");
      setValue(String(assignment.utilization_percent));
    }
  }

  async function commitRole(next: ProjectRole) {
    if (next === assignment.project_role) return;
    setRole(next);
    try {
      await updateProjectResourceRole(assignment.project_id, resourceId, next);
      onRoleSaved(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update project role");
      setRole(assignment.project_role);
    }
  }

  return (
    <li>
      <span className="over-notice__project">{projectLabel}</span>
      <div className="over-notice__controls">
        <label className="project-role-edit">
          <span className="muted">Role</span>
          <select
            value={role}
            aria-label={`Role on ${assignment.project_name}`}
            onChange={(event) => void commitRole(event.target.value as ProjectRole)}
          >
            {PROJECT_ROLES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="utilization-edit">
          <span className="muted">Util.</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={value}
            aria-label={`Utilization on ${assignment.project_name}`}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => void commitUtilization()}
          />
          <span className="muted">%</span>
        </label>
      </div>
    </li>
  );
}

function withAssignmentUpdate(
  items: Resource[],
  resourceId: number,
  projectId: number,
  matches: (total: number) => boolean,
  update: (assignment: ResourceProjectAssignment) => ResourceProjectAssignment,
): Resource[] {
  return items.flatMap((resource) => {
    if (resource.id !== resourceId) return [resource];
    const assignments = (resource.project_assignments ?? []).map((assignment) =>
      assignment.project_id === projectId ? update(assignment) : assignment,
    );
    const total = assignments.reduce((sum, assignment) => sum + assignment.utilization_percent, 0);
    if (!matches(total)) return [];
    return [{ ...resource, project_assignments: assignments, total_utilization_percent: total }];
  });
}

function UtilizationNotice({ kind }: { kind: UtilizationKind }) {
  const notice = NOTICE[kind];
  const location = useLocation();
  const [items, setItems] = useState<Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const current = NOTICE[kind];
    try {
      const data = await listResources(current.query);
      const matched = data.items.filter((item) =>
        current.matches(item.total_utilization_percent ?? 0),
      );
      setItems(matched);
      setTotal(Math.max(data.total, matched.length));
      setSelectedId((currentId) =>
        currentId !== null && matched.some((item) => item.id === currentId) ? currentId : null,
      );
      if (matched.length === 0) {
        setOpen(false);
      }
    } catch {
      // Keep the last known list so a failed refresh does not hide a real alert.
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load, location.pathname]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(UTILIZATION_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(UTILIZATION_CHANGED, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  useEffect(() => {
    if (selectedId !== null && !items.some((item) => item.id === selectedId)) {
      setSelectedId(null);
      setError(null);
    }
  }, [items, selectedId]);

  function close() {
    setOpen(false);
    setSelectedId(null);
    setError(null);
  }

  function applyUpdate(
    resourceId: number,
    projectId: number,
    update: (assignment: ResourceProjectAssignment) => ResourceProjectAssignment,
  ) {
    const next = withAssignmentUpdate(items, resourceId, projectId, notice.matches, update);
    setError(null);
    setItems(next);
    if (!next.some((item) => item.id === resourceId)) {
      setSelectedId(null);
      setTotal((current) => Math.max(next.length, current - 1));
    }
    if (next.length === 0) {
      setOpen(false);
    }
    notifyUtilizationChanged();
  }

  if (items.length === 0) {
    return null;
  }

  const selected = selectedId === null ? null : (items.find((item) => item.id === selectedId) ?? null);
  const count = Math.max(total, items.length);
  const label = count === 1 ? notice.singular : notice.plural(count);
  const assignments = selected?.project_assignments ?? [];

  return (
    <>
      <button
        type="button"
        className={notice.bannerClass}
        onClick={() => {
          setSelectedId(null);
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={close} role="presentation">
          <div
            className="modal modal--wide"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={notice.titleId}
          >
            <header className="modal__header">
              <div className="over-notice__heading">
                {selected && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setSelectedId(null);
                      setError(null);
                    }}
                  >
                    Back
                  </button>
                )}
                <h2 id={notice.titleId}>{selected ? selected.name : notice.title}</h2>
              </div>
              <button type="button" className="icon-btn" onClick={close} aria-label="Close">
                ×
              </button>
            </header>
            {selected && (
              <p className="over-notice__total">
                Total utilization:{" "}
                <strong className={notice.percentClass}>{selected.total_utilization_percent}%</strong>
              </p>
            )}
            {error && (
              <p className="modal__error over-notice__error" role="alert">
                {error}
              </p>
            )}
            {selected ? (
              assignments.length === 0 ? (
                <p className="over-notice__assignments">No active project assignments.</p>
              ) : (
                <ul className="over-notice__list over-notice__assignments over-notice__assignments--edit">
                  {assignments.map((assignment) => (
                    <AssignmentEditor
                      key={assignment.project_id}
                      resourceId={selected.id}
                      assignment={assignment}
                      onError={setError}
                      onUtilizationSaved={(percent) =>
                        applyUpdate(selected.id, assignment.project_id, (current) => ({
                          ...current,
                          utilization_percent: percent,
                        }))
                      }
                      onRoleSaved={(role) =>
                        applyUpdate(selected.id, assignment.project_id, (current) => ({
                          ...current,
                          project_role: role,
                        }))
                      }
                    />
                  ))}
                </ul>
              )
            ) : (
              <ul className="over-notice__list">
                {items.map((resource) => (
                  <li key={resource.id}>
                    <button
                      type="button"
                      className="over-notice__person"
                      onClick={() => {
                        setError(null);
                        setSelectedId(resource.id);
                      }}
                    >
                      {resource.name}
                      <span className={notice.percentClass}>{resource.total_utilization_percent}%</span>
                    </button>
                    {(resource.project_assignments ?? []).length === 0 ? (
                      <p className="over-notice__assignments">No active project assignments.</p>
                    ) : (
                      <ul className="over-notice__assignments">
                        {(resource.project_assignments ?? []).map((assignment) => (
                          <li key={assignment.project_id}>
                            {projectListLabel(
                              assignment.project_name,
                              !assignment.parent_name,
                              assignment.parent_name,
                            )}{" "}
                            -&gt; {projectRoleLabel(assignment.project_role)} -&gt;{" "}
                            {assignment.utilization_percent}%
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function OverUtilizationNotice() {
  return <UtilizationNotice kind="over" />;
}

export function UnderUtilizationNotice() {
  return <UtilizationNotice kind="under" />;
}

export function UnassignedNotice() {
  return <UtilizationNotice kind="unassigned" />;
}
