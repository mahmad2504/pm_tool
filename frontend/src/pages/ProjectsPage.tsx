import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  GroupItem,
  projectRoleLabel,
  ProjectSummary,
  StatusReport,
  createRootProject,
  createStatusReport,
  downloadProjectsExport,
  projectsExportFilename,
  getProject,
  groupIconSrc,
  listGroups,
  listProjects,
  listStatusReports,
  updateGroup,
  updateStatusReport,
  uploadGroupIcon,
} from "../api";
import { AppShell } from "../layout/AppShell";

function formatUpdated(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function GroupMark({
  name,
  iconUrl,
  onClick,
}: {
  name: string;
  iconUrl: string | null;
  onClick: () => void;
}) {
  const src = groupIconSrc(iconUrl);
  return (
    <button
      type="button"
      className="group-mark-btn"
      onClick={onClick}
      aria-label={`Edit group ${name}`}
      title={name}
    >
      {src ? (
        <img className="group-mark" src={src} alt="" />
      ) : (
        <span className="group-mark group-mark--empty" aria-hidden>
          {name.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </button>
  );
}

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
    {
      key: string;
      projectName: string;
      resourceName: string;
      roleLabel: string;
      utilization: number;
    }[]
  >([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ProjectSummary | null>(null);
  const [latestReport, setLatestReport] = useState<StatusReport | null>(null);
  const [reportBody, setReportBody] = useState("");
  const [newReportBody, setNewReportBody] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSaving, setReportSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    group_name: "",
  });
  const [groupEditor, setGroupEditor] = useState<GroupItem | null>(null);
  const [groupName, setGroupName] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [groupSaving, setGroupSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportReports, setExportReports] = useState("3");
  const [exportFileName, setExportFileName] = useState("");
  const [exporting, setExporting] = useState(false);

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
            roleLabel: projectRoleLabel(assignment.project_role),
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

  async function openLastReport(project: ProjectSummary) {
    setReportTarget(project);
    setLatestReport(null);
    setReportBody("");
    setNewReportBody("");
    setReportError(null);
    setReportLoading(true);
    try {
      const data = await listStatusReports(project.id, 1);
      const latest = data.items[0];
      if (!latest) {
        setReportError("No report yet.");
        return;
      }
      setLatestReport(latest);
      setReportBody(latest.body);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to load the report");
    } finally {
      setReportLoading(false);
    }
  }

  async function saveLastReport(event: FormEvent) {
    event.preventDefault();
    if (!reportTarget || !latestReport) return;
    const body = reportBody.trim();
    if (!body) return;
    setReportSaving(true);
    setReportError(null);
    try {
      await updateStatusReport(reportTarget.id, latestReport.id, body);
      setReportTarget(null);
      await load();
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to save the report");
    } finally {
      setReportSaving(false);
    }
  }

  async function addReport(event: FormEvent) {
    event.preventDefault();
    if (!reportTarget) return;
    const body = newReportBody.trim();
    if (!body) return;
    setReportSaving(true);
    setReportError(null);
    try {
      await createStatusReport(reportTarget.id, body);
      setNewReportBody("");
      setReportTarget(null);
      await load();
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to add the report");
    } finally {
      setReportSaving(false);
    }
  }

  function closeGroupEditor() {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setGroupEditor(null);
    setGroupName("");
    setIconFile(null);
    setIconPreview(null);
  }

  function openGroupEditor(project: ProjectSummary) {
    if (project.group_id == null || !project.group_name) return;
    const known = groups.find((group) => group.id === project.group_id);
    setGroupEditor(
      known ?? {
        id: project.group_id,
        name: project.group_name,
        project_count: 0,
        icon_url: project.group_icon_url,
      },
    );
    setGroupName(project.group_name);
    setIconFile(null);
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(null);
  }

  function chooseGroupIcon(file: File) {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
  }

  async function saveGroup(e: FormEvent) {
    e.preventDefault();
    if (!groupEditor) return;
    const name = groupName.trim();
    if (!name) return;
    setGroupSaving(true);
    setError(null);
    try {
      if (name !== groupEditor.name) {
        await updateGroup(groupEditor.id, name);
      }
      if (iconFile) {
        await uploadGroupIcon(groupEditor.id, iconFile);
      }
      closeGroupEditor();
      const [nextGroups, data] = await Promise.all([
        listGroups(),
        listProjects({
          q: search.trim() || undefined,
          group_id: groupFilter || undefined,
          roots_only: true,
        }),
      ]);
      setGroups(nextGroups);
      setProjects(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update group");
    } finally {
      setGroupSaving(false);
    }
  }

  function exportFilterLabel(): string {
    const groupName = groupFilter
      ? (groups.find((group) => group.id === groupFilter)?.name ?? "group")
      : "all groups";
    const query = search.trim();
    return query ? `${groupName} ${query}` : groupName;
  }

  function openExport() {
    setExportReports("3");
    setExportFileName(projectsExportFilename(exportFilterLabel()));
    setExportOpen(true);
  }

  async function runExport(event: FormEvent) {
    event.preventDefault();
    const reports = Number(exportReports);
    if (!Number.isInteger(reports) || reports < 0 || reports > 100) {
      setError("Enter a whole number of reports from 0 to 100");
      return;
    }
    const filename = exportFileName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    if (!filename) {
      setError("Enter a file name");
      return;
    }
    const downloadName = filename.toLowerCase().endsWith(".jsonl") ? filename : `${filename}.jsonl`;
    setExporting(true);
    setError(null);
    try {
      await downloadProjectsExport({
        q: search.trim() || undefined,
        group_id: groupFilter || undefined,
        reports,
        filename: downloadName,
      });
      setExportOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
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
        group_name: form.group_name.trim(),
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
            Every root project belongs to a group. Sub-projects inherit that group.
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
          <button
            type="button"
            className="btn btn--secondary"
            disabled={loading || exporting}
            onClick={openExport}
          >
            Export
          </button>
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
                <div className="project-card__head">
                  {p.group_name && p.group_id != null && (
                    <GroupMark
                      name={p.group_name}
                      iconUrl={p.group_icon_url}
                      onClick={() => openGroupEditor(p)}
                    />
                  )}
                  <h3 className="project-card__title">
                    <Link to={`/projects/${p.id}`}>{p.name}</Link>
                  </h3>
                  {p.status_report_count > 0 && (
                    <button
                      type="button"
                      className="project-card__report"
                      aria-label="Last report"
                      onClick={() => void openLastReport(p)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                        <path d="M16 13H8" />
                        <path d="M16 17H8" />
                        <path d="M10 9H8" />
                      </svg>
                    </button>
                  )}
                </div>
                <p className="project-card__description">
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
                <p className="project-card__updated">
                  Last updated <time dateTime={p.updated_at}>{formatUpdated(p.updated_at)}</time>
                </p>
                <p className="project-card__meta">
                  <button
                    type="button"
                    className="project-card__people"
                    aria-label={`${p.resource_count} people`}
                    onClick={() => void openPeople(p)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <span>{p.resource_count}</span>
                  </button>
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

      {exportOpen && (
        <div className="modal-backdrop" onClick={() => setExportOpen(false)} role="presentation">
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-dialog-title"
          >
            <header className="modal__header">
              <h2 id="export-dialog-title">Export projects</h2>
              <button type="button" className="icon-btn" onClick={() => setExportOpen(false)}>
                ×
              </button>
            </header>
            <p className="modal__message">
              Exports {total} root project{total === 1 ? "" : "s"} matching the current search and
              group filter. Each project is one JSONL line, with people, sub-projects, and the
              latest status reports.
            </p>
            <form className="modal__form" onSubmit={(event) => void runExport(event)}>
              <label>
                File name
                <input
                  required
                  value={exportFileName}
                  onChange={(event) => setExportFileName(event.target.value)}
                />
              </label>
              <label>
                Last status reports
                <input
                  type="number"
                  min={0}
                  max={100}
                  required
                  value={exportReports}
                  onChange={(event) => setExportReports(event.target.value)}
                />
              </label>
              <p className="muted">
                How many of the most recent status reports to include for each project and
                sub-project.
              </p>
              <footer className="modal__footer">
                <button type="button" className="btn btn--ghost" onClick={() => setExportOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={exporting}>
                  {exporting ? "Exporting…" : "Export JSONL"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {groupEditor && (
        <div className="modal-backdrop" onClick={closeGroupEditor} role="presentation">
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-editor-title"
          >
            <header className="modal__header">
              <h2 id="group-editor-title">Group</h2>
              <button type="button" className="icon-btn" onClick={closeGroupEditor}>
                ×
              </button>
            </header>
            <form className="modal__form" onSubmit={(event) => void saveGroup(event)}>
              <div className="group-editor__icon">
                {iconPreview || groupIconSrc(groupEditor.icon_url) ? (
                  <img
                    className="group-mark group-mark--lg"
                    src={iconPreview ?? groupIconSrc(groupEditor.icon_url) ?? undefined}
                    alt=""
                  />
                ) : (
                  <span className="group-mark group-mark--empty group-mark--lg" aria-hidden>
                    {groupName.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                )}
                <label className="btn btn--ghost btn--sm group-editor__upload">
                  {groupEditor.icon_url || iconFile ? "Change icon" : "Upload icon"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) chooseGroupIcon(file);
                    }}
                  />
                </label>
              </div>
              <label>
                Name
                <input
                  required
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                />
              </label>
              <footer className="modal__footer">
                <button type="button" className="btn btn--ghost" onClick={closeGroupEditor}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={groupSaving}>
                  {groupSaving ? "Saving…" : "Save"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

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
                    {row.projectName} -&gt; {row.resourceName} -&gt; {row.roleLabel} -&gt;{" "}
                    {row.utilization}%
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {reportTarget && (
        <div className="modal-backdrop" onClick={() => setReportTarget(null)} role="presentation">
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="last-report-title"
          >
            <header className="modal__header">
              <h2 id="last-report-title">Last report</h2>
              <button type="button" className="icon-btn" onClick={() => setReportTarget(null)}>
                ×
              </button>
            </header>
            <p className="modal__message">{reportTarget.name}</p>
            {reportLoading && <p className="modal__message">Loading…</p>}
            {reportError && <p className="modal__message">{reportError}</p>}
            {!reportLoading && latestReport && (
              <form className="modal__form" onSubmit={(event) => void saveLastReport(event)}>
                <p className="project-card__updated">
                  Submitted{" "}
                  <time dateTime={latestReport.created_at}>{formatUpdated(latestReport.created_at)}</time>
                </p>
                <label>
                  Report
                  <textarea
                    required
                    rows={6}
                    value={reportBody}
                    onChange={(event) => setReportBody(event.target.value)}
                  />
                </label>
                <footer className="modal__footer">
                  <button type="submit" className="btn btn--primary" disabled={reportSaving || !reportBody.trim()}>
                    {reportSaving ? "Saving…" : "Save"}
                  </button>
                </footer>
              </form>
            )}
            {!reportLoading && (
              <form
                className="modal__form report-dialog__new"
                onSubmit={(event) => void addReport(event)}
              >
                <label>
                  New report
                  <textarea
                    rows={4}
                    value={newReportBody}
                    onChange={(event) => setNewReportBody(event.target.value)}
                    placeholder="Write a new status report…"
                  />
                </label>
                <footer className="modal__footer">
                  <button type="button" className="btn btn--ghost" onClick={() => setReportTarget(null)}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn--secondary"
                    disabled={reportSaving || !newReportBody.trim()}
                  >
                    {reportSaving ? "Saving…" : "Add report"}
                  </button>
                </footer>
              </form>
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
                Group
                <input
                  required
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
