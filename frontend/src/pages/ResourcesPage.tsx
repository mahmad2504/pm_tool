import {
  CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Resource,
  ResourceInput,
  ResourceRole,
  RoleItem,
  projectRoleLabel,
  createResource,
  deleteResource,
  importResources,
  listProjects,
  listResources,
  listRoles,
  ProjectSummary,
  templateCsvUrl,
  updateResource,
} from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ResourceModal } from "../components/ResourceModal";
import { RoleBadge } from "../components/RoleBadge";
import { Link } from "react-router-dom";
import { AppShell } from "../layout/AppShell";
import { avatarHue, initials } from "../utils";
import { projectListLabel } from "../utils/projectLabel";

const emptyForm: ResourceInput = {
  name: "",
  role: "software_engineer",
  email: "",
  notes: null,
};

function roleLabel(roles: RoleItem[], code: ResourceRole): string {
  return roles.find((r) => r.code === code)?.label ?? code;
}

export function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<ResourceRole | "">("");
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
  const [deleteTarget, setDeleteTarget] = useState<Resource | null>(null);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listResources({
        q: search.trim() || undefined,
        role: filterRole || undefined,
        project_id: filterProject || undefined,
      });
      setResources(list.items);
      setTotal(list.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load resources");
    } finally {
      setLoading(false);
    }
  }, [search, filterRole, filterProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of resources) {
      counts[r.role] = (counts[r.role] ?? 0) + 1;
    }
    return counts;
  }, [resources]);

  const hasFilters = Boolean(search.trim() || filterRole || filterProject);

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
      await load();
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
      setError(err instanceof Error ? err.message : "Delete failed");
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
      await load();
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
                    <RoleBadge role={r.role} displayLabel={roleLabel(roles, r.role)} />
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
                        <li key={a.project_id}>
                          <Link to={`/projects/${a.project_id}`}>
                            {projectListLabel(
                              a.project_name,
                              !a.parent_name,
                              a.parent_name,
                            )}
                          </Link>
                          <span className="muted">
                            {" "}
                            — {projectRoleLabel(a.project_role)} — {a.utilization_percent}%
                          </span>
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
        message={
          deleteTarget
            ? `${deleteTarget.name} will be removed permanently. This cannot be undone.`
            : ""
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </AppShell>
  );
}
