import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  RESOURCE_LOCATIONS,
  ProjectSummary,
  Resource,
  ResourceLocation,
  ResourceRole,
  RoleItem,
  downloadHtmlFile,
  listProjects,
  listRoles,
  resourceReport,
  resourceReportFilename,
} from "../api";
import { AppShell } from "../layout/AppShell";
import { buildResourceReportHtml } from "../resourceReportHtml";
import { resourceReportSortFromParam, sortResourceReport } from "../resourceReportSort";
import { projectListLabel } from "../utils/projectLabel";

const ROLES: ResourceRole[] = [
  "software_engineer",
  "it_engineer",
  "hardware_engineer",
  "analog_design_engineer",
  "pd_engineer",
  "lead",
];

export function resourceReportPath(
  query: string,
  role: ResourceRole | "",
  projectId: number | "",
  location: ResourceLocation | "" = "",
): string {
  const params = new URLSearchParams();
  const q = query.trim();
  if (q) params.set("q", q);
  if (role) params.set("role", role);
  if (location) params.set("location", location);
  if (projectId) params.set("project", String(projectId));
  const search = params.toString();
  return search ? `/resources/report?${search}` : "/resources/report";
}

function roleFromParam(value: string | null): ResourceRole | "" {
  if (value && ROLES.includes(value as ResourceRole)) return value as ResourceRole;
  return "";
}

function locationFromParam(value: string | null): ResourceLocation | "" {
  if (value && RESOURCE_LOCATIONS.some((location) => location.code === value)) {
    return value as ResourceLocation;
  }
  return "";
}

function projectIdFromParam(value: string | null): number | "" {
  if (!value) return "";
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : "";
}

export function ResourceReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const roleFilter = roleFromParam(searchParams.get("role"));
  const locationFilter = locationFromParam(searchParams.get("location"));
  const projectFilter = projectIdFromParam(searchParams.get("project"));
  const sort = resourceReportSortFromParam(searchParams.get("sort"));
  const [searchInput, setSearchInput] = useState(q);
  const [roles, setRoles] = useState<RoleItem[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [people, setPeople] = useState<Resource[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    listRoles().then(setRoles).catch(() => setRoles([]));
    listProjects({ limit: 200 })
      .then((data) => setProjects(data.items))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = searchInput.trim();
      if (next === q) return;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next) params.set("q", next);
          else params.delete("q");
          return params;
        },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, q, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPeople(null);
    resourceReport({
      q: q || undefined,
      role: roleFilter || undefined,
      location: locationFilter || undefined,
      project_id: projectFilter || undefined,
    })
      .then((data) => {
        if (!cancelled) setPeople(data.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setPeople(null);
          setError(err instanceof Error ? err.message : "Failed to load the report");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, roleFilter, locationFilter, projectFilter]);

  const hasFilters = Boolean(q || roleFilter || locationFilter || projectFilter);
  const filterLabel = filterText(roles, projects, q, roleFilter, locationFilter, projectFilter);
  const sortedPeople = useMemo(
    () => (people && roles ? sortResourceReport(people, sort, roles) : null),
    [people, roles, sort],
  );
  const html = useMemo(() => {
    if (!roles || !projects || !sortedPeople) return null;
    return buildResourceReportHtml(
      sortedPeople,
      roles,
      filterLabel,
      hasFilters ? "No people match this filter." : "No people yet.",
      sort,
    );
  }, [roles, projects, sortedPeople, filterLabel, hasFilters, sort]);

  function changeRole(value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value) params.set("role", value);
        else params.delete("role");
        return params;
      },
      { replace: true },
    );
  }

  function changeSort(value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value) params.set("sort", value);
        else params.delete("sort");
        return params;
      },
      { replace: true },
    );
  }

  function changeLocation(value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value) params.set("location", value);
        else params.delete("location");
        return params;
      },
      { replace: true },
    );
  }

  function changeProject(value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value) params.set("project", value);
        else params.delete("project");
        return params;
      },
      { replace: true },
    );
  }

  function exportHtml() {
    if (!html) return;
    setExporting(true);
    try {
      downloadHtmlFile(html, resourceReportFilename(filterLabel));
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell wide>
      <header className="main-header">
        <div>
          <h1>Resource report</h1>
          <p className="subtitle">
            Every person, their utilization, and the projects they are on. Search, role,
            location, project, and sort stay in the address, so this page can be opened directly.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!html || exporting}
          onClick={exportHtml}
        >
          {exporting ? "Exporting…" : "Export HTML"}
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

      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon" aria-hidden>
            ⌕
          </span>
          <input
            className="search-input"
            placeholder="Search by name or email…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <select
          className="filter-select"
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(event) => changeRole(event.target.value)}
        >
          <option value="">All roles</option>
          {(roles ?? []).map((role) => (
            <option key={role.code} value={role.code}>
              {role.label}
            </option>
          ))}
          </select>
        <select
          className="filter-select"
          aria-label="Filter by location"
          value={locationFilter}
          onChange={(event) => changeLocation(event.target.value)}
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
          aria-label="Filter by project"
          value={projectFilter}
          onChange={(event) => changeProject(event.target.value)}
        >
          <option value="">All projects</option>
          {(projects ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {projectListLabel(project.name, project.is_root, project.parent_name)}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          aria-label="Sort by"
          value={sort === "name" ? "" : sort}
          onChange={(event) => changeSort(event.target.value)}
        >
          <option value="">Name</option>
          <option value="name_desc">Name, Z to A</option>
          <option value="utilization">Utilization, highest first</option>
          <option value="utilization_asc">Utilization, lowest first</option>
          <option value="role">Organization role</option>
          <option value="email">Email</option>
        </select>
      </div>

      <section className="report-page">
        {loading && <p className="muted">Loading…</p>}
        {html && (
          <iframe className="report-page__frame" title="Resource utilization report" srcDoc={html} />
        )}
      </section>
    </AppShell>
  );
}

function filterText(
  roles: RoleItem[] | null,
  projects: ProjectSummary[] | null,
  query: string,
  role: ResourceRole | "",
  location: ResourceLocation | "",
  projectId: number | "",
): string {
  const roleName = role
    ? (roles?.find((item) => item.code === role)?.label ?? "role")
    : "all roles";
  const project = projectId ? projects?.find((item) => item.id === projectId) : undefined;
  const projectName = projectId
    ? project
      ? projectListLabel(project.name, project.is_root, project.parent_name)
      : "project"
    : "";
  return [roleName, location, projectName, query].filter(Boolean).join(" ");
}
