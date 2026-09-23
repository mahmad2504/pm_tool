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
  createResource,
  deleteResource,
  importResources,
  listResources,
  listRoles,
  templateCsvUrl,
  updateResource,
} from "./api";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ResourceModal } from "./components/ResourceModal";
import { RoleBadge } from "./components/RoleBadge";
import { avatarHue, initials } from "./utils";

const emptyForm: ResourceInput = {
  name: "",
  role: "software_engineer",
  email: "",
  notes: null,
};

function roleLabel(roles: RoleItem[], code: ResourceRole): string {
  return roles.find((r) => r.code === code)?.label ?? code;
}

export default function App() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<ResourceRole | "">("");
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
      });
      setResources(list.items);
      setTotal(list.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load resources");
    } finally {
      setLoading(false);
    }
  }, [search, filterRole]);

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

  const hasFilters = Boolean(search.trim() || filterRole);

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
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo">PM</span>
          <div>
            <strong>PM Tool</strong>
            <span className="sidebar__tag">Resources</span>
          </div>
        </div>
        <nav className="sidebar__nav">
          <span className="nav-item nav-item--active">People</span>
        </nav>
        <a
          className="sidebar__link"
          href="http://localhost:8000/docs"
          target="_blank"
          rel="noreferrer"
        >
          API documentation →
        </a>
      </aside>

      <main className="main">
        <header className="main-header">
          <div>
            <h1>People resources</h1>
            <p className="subtitle">
              Engineers and leads you can assign to projects later.
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
                  ? "Try a different search or clear the role filter."
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
      </main>

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
    </div>
  );
}
