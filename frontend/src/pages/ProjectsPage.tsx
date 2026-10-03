import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  GroupItem,
  projectRoleLabel,
  ProjectSummary,
  PROJECT_STATUSES,
  ProjectStatus,
  TagItem,
  createRootProject,
  downloadProjectsExport,
  projectsExportFilename,
  getProject,
  groupIconSrc,
  listGroups,
  listProjects,
  listTags,
  patchProject,
  updateGroup,
  uploadGroupIcon,
} from "../api";
import { OnboardedIcon } from "../components/OnboardedIcon";
import { ProjectStatusSelect } from "../components/ProjectStatusBadge";
import { PeopleNameHover, SubProjectPeopleHint } from "../components/SubProjectPeopleHint";
import { TagChips, TagEditor, tagsWithDraft } from "../components/TagEditor";
import { AppShell } from "../layout/AppShell";
import { groupReportPath } from "./GroupReportPage";
import { projectReportPath } from "./ReportPage";
import { formatUpdated } from "../reportHtml";

const REPORT_FRESH_DAYS = 7;

function subReportFreshness(
  reportedAt: string | null,
  today = new Date(),
): "today" | "fresh" | "stale" | null {
  if (!reportedAt) return null;
  const reported = new Date(reportedAt);
  if (Number.isNaN(reported.getTime())) return null;
  const reportDay = new Date(reported.getFullYear(), reported.getMonth(), reported.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (todayDay.getTime() === reportDay.getTime()) return "today";
  const staleOn = new Date(reportDay);
  staleOn.setDate(staleOn.getDate() + REPORT_FRESH_DAYS);
  return todayDay >= staleOn ? "stale" : "fresh";
}

function reportChipAppearance(
  reportsWithPmo: boolean,
  latestReportAt: string | null,
): { className?: string; title?: string } {
  if (reportsWithPmo === false) {
    return {
      className: "project-card__sub--not-pmo",
      title: "Reporting is not with PMO",
    };
  }
  const reportFreshness = subReportFreshness(latestReportAt);
  if (reportFreshness === "today") {
    return { className: "project-card__sub--today", title: "Report updated today" };
  }
  if (reportFreshness === "fresh") {
    return { className: "project-card__sub--fresh", title: "Report within 7 days" };
  }
  if (reportFreshness === "stale") {
    return { className: "project-card__sub--stale", title: "Report is 7 days old" };
  }
  return {};
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
  const [tags, setTags] = useState<TagItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<number | "">("");
  const [tagFilter, setTagFilter] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [peopleTarget, setPeopleTarget] = useState<ProjectSummary | null>(null);
  const [peopleRows, setPeopleRows] = useState<
    {
      key: string;
      projectName: string;
      resourceId: number;
      resourceName: string;
      roleLabel: string;
      utilization: number;
      onboarded: boolean;
      duplicate: boolean;
    }[]
  >([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    group_name: "",
    status: "assessment" as ProjectStatus,
    tags: [] as string[],
  });
  const [groupMode, setGroupMode] = useState<"existing" | "new">("new");
  const [groupEditor, setGroupEditor] = useState<GroupItem | null>(null);
  const [groupName, setGroupName] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [groupSaving, setGroupSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportReports, setExportReports] = useState("3");
  const [exportFileName, setExportFileName] = useState("");
  const [exporting, setExporting] = useState(false);
  const createTagDraft = useRef<string | null>("");

  useEffect(() => {
    listGroups().then(setGroups).catch(() => setGroups([]));
    listTags().then(setTags).catch(() => setTags([]));
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
        tag_id: tagFilter || undefined,
        roots_only: true,
      });
      setProjects(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [search, groupFilter, tagFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeProjectStatus(projectId: number, status: ProjectStatus) {
    try {
      await patchProject(projectId, { status });
      setProjects((current) =>
        current.map((item) => (item.id === projectId ? { ...item, status } : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  }

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
      const counts = new Map<number, number>();
      for (const detail of details) {
        for (const assignment of detail.resources) {
          counts.set(assignment.resource.id, (counts.get(assignment.resource.id) ?? 0) + 1);
        }
      }
      setPeopleRows(
        details.flatMap((detail) =>
          detail.resources.map((assignment) => ({
            key: `${detail.id}-${assignment.resource.id}`,
            resourceId: assignment.resource.id,
            projectName: detail.name,
            resourceName: assignment.resource.name,
            roleLabel: projectRoleLabel(assignment.project_role),
            utilization: assignment.utilization_percent,
            onboarded: assignment.onboarded,
            duplicate: (counts.get(assignment.resource.id) ?? 0) > 1,
          })),
        ),
      );
    } catch (err) {
      setPeopleError(err instanceof Error ? err.message : "Failed to load people");
    } finally {
      setPeopleLoading(false);
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
          tag_id: tagFilter || undefined,
          roots_only: true,
        }),
      ]);
      setGroups(nextGroups);
      setTags(await listTags());
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
    const tagName = tagFilter ? (tags.find((tag) => tag.id === tagFilter)?.name ?? "tag") : "";
    const query = search.trim();
    return [groupName, tagName, query].filter(Boolean).join(" ");
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
        tag_id: tagFilter || undefined,
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
        status: form.status,
        tags: tagsWithDraft(form.tags, createTagDraft.current ?? ""),
      });
      setModalOpen(false);
      setForm({ name: "", description: "", group_name: "", status: "assessment", tags: [] });
      setGroupMode(groups.length > 0 ? "existing" : "new");
      await load();
      listGroups().then(setGroups).catch(() => {});
      listTags().then(setTags).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setForm({ name: "", description: "", group_name: "", status: "assessment", tags: [] });
    setGroupMode(groups.length > 0 ? "existing" : "new");
    setModalOpen(true);
    listGroups()
      .then((items) => {
        setGroups(items);
        setGroupMode(items.length > 0 ? "existing" : "new");
      })
      .catch(() => setGroupMode("new"));
  }

  return (
    <AppShell>
      <header className="main-header">
        <div>
          <h1>Projects</h1>
          <p className="subtitle">
            Every root project belongs to a group. Add tags on a project or sub-project, then
            filter this list by group or tag.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={openCreate}>
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
              placeholder="Search name, description, group, or tag…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <select
            className="filter-select"
            aria-label="Filter by group"
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
          <select
            className="filter-select"
            aria-label="Filter by tag"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name} ({tag.project_count})
              </option>
            ))}
          </select>
          <Link className="btn btn--secondary" to={projectReportPath(search, groupFilter, tagFilter)}>
            Report
          </Link>
          <Link className="btn btn--secondary" to={groupReportPath(search, groupFilter, tagFilter)}>
            Group reports
          </Link>
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
            {search.trim() || groupFilter || tagFilter ? (
              <>
                <h2>No matching projects</h2>
                <p>Nothing matches the current search, group, or tag.</p>
              </>
            ) : (
              <>
                <h2>No projects yet</h2>
                <p>Create a root project to get started.</p>
                <button type="button" className="btn btn--primary" onClick={openCreate}>
                  Create project
                </button>
              </>
            )}
          </div>
        ) : (
          <ul className="resource-grid">
            {projects.map((p) => {
              const duplicates = p.duplicate_resources ?? [];
              const emptyChip = reportChipAppearance(p.reports_with_pmo, p.latest_report_at);
              return (
              <li key={p.id} className="resource-card project-card">
                <div className="project-card__head">
                  {p.group_name && p.group_id != null && (
                    <GroupMark
                      name={p.group_name}
                      iconUrl={p.group_icon_url}
                      onClick={() => openGroupEditor(p)}
                    />
                  )}
                  <TagChips
                    tags={p.tags}
                    activeId={tagFilter}
                    onSelect={(tagId) =>
                      setTagFilter((current) => (current === tagId ? "" : tagId))
                    }
                  />
                  <div className="project-card__head-actions">
                    <ProjectStatusSelect
                      status={p.status}
                      reportsWithPmo={p.reports_with_pmo}
                      label={`Status for ${p.name}`}
                      onChange={(status) => void changeProjectStatus(p.id, status)}
                    />
                    <PeopleNameHover
                      projectIds={[p.id, ...p.sub_projects.map((sub) => sub.id)]}
                      mainProjectId={p.id}
                      duplicateResources={duplicates}
                      className="project-card__people-hover"
                      align="end"
                    >
                      <button
                        type="button"
                        className={
                          duplicates.length
                            ? "project-card__people project-card__people--duplicate"
                            : "project-card__people"
                        }
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
                    </PeopleNameHover>
                  </div>
                </div>
                <h3 className="project-card__title">
                  <Link to={`/projects/${p.id}`}>{p.name}</Link>
                </h3>
                {p.sub_projects.length > 0 ? (
                  <ul className="project-card__subs">
                    {p.sub_projects.map((sub) => {
                      const chip = reportChipAppearance(sub.reports_with_pmo, sub.latest_report_at);
                      return (
                        <li key={sub.id}>
                          <Link
                            to={`/projects/${sub.id}`}
                            className={chip.className}
                            title={chip.title}
                          >
                            {sub.name}
                            {sub.resource_count > 0 && (
                              <SubProjectPeopleHint
                                projectId={sub.id}
                                count={sub.resource_count}
                              />
                            )}
                          </Link>
                          <TagChips
                            tags={sub.tags}
                            activeId={tagFilter}
                            onSelect={(tagId) =>
                              setTagFilter((current) => (current === tagId ? "" : tagId))
                            }
                          />
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="project-card__subs">
                    <li>
                      <span
                        className={["project-card__sub", emptyChip.className].filter(Boolean).join(" ")}
                        title={emptyChip.title}
                      >
                        No sub-projects
                      </span>
                    </li>
                  </ul>
                )}
                <div className="project-card__footer">
                  <Link className="btn btn--ghost btn--sm" to={`/projects/${p.id}`}>
                    Open →
                  </Link>
                  <p className="project-card__updated">
                    Last updated <time dateTime={p.updated_at}>{formatUpdated(p.updated_at)}</time>
                  </p>
                </div>
              </li>
              );
            })}
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
              Exports {total} root project{total === 1 ? "" : "s"} matching the current search,
              group, and tag filters. Each project is one JSONL line, with people, sub-projects,
              tags, and the latest status reports.
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
                    {row.projectName} -&gt;{" "}
                    <span className={row.duplicate ? "people-dialog__duplicate" : undefined}>
                      {row.resourceName}
                    </span>{" "}
                    -&gt; {row.roleLabel} -&gt; {row.utilization}%
                    {row.onboarded ? <OnboardedIcon /> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
            <header className="modal__header">
              <h2 id="new-project-title">New root project</h2>
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
              <fieldset className="group-choice">
                <legend>Group</legend>
                <div className="group-choice__modes">
                  <label className="group-choice__option">
                    <input
                      type="radio"
                      name="group-mode"
                      checked={groupMode === "existing"}
                      disabled={groups.length === 0}
                      onChange={() => {
                        setGroupMode("existing");
                        setForm({ ...form, group_name: "" });
                      }}
                    />
                    Existing group
                  </label>
                  <label className="group-choice__option">
                    <input
                      type="radio"
                      name="group-mode"
                      checked={groupMode === "new"}
                      onChange={() => {
                        setGroupMode("new");
                        setForm({ ...form, group_name: "" });
                      }}
                    />
                    New group
                  </label>
                </div>
                {groupMode === "existing" ? (
                  <select
                    required
                    value={form.group_name}
                    onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                  >
                    <option value="">Select a group</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.name}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    placeholder="Group name"
                    value={form.group_name}
                    onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                  />
                )}
              </fieldset>
              <label>
                Status
                <select
                  required
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as ProjectStatus })
                  }
                >
                  {PROJECT_STATUSES.map((status) => (
                    <option key={status.code} value={status.code}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <div className="tag-field">
                <span className="tag-field__label">Tags</span>
                <TagEditor
                  tags={form.tags}
                  suggestions={tags.map((tag) => tag.name)}
                  onChange={(next) => setForm({ ...form, tags: next })}
                  disabled={saving}
                  draftRef={createTagDraft}
                />
              </div>
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
