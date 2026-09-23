import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  GroupItem,
  ProjectSummary,
  createRootProject,
  getProject,
  listGroups,
  listProjects,
} from "../api";
import { AppShell } from "../layout/AppShell";

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [peopleTarget, setPeopleTarget] = useState<ProjectSummary | null>(null);
  const [peopleRows, setPeopleRows] = useState<
    { key: string; projectName: string; resourceName: string; utilization: number }[]
  >([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    group_name: "",
  });

  useEffect(() => {
    listGroups().then(setGroups).catch(() => setGroups([]));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listProjects({
        q: search.trim() || undefined,
        group_id: groupFilter || undefined,
        roots_only: true,
      });
      setProjects(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [search, groupFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openPeople(project: ProjectSummary) {
    setPeopleTarget(project);
    setPeopleRows([]);
    setPeopleError(null);
    setPeopleLoading(true);
    try {
      const details = await Promise.all([
        getProject(project.id),
        ...project.sub_projects.map((sub) => getProject(sub.id)),
      ]);
      setPeopleRows(
        details.flatMap((detail) =>
          detail.resources.map((assignment) => ({
            key: `${detail.id}-${assignment.resource.id}`,
            projectName: detail.name,
            resourceName: assignment.resource.name,
            utilization: assignment.utilization_percent,
          })),
        ),
      );
    } catch (err) {
      setPeopleError(err instanceof Error ? err.message : "Failed to load people");
    } finally {
      setPeopleLoading(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createRootProject({
        name: form.name.trim(),
        description: form.description.trim() || null,
        group_name: form.group_name.trim() || null,
      });
      setModalOpen(false);
      setForm({ name: "", description: "", group_name: "" });
      await load();
      listGroups().then(setGroups).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <header className="main-header">
        <div>
          <h1>Projects</h1>
          <p className="subtitle">
            Optional groups for root projects. Sub-projects inherit the root group when set.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setModalOpen(true)}>
          + New root project
        </button>
      </header>

      {error && (
        <div className="toast toast--error" role="alert">
          {error}
          <button type="button" className="toast__dismiss" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      <section className="content-panel">
        <div className="toolbar">
          <div className="search-wrap">
            <span className="search-icon" aria-hidden>
              ⌕
            </span>
            <input
              className="search-input"
              placeholder="Search name, description, or group…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <select
            className="filter-select"
            value={groupFilter}
            onChange={(e) =>
              setGroupFilter(e.target.value ? Number(e.target.value) : "")
            }
          >
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.project_count})
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="skeleton-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton-card" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <h2>No projects yet</h2>
            <p>Create a root project to get started.</p>
            <button type="button" className="btn btn--primary" onClick={() => setModalOpen(true)}>
              Create project
            </button>
          </div>
        ) : (
          <ul className="resource-grid">
            {projects.map((p) => (
              <li key={p.id} className="resource-card project-card">
                <h3 className="project-card__title">
                  <Link to={`/projects/${p.id}`}>{p.name}</Link>
                </h3>
                <p className="resource-card__notes">
                  {p.description || "No description"}
                </p>
                {p.sub_projects.length > 0 && (
                  <ul className="project-card__subs">
                    {p.sub_projects.map((sub) => (
                      <li key={sub.id}>
                        <Link to={`/projects/${sub.id}`}>{sub.name}</Link>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="project-card__meta">
                  <button
                    type="button"
                    className="project-card__people"
                    onClick={() => void openPeople(p)}
                  >
                    {p.resource_count} people
                  </button>
                  {p.status_report_count > 0 && (
                    <> · {p.status_report_count} reports</>
                  )}
                </p>
                <Link className="btn btn--ghost btn--sm" to={`/projects/${p.id}`}>
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="muted list-footer">{total} root project(s)</p>
      </section>

      {peopleTarget && (
        <div
          className="modal-backdrop"
          onClick={() => setPeopleTarget(null)}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="people-dialog-title"
          >
            <header className="modal__header">
              <h2 id="people-dialog-title">{peopleTarget.name}</h2>
              <button type="button" className="icon-btn" onClick={() => setPeopleTarget(null)}>
                ×
              </button>
            </header>
            {peopleLoading && <p className="modal__message">Loading…</p>}
            {peopleError && <p className="modal__message">{peopleError}</p>}
            {!peopleLoading && !peopleError && peopleRows.length === 0 && (
              <p className="modal__message">No people assigned.</p>
            )}
            {!peopleLoading && peopleRows.length > 0 && (
              <ul className="people-dialog__list">
                {peopleRows.map((row) => (
                  <li key={row.key}>
                    {row.projectName} -&gt; {row.resourceName} -&gt; {row.utilization}%
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
            <header className="modal__header">
              <h2>New root project</h2>
              <button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>
                ×
              </button>
            </header>
            <form className="modal__form" onSubmit={(e) => void handleCreate(e)}>
              <label>
                Name
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Group (optional)
                <input
                  placeholder="Leave empty for no group"
                  value={form.group_name}
                  onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                />
              </label>
              <label>
                Description
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <footer className="modal__footer">
                <button type="button" className="btn btn--ghost" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={saving}>
                  {saving ? "Creating…" : "Create"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
