import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ProjectDetail,
  Resource,
  attachResourceToProject,
  createStatusReport,
  createSubProject,
  deleteProject,
  deleteStatusReport,
  detachResourceFromProject,
  getProject,
  groupIconSrc,
  listAllResources,
  listStatusReports,
  patchProject,
  updateProjectResourceUtilization,
  updateStatusReport,
} from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { RoleBadge } from "../components/RoleBadge";
import { AppShell } from "../layout/AppShell";
import { notifyUtilizationChanged } from "../components/OverUtilizationNotice";
import { projectListLabel } from "../utils/projectLabel";

export function ProjectDetailPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [allReports, setAllReports] = useState(false);
  const [reports, setReports] = useState<{ items: ProjectDetail["recent_status_reports"]; total: number }>({
    items: [],
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [editMeta, setEditMeta] = useState({ name: "", description: "", group_name: "" });
  const [subForm, setSubForm] = useState({ name: "", description: "" });
  const [reportBody, setReportBody] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [availableResources, setAvailableResources] = useState<Resource[]>([]);
  const [resourceSearch, setResourceSearch] = useState("");
  const [pickUtilization, setPickUtilization] = useState(100);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pickerRequest = useRef(0);

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const detail = await getProject(projectId, 2);
      setProject(detail);
      setEditMeta({
        name: detail.name,
        description: detail.description ?? "",
        group_name: detail.group_name ?? "",
      });
      const rep = await listStatusReports(projectId, allReports ? undefined : 2);
      setReports({ items: rep.items, total: rep.total });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load project");
    }
  }, [projectId, allReports]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveMeta(e: FormEvent) {
    e.preventDefault();
    if (!project) return;
    try {
      const payload: { name: string; description: string | null; group_name?: string } = {
        name: editMeta.name.trim(),
        description: editMeta.description.trim() || null,
      };
      if (project.is_root) {
        payload.group_name = editMeta.group_name.trim();
      }
      await patchProject(project.id, payload);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function addSub(e: FormEvent) {
    e.preventDefault();
    if (!project) return;
    try {
      await createSubProject(project.id, {
        name: subForm.name.trim(),
        description: subForm.description.trim() || null,
      });
      setSubForm({ name: "", description: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add sub-project");
    }
  }

  async function loadPickerResources(q: string) {
    const requestId = ++pickerRequest.current;
    try {
      const items = await listAllResources({
        q: q.trim() || undefined,
        sort: "name",
      });
      if (requestId === pickerRequest.current) setAvailableResources(items);
    } catch {
      if (requestId === pickerRequest.current) setAvailableResources([]);
    }
  }

  async function openPicker() {
    setPickerOpen(true);
    await loadPickerResources(resourceSearch);
  }

  async function searchResources(q: string) {
    setResourceSearch(q);
    await loadPickerResources(q);
  }

  async function addResource(resourceId: number) {
    if (!project) return;
    try {
      await attachResourceToProject(project.id, resourceId, pickUtilization);
      setPickerOpen(false);
      notifyUtilizationChanged();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign resource");
    }
  }

  async function saveUtilization(resourceId: number, percent: number) {
    if (!project) return;
    if (percent < 0 || percent > 100 || Number.isNaN(percent)) {
      setError("Utilization must be between 0 and 100");
      return;
    }
    try {
      await updateProjectResourceUtilization(project.id, resourceId, percent);
      notifyUtilizationChanged();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update utilization");
    }
  }

  async function removeResource(resourceId: number) {
    if (!project) return;
    try {
      await detachResourceFromProject(project.id, resourceId);
      notifyUtilizationChanged();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove resource");
    }
  }

  async function addReport(e: FormEvent) {
    e.preventDefault();
    if (!project || !reportBody.trim()) return;
    try {
      await createStatusReport(project.id, reportBody.trim());
      setReportBody("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add report");
    }
  }

  async function handleDeleteProject() {
    if (!project) return;
    try {
      await deleteProject(project.id);
      notifyUtilizationChanged();
      navigate("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (!project) {
    return (
      <AppShell>
        <p className="muted">{error ?? "Loading…"}</p>
      </AppShell>
    );
  }

  const assignedIds = new Set(project.resources.map((a) => a.resource.id));

  return (
    <AppShell>
      <header className="main-header">
        <div>
          <p className="breadcrumb">
            <Link to="/projects">Projects</Link>
            {project.parent_id && (
              <>
                {" "}
                / <Link to={`/projects/${project.parent_id}`}>{project.parent_name}</Link>
              </>
            )}
          </p>
          <h1>{project.name}</h1>
          <p className="project-card__updated">
            Last updated{" "}
            <time dateTime={project.updated_at}>
              {new Date(project.updated_at).toLocaleString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          </p>
          {project.group_name && (
            <p className="project-group">
              {groupIconSrc(project.group_icon_url) && (
                <img
                  className="group-mark"
                  src={groupIconSrc(project.group_icon_url) ?? undefined}
                  alt=""
                />
              )}
              <span className="group-pill">{project.group_name}</span>
            </p>
          )}
          {!project.is_root && (
            <p className="subtitle">
              Sub-project · root:{" "}
              <Link to={`/projects/${project.root_project_id}`}>{project.root_name}</Link>
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn btn--danger-outline"
          onClick={() => setConfirmDelete(true)}
        >
          Delete project
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

      <section className="content-panel detail-section">
        <h2>Details</h2>
        <form className="modal__form" onSubmit={(e) => void saveMeta(e)}>
          <label>
            Name
            <input
              required
              value={editMeta.name}
              onChange={(e) => setEditMeta({ ...editMeta, name: e.target.value })}
            />
          </label>
          {project.is_root ? (
            <label>
              Group
              <input
                required
                value={editMeta.group_name}
                onChange={(e) => setEditMeta({ ...editMeta, group_name: e.target.value })}
              />
            </label>
          ) : (
            <p className="muted">Group (inherited): {project.group_name ?? "—"}</p>
          )}
          <label>
            Description
            <textarea
              rows={3}
              value={editMeta.description}
              onChange={(e) => setEditMeta({ ...editMeta, description: e.target.value })}
            />
          </label>
          <button type="submit" className="btn btn--primary">
            Save details
          </button>
        </form>
      </section>

      {project.is_root && (
        <section className="content-panel detail-section">
          <h2>Sub-projects</h2>
          <ul className="sub-list">
            {project.sub_projects.map((s) => (
              <li key={s.id}>
                <Link to={`/projects/${s.id}`}>
                  {projectListLabel(s.name, false, project.name)}
                </Link>
              </li>
            ))}
            {project.sub_projects.length === 0 && (
              <li className="muted">No sub-projects yet.</li>
            )}
          </ul>
          <form className="inline-form" onSubmit={(e) => void addSub(e)}>
            <input
              required
              placeholder="Sub-project name"
              value={subForm.name}
              onChange={(e) => setSubForm({ ...subForm, name: e.target.value })}
            />
            <input
              placeholder="Description (optional)"
              value={subForm.description}
              onChange={(e) => setSubForm({ ...subForm, description: e.target.value })}
            />
            <button type="submit" className="btn btn--secondary">
              Add sub-project
            </button>
          </form>
        </section>
      )}

      <section className="content-panel detail-section">
        <div className="section-head">
          <h2>Resources</h2>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void openPicker()}>
            + Add resource
          </button>
        </div>
        <ul className="sub-list">
          {project.resources.map((a) => (
            <li key={a.resource.id} className="resource-row">
              <span>
                {a.resource.name} · <RoleBadge role={a.resource.role} />
              </span>
              <div className="resource-row__actions">
                <label className="utilization-edit">
                  <span className="muted">Util.</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={a.utilization_percent}
                    onBlur={(e) =>
                      void saveUtilization(a.resource.id, Number(e.target.value))
                    }
                  />
                  <span className="muted">%</span>
                </label>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void removeResource(a.resource.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
          {project.resources.length === 0 && <li className="muted">No resources assigned.</li>}
        </ul>
      </section>

      <section className="content-panel detail-section">
        <div className="section-head">
          <h2>Status reports</h2>
          {reports.total > 2 && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setAllReports((v) => !v)}
            >
              {allReports ? "Show recent 2" : `View all (${reports.total})`}
            </button>
          )}
        </div>
        <div className="report-list">
          {reports.items.map((rep) => (
            <article key={rep.id} className="report-card">
              <time className="muted">{new Date(rep.created_at).toLocaleString()}</time>
              <pre className="report-body">{rep.body}</pre>
              <div className="report-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    const next = window.prompt("Edit report", rep.body);
                    if (next && next.trim()) {
                      void updateStatusReport(project.id, rep.id, next.trim()).then(load);
                    }
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn--danger-outline btn--sm"
                  onClick={() =>
                    void deleteStatusReport(project.id, rep.id).then(load)
                  }
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
        <form className="modal__form" onSubmit={(e) => void addReport(e)}>
          <label>
            New status report
            <textarea
              rows={4}
              required
              value={reportBody}
              onChange={(e) => setReportBody(e.target.value)}
              placeholder="Multiline status update…"
            />
          </label>
          <button type="submit" className="btn btn--primary">
            Add report
          </button>
        </form>
      </section>

      {pickerOpen && (
        <div className="modal-backdrop" onClick={() => setPickerOpen(false)} role="presentation">
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <header className="modal__header">
              <h2>Add resource</h2>
              <button type="button" className="icon-btn" onClick={() => setPickerOpen(false)}>
                ×
              </button>
            </header>
            <input
              className="search-input"
              placeholder="Search people…"
              value={resourceSearch}
              onChange={(e) => void searchResources(e.target.value)}
            />
            <label className="picker-utilization">
              Utilization on this project (%)
              <input
                type="number"
                min={0}
                max={100}
                value={pickUtilization}
                onChange={(e) => setPickUtilization(Number(e.target.value))}
              />
            </label>
            <ul className="picker-list">
              {availableResources.map((r) => (
                <li key={r.id}>
                  <span className="picker-person">
                    <span className="picker-person__name">{r.name}</span>
                    <span className="picker-person__email" title={r.email}>
                      ({r.email})
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={assignedIds.has(r.id)}
                    onClick={() => void addResource(r.id)}
                  >
                    {assignedIds.has(r.id) ? "Assigned" : "Add"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete project?"
        message="This removes the project, all sub-projects, assignments, and status reports."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDeleteProject()}
      />
    </AppShell>
  );
}
