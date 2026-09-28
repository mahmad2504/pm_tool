import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  GroupItem,
  TagItem,
  ReportGroup,
  downloadHtmlFile,
  listGroups,
  listTags,
  portfolioReportFilename,
  projectReport,
} from "../api";
import { AppShell } from "../layout/AppShell";
import { buildProjectReportHtml } from "../reportHtml";

export function projectReportPath(
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
  return search ? `/report?${search}` : "/report";
}

function groupIdFromParam(value: string | null): number | "" {
  if (!value) return "";
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : "";
}

export function ReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const groupFilter = groupIdFromParam(searchParams.get("group"));
  const tagFilter = groupIdFromParam(searchParams.get("tag"));
  const [searchInput, setSearchInput] = useState(q);
  const [groups, setGroups] = useState<GroupItem[] | null>(null);
  const [tags, setTags] = useState<TagItem[] | null>(null);
  const [reportGroups, setReportGroups] = useState<ReportGroup[] | null>(null);
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
    })
      .then((data) => {
        if (!cancelled) setReportGroups(data.groups);
      })
      .catch((err) => {
        if (!cancelled) {
          setReportGroups(null);
          setError(err instanceof Error ? err.message : "Failed to load the report");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, groupFilter, tagFilter]);

  const filterLabel = filterText(groups, tags, q, groupFilter, tagFilter);
  const html = useMemo(() => {
    if (!groups || !reportGroups) return null;
    return buildProjectReportHtml(reportGroups, `Filter: ${filterLabel}`);
  }, [groups, reportGroups, filterLabel]);

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

  function exportHtml() {
    if (!html) return;
    setExporting(true);
    try {
      downloadHtmlFile(html, portfolioReportFilename(filterLabel));
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell wide>
      <header className="main-header">
        <div>
          <h1>Project report</h1>
          <p className="subtitle">
            Portfolio view of projects, people, and the latest status. Search, group, and tag stay
            in the address, so this page can be opened directly.
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
      </div>

      <section className="report-page">
        {loading && <p className="muted">Loading…</p>}
        {html && <iframe className="report-page__frame" title="Project report" srcDoc={html} />}
      </section>
    </AppShell>
  );
}

function filterText(
  groups: GroupItem[] | null,
  tags: TagItem[] | null,
  query: string,
  groupId: number | "",
  tagId: number | "",
): string {
  const groupName = groupId
    ? (groups?.find((group) => group.id === groupId)?.name ?? "group")
    : "all groups";
  const tagName = tagId ? (tags?.find((tag) => tag.id === tagId)?.name ?? "tag") : "";
  return [groupName, tagName, query].filter(Boolean).join(" ");
}
