import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  GroupItem,
  ReportGroup,
  TagItem,
  downloadHtmlFile,
  groupReportFilename,
  listGroups,
  listTags,
  projectReport,
} from "../api";
import { AppShell } from "../layout/AppShell";
import { buildProjectReportHtml } from "../reportHtml";

function projectReportPath(query: string, groupId: number | "", tagId: number | ""): string {
  const params = new URLSearchParams();
  const q = query.trim();
  if (q) params.set("q", q);
  if (groupId) params.set("group", String(groupId));
  if (tagId) params.set("tag", String(tagId));
  const search = params.toString();
  return search ? `/report?${search}` : "/report";
}

export function groupReportPath(
  query: string,
  groupId: number | "",
  tagId: number | "" = "",
): string {
  const params = new URLSearchParams();
  const q = query.trim();
  if (q) params.set("q", q);
  if (groupId) params.set("group", String(groupId));
  if (tagId) params.set("tag", String(tagId));
  const search = params.toString();
  return search ? `/report/groups?${search}` : "/report/groups";
}

function idFromParam(value: string | null): number | "" {
  if (!value) return "";
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : "";
}

function groupKey(group: ReportGroup): string {
  return group.id == null ? "none" : String(group.id);
}

function fileFilterLabel(
  groupName: string,
  tags: TagItem[] | null,
  query: string,
  tagId: number | "",
): string {
  const tagName = tagId ? (tags?.find((tag) => tag.id === tagId)?.name ?? "tag") : "";
  return [groupName, tagName, query].filter(Boolean).join(" ");
}

function htmlForGroup(
  group: ReportGroup,
  tags: TagItem[] | null,
  query: string,
  tagId: number | "",
): string {
  return buildProjectReportHtml([group], `Filter: ${fileFilterLabel(group.name, tags, query, tagId)}`, {
    title: `Project report — ${group.name}`,
    hideCrossGroupNotes: true,
  });
}

export function GroupReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const groupFilter = idFromParam(searchParams.get("group"));
  const tagFilter = idFromParam(searchParams.get("tag"));
  const [searchInput, setSearchInput] = useState(q);
  const [groups, setGroups] = useState<GroupItem[] | null>(null);
  const [tags, setTags] = useState<TagItem[] | null>(null);
  const [reportGroups, setReportGroups] = useState<ReportGroup[] | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    listGroups().then(setGroups).catch(() => setGroups([]));
    listTags().then(setTags).catch(() => setTags([]));
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
    setReportGroups(null);
    projectReport({
      q: q || undefined,
      group_id: groupFilter || undefined,
      tag_id: tagFilter || undefined,
      isolate_groups: true,
    })
      .then((data) => {
        if (!cancelled) setReportGroups(data.groups);
      })
      .catch((err) => {
        if (!cancelled) {
          setReportGroups(null);
          setError(err instanceof Error ? err.message : "Failed to load group reports");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, groupFilter, tagFilter]);

  useEffect(() => {
    if (!reportGroups || reportGroups.length === 0) {
      setPreviewKey("");
      return;
    }
    setPreviewKey((current) =>
      reportGroups.some((group) => groupKey(group) === current) ? current : groupKey(reportGroups[0]),
    );
  }, [reportGroups]);

  const selected = reportGroups?.find((group) => groupKey(group) === previewKey) ?? null;
  const html = useMemo(() => {
    if (!selected) return null;
    return htmlForGroup(selected, tags, q, tagFilter);
  }, [selected, tags, q, tagFilter]);

  function changeGroup(value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value) params.set("group", value);
        else params.delete("group");
        return params;
      },
      { replace: true },
    );
  }

  function changeTag(value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value) params.set("tag", value);
        else params.delete("tag");
        return params;
      },
      { replace: true },
    );
  }

  function exportSelected() {
    if (!selected || !html) return;
    setExporting(true);
    try {
      downloadHtmlFile(html, groupReportFilename(selected.name));
    } finally {
      setExporting(false);
    }
  }

  async function exportEveryGroup() {
    if (!reportGroups || reportGroups.length === 0) return;
    setExporting(true);
    try {
      for (const group of reportGroups) {
        downloadHtmlFile(htmlForGroup(group, tags, q, tagFilter), groupReportFilename(group.name));
        await new Promise((resolve) => window.setTimeout(resolve, 400));
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell wide>
      <header className="main-header">
        <div>
          <h1>Group reports</h1>
          <p className="subtitle">
            The same project report, one file per group. People who also work in other groups appear
            here only with this group’s projects.
          </p>
        </div>
        <div className="header-actions">
          <Link className="btn btn--secondary" to={projectReportPath(q, groupFilter, tagFilter)}>
            Project report
          </Link>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={!selected || exporting}
            onClick={exportSelected}
          >
            {exporting ? "Exporting…" : "Export this group"}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!reportGroups?.length || exporting}
            onClick={() => void exportEveryGroup()}
          >
            {exporting ? "Exporting…" : "Export every group"}
          </button>
        </div>
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
            placeholder="Search name, description, group, or tag…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <select
          className="filter-select"
          aria-label="Filter by group"
          value={groupFilter}
          onChange={(event) => changeGroup(event.target.value)}
        >
          <option value="">All groups</option>
          {(groups ?? []).map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} ({group.project_count})
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          aria-label="Filter by tag"
          value={tagFilter}
          onChange={(event) => changeTag(event.target.value)}
        >
          <option value="">All tags</option>
          {(tags ?? []).map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name} ({tag.project_count})
            </option>
          ))}
        </select>
        {reportGroups && reportGroups.length > 1 && (
          <select
            className="filter-select"
            aria-label="Preview group"
            value={previewKey}
            onChange={(event) => setPreviewKey(event.target.value)}
          >
            {reportGroups.map((group) => (
              <option key={groupKey(group)} value={groupKey(group)}>
                {group.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <section className="report-page">
        {loading && <p className="muted">Loading…</p>}
        {!loading && reportGroups && reportGroups.length === 0 && (
          <p className="muted">No projects match this filter.</p>
        )}
        {html && <iframe className="report-page__frame" title="Group report" srcDoc={html} />}
      </section>
    </AppShell>
  );
}
