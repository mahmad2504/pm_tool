import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  GroupItem,
  ReportGroup,
  downloadHtmlFile,
  listGroups,
  portfolioReportFilename,
  projectReport,
} from "../api";
import { AppShell } from "../layout/AppShell";
import { buildProjectReportHtml } from "../reportHtml";

export function projectReportPath(query: string, groupId: number | ""): string {
  const params = new URLSearchParams();
  const q = query.trim();
  if (q) params.set("q", q);
  if (groupId) params.set("group", String(groupId));
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
  const [searchInput, setSearchInput] = useState(q);
  const [groups, setGroups] = useState<GroupItem[] | null>(null);
  const [reportGroups, setReportGroups] = useState<ReportGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    listGroups().then(setGroups).catch(() => setGroups([]));
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
  }, [q, groupFilter]);

  const filterLabel = filterText(groups, q, groupFilter);
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
            Portfolio view of projects, people, and the latest status. Search and group stay in
            the address, so this page can be opened directly.
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
            placeholder="Search name, description, or group…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <select
          className="filter-select"
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
      </div>

      <section className="report-page">
        {loading && <p className="muted">Loading…</p>}
        {html && <iframe className="report-page__frame" title="Project report" srcDoc={html} />}
      </section>
    </AppShell>
  );
}

function filterText(groups: GroupItem[] | null, query: string, groupId: number | ""): string {
  const groupName = groupId
    ? (groups?.find((group) => group.id === groupId)?.name ?? "group")
    : "all groups";
  return query ? `${groupName} ${query}` : groupName;
}
