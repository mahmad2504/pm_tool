import {
  CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  RESOURCE_LOCATIONS,
  Resource,
  ResourceInput,
  ResourceLocation,
  ResourceProjectAssignment,
  ResourceRole,
  RoleItem,
  projectRoleLabel,
  createResource,
  deleteResource,
  downloadResourcesExport,
  importResources,
  listProjects,
  listResources,
  listRoles,
  resourcesExportFilename,
  ProjectSummary,
  templateCsvUrl,
  updateProjectResourceUtilization,
  updateResource,
} from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { notifyUtilizationChanged } from "../components/OverUtilizationNotice";
import { OnboardedIcon } from "../components/OnboardedIcon";
import { ProjectRoleIcon } from "../components/ProjectRoleIcon";
import { ResourceModal } from "../components/ResourceModal";
import { RoleBadge } from "../components/RoleBadge";
import { Link } from "react-router-dom";
import { AppShell } from "../layout/AppShell";
import { avatarHue, initials } from "../utils";
import { projectListLabel } from "../utils/projectLabel";
import { resourceReportPath } from "./ResourceReportPage";

const PAGE_SIZE = 50;

const emptyForm: ResourceInput = {
  name: "",
  role: "software_engineer",
  email: "",
  location: null,
  notes: null,
};

function roleLabel(roles: RoleItem[], code: ResourceRole): string {
  return roles.find((r) => r.code === code)?.label ?? code;
}

function AssignmentUtilization({
  resourceId,
  assignment,
  onSaved,
  onError,
}: {
  resourceId: number;
  assignment: ResourceProjectAssignment;
  onSaved: (percent: number) => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState(String(assignment.utilization_percent));

  useEffect(() => {
    setValue(String(assignment.utilization_percent));
  }, [assignment.utilization_percent]);

  async function commit() {
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
      notifyUtilizationChanged();
      onSaved(percent);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update utilization");
      setValue(String(assignment.utilization_percent));
    }
  }

  return (
    <label className="utilization-edit">
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label={`Utilization on ${assignment.project_name}`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
      />
      <span className="muted">%</span>
    </label>
  );
}

function ResourcePager({
  page,
  total,
  loading,
  onPage,
}: {
  page: number;
  total: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <nav className="resource-pager" aria-label="Resource pages">
      <span>
        {from}–{to} of {total}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={loading || page === 0}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page + 1} of {pageCount}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={loading || page + 1 >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

export function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<ResourceRole | "">("");
  const [filterLocation, setFilterLocation] = useState<ResourceLocation | "">("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [filterProject, setFilterProject] = useState<number | "">("");
  const [form, setForm] = useState<ResourceInput>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Resource | null>(null);

  function applyAssignmentUtilization(resourceId: number, projectId: number, percent: number) {
    setResources((current) =>
      current.map((resource) => {
        if (resource.id !== resourceId) return resource;
        const assignments = (resource.project_assignments ?? []).map((assignment) =>
          assignment.project_id === projectId
            ? { ...assignment, utilization_percent: percent }
            : assignment,
        );
        return {
          ...resource,
          project_assignments: assignments,
          total_utilization_percent: assignments.reduce(
            (sum, assignment) => sum + assignment.utilization_percent,
            0,
          ),
        };
      }),
    );
  }

  useEffect(() => {
    listRoles()
      .then(setRoles)
      .catch(() => setRoles([]));
    listProjects({ limit: 200 })
      .then((data) => setProjects(data.items))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filterKey = `${search}\0${filterRole}\0${filterLocation}\0${filterProject}`;
  const [pagingFor, setPagingFor] = useState(filterKey);
  if (pagingFor !== filterKey) {
    setPagingFor(filterKey);
    if (page !== 0) setPage(0);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listResources({
        q: search.trim() || undefined,
        role: filterRole || undefined,
        location: filterLocation || undefined,
        project_id: filterProject || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      const lastPage = Math.max(0, Math.ceil(list.total / PAGE_SIZE) - 1);
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setResources(list.items);
      setTotal(list.total);
      if (list.role_counts) {
        setRoleCounts(list.role_counts);
      } else {
        const counts: Record<string, number> = {};
        for (const item of list.items) {
          counts[item.role] = (counts[item.role] ?? 0) + 1;
        }
        setRoleCounts(counts);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load resources");
    } finally {
      setLoading(false);
    }
  }, [search, filterRole, filterLocation, filterProject, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasFilters = Boolean(search.trim() || filterRole || filterLocation || filterProject);

  function openCreateModal() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  }

  function startEdit(resource: Resource) {
    setEditingId(resource.id);
    setForm({
      name: resource.name,
      role: resource.role,
      email: resource.email,
      location: resource.location,
      notes: resource.notes,
    });
    setError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: ResourceInput = {
      ...form,
      notes: form.notes?.trim() ? form.notes.trim() : null,
    };
    try {
      if (editingId === null) {
        await createResource(payload);
      } else {
        await updateResource(editingId, payload);
      }
      closeModal();
      if (editingId === null && page !== 0) {
        setPage(0);
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setError(null);
    try {
      await deleteResource(deleteTarget.id);
      if (editingId === deleteTarget.id) closeModal();
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setDeleteTarget(null);
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      await downloadResourcesExport({
        q: search.trim() || undefined,
        role: filterRole || undefined,
        location: filterLocation || undefined,
        project_id: filterProject || undefined,
        filename: resourcesExportFilename(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(file: File | null) {
    if (!file) return;
    setImporting(true);
    setError(null);
    setImportSummary(null);
    try {
      const result = await importResources(file);
      const errPart =
        result.errors.length > 0
          ? ` ${result.errors.length} row(s) had errors.`
          : "";
      setImportSummary(
        `Import complete: ${result.created} created, ${result.skipped} skipped.${errPart}`,
      );
      if (page !== 0) {
        setPage(0);
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <AppShell>
      <header className="main-header">
        <div>
          <h1>People resources</h1>
          <p className="subtitle">
            Engineers and leads you can assign to projects.
          </p>
        </div>
        <div className="header-actions">
          <Link
            className="btn btn--secondary"
            to={resourceReportPath(searchInput, filterRole, filterProject, filterLocation)}
          >
            Report
          </Link>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? "Exporting…" : "Export"}
          </button>
          <label className={`btn btn--secondary ${importing ? "btn--loading" : ""}`}>
            {importing ? "Importing…" : "Import CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              disabled={importing}
              onChange={(e) => {
                void handleImport(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
          <a className="btn btn--ghost" href={templateCsvUrl()} download>
            Template
          </a>
          <button type="button" className="btn btn--primary" onClick={openCreateModal}>
            + Add resource
          </button>
        </div>
      </header>

      {(error || importSummary) && (
        <div className="toasts">
          {error && (
            <div className="toast toast--error" role="alert">
              {error}
              <button type="button" className="toast__dismiss" onClick={() => setError(null)}>
                ×
              </button>
            </div>
          )}
          {importSummary && (
            <div className="toast toast--success" role="status">
              {importSummary}
              <button
                type="button"
                className="toast__dismiss"
                onClick={() => setImportSummary(null)}
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}

      <section className="stats">
        <article className="stat-card">
          <span className="stat-card__label">Total</span>
          <strong className="stat-card__value">{total}</strong>
          <span className="stat-card__hint">
            {hasFilters ? "Matching filters" : "In directory"}
          </span>
        </article>
        {roles.map((r) => (
          <article key={r.code} className="stat-card stat-card--compact">
            <RoleBadge role={r.code} displayLabel={r.label} />
            <strong className="stat-card__value stat-card__value--sm">
              {roleCounts[r.code] ?? 0}
            </strong>
          </article>
        ))}
      </section>

      <section className="content-panel">
        <div className="toolbar">
          <div className="search-wrap">
            <span className="search-icon" aria-hidden>
              ⌕
            </span>
            <input
              className="search-input"
              placeholder="Search by name or email…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <select
            className="filter-select"
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as ResourceRole | "")}
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value as ResourceLocation | "")}
            aria-label="Filter by location"
          >
            <option value="">All locations</option>
            {RESOURCE_LOCATIONS.map((location) => (
              <option key={location.code} value={location.code}>
                {location.label}
              </option>
            ))}
          </select>
          <select
            className="filter-select filter-select--wide"
            value={filterProject}
            onChange={(e) =>
              setFilterProject(e.target.value ? Number(e.target.value) : "")
            }
            aria-label="Filter by project"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {projectListLabel(p.name, p.is_root, p.parent_name)}
              </option>
            ))}
          </select>
        </div>

        <ResourcePager page={page} total={total} loading={loading} onPage={setPage} />

        {loading ? (
          <div className="skeleton-grid" aria-busy="true" aria-label="Loading resources">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-card" />
            ))}
          </div>
        ) : resources.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">👥</div>
            <h2>{hasFilters ? "No matches" : "No resources yet"}</h2>
            <p>
              {hasFilters
                ? "Try a different search or clear the filters."
                : "Add someone manually or import a CSV to get started."}
            </p>
            {!hasFilters && (
              <button type="button" className="btn btn--primary" onClick={openCreateModal}>
                Add your first resource
              </button>
            )}
          </div>
        ) : (
          <ul className="resource-grid">
            {resources.map((r) => (
              <li key={r.id} className="resource-card">
                <div className="resource-card__top">
                  <div
                    className="avatar"
                    style={{ "--avatar-hue": avatarHue(r.name) } as CSSProperties}
                    aria-hidden
                  >
                    {initials(r.name)}
                  </div>
                  <div className="resource-card__meta">
                    <h3>{r.name}</h3>
                    <div className="resource-card__tags">
                      <RoleBadge role={r.role} displayLabel={roleLabel(roles, r.role)} />
                      {r.location && (
                        <span className="badge badge--location">{r.location}</span>
                      )}
                    </div>
                  </div>
                </div>
                  <a className="resource-card__email" href={`mailto:${r.email}`}>
                    {r.email}
                  </a>
                  {r.notes ? (
                  <p className="resource-card__notes">{r.notes}</p>
                ) : (
                  <p className="resource-card__notes resource-card__notes--empty">No notes</p>
                )}
                <div className="resource-utilization">
                  <p className="resource-utilization__total">
                    Total utilization:{" "}
                    <strong
                      className={
                        (r.total_utilization_percent ?? 0) > 100
                          ? "utilization-over"
                          : undefined
                      }
                    >
                      {r.total_utilization_percent ?? 0}%
                    </strong>
                    {(r.total_utilization_percent ?? 0) > 100 && (
                      <span className="muted"> (overallocated)</span>
                    )}
                  </p>
                  {(r.project_assignments?.length ?? 0) > 0 && (
                    <ul className="resource-assignments">
                      {r.project_assignments!.map((a) => (
                        <li
                          key={a.project_id}
                          className={
                            a.project_role === "lead" || a.project_role === "director"
                              ? `resource-assignments__row resource-assignments__row--${a.project_role}`
                              : "resource-assignments__row"
                          }
                        >
                          <Link to={`/projects/${a.project_id}`}>
                            {projectListLabel(
                              a.project_name,
                              !a.parent_name,
                              a.parent_name,
                            )}
                          </Link>
                          <ProjectRoleIcon role={a.project_role} />
                          {a.onboarded ? <OnboardedIcon /> : null}
                          <AssignmentUtilization
                            resourceId={r.id}
                            assignment={a}
                            onSaved={(percent) => {
                              setError(null);
                              applyAssignmentUtilization(r.id, a.project_id, percent);
                            }}
                            onError={setError}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <footer className="resource-card__actions">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => startEdit(r)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger-outline btn--sm"
                    onClick={() => setDeleteTarget(r)}
                  >
                    Delete
                  </button>
                </footer>
              </li>
            ))}
          </ul>
        )}

        <ResourcePager page={page} total={total} loading={loading} onPage={setPage} />
      </section>

      <ResourceModal
        open={modalOpen}
        title={editingId === null ? "Add resource" : "Edit resource"}
        roles={roles}
        form={form}
        saving={saving}
        onChange={setForm}
        onClose={closeModal}
        onSubmit={(e) => void handleSubmit(e)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete resource?"
        confirmDisabled={(deleteTarget?.project_assignments?.length ?? 0) > 0}
        message={
          deleteTarget
            ? (deleteTarget.project_assignments?.length ?? 0) > 0
              ? `${deleteTarget.name} is linked to the projects below. Remove those assignments before deleting this person.`
              : `${deleteTarget.name} is not linked to any project and will be removed permanently.`
            : ""
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      >
        {deleteTarget && (deleteTarget.project_assignments?.length ?? 0) > 0 && (
          <ul className="confirm-assignments">
            {deleteTarget.project_assignments!.map((a) => (
              <li key={a.project_id}>
                <span className="confirm-assignments__name">
                  {projectListLabel(a.project_name, !a.parent_name, a.parent_name)}
                </span>
                <span className="confirm-assignments__meta">
                  {projectRoleLabel(a.project_role)} · {a.utilization_percent}%
                  {a.onboarded ? " · Onboarded" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </AppShell>
  );
}
