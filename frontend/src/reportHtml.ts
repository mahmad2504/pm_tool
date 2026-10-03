import {
  projectStatusLabel,
  ProjectStatus,
  ReportGroup,
  ReportProject,
  ReportSharedResource,
} from "./api";

export function formatUpdated(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function countCell(
  count: number,
  kind: "resources" | "unique" | "shared" | "group-shared",
  key: string,
  label: string,
): string {
  if (count === 0) return "0";
  return `<button type="button" class="count-btn" data-kind="${kind}" data-key="${escapeHtml(key)}" data-label="${escapeHtml(label)}">${count}</button>`;
}

const groupTones = ["sw", "dv", "ai", "na"] as const;

function textBlock(value: string | null | undefined, empty = "Not available."): string {
  const text = value?.trim();
  if (!text) return empty;
  return escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>");
}

function toneForGroup(name: string, index: number): (typeof groupTones)[number] {
  const normalized = name.toLowerCase();
  if (normalized.includes("physical ai") || /\bai\b/.test(normalized)) return "ai";
  if (normalized.includes("verification")) return "dv";
  if (normalized.includes("software")) return "sw";
  if (normalized.includes("non-altera") || normalized.includes("non altera")) return "na";
  return groupTones[index % groupTones.length];
}

function uniquePeople(
  people: ReportSharedResource[],
  sharedPeople: ReportSharedResource[],
): ReportSharedResource[] {
  const sharedIds = new Set(sharedPeople.map((person) => person.id));
  return people.filter((person) => !sharedIds.has(person.id));
}

function sharedProjectLink(
  items: string[],
  key: string,
  label: string,
  shareProjects: Record<string, string[]>,
): string {
  if (items.length === 0) return "";
  shareProjects[key] = items;
  const text = items.length === 1 ? "1 project" : `${items.length} projects`;
  const hidden = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<button type="button" class="count-btn share-projects-btn" data-kind="share-projects" data-key="${escapeHtml(key)}" data-label="${escapeHtml(label)}">${text}</button><ul class="share-projects-print">${hidden}</ul>`;
}

function elsewhereLabels(people: ReportSharedResource[], homeIds: Set<number>): string[] {
  const labels = new Set<string>();
  for (const person of people) {
    for (const assignment of person.assignments) {
      if (homeIds.has(assignment.project_id)) continue;
      const name = assignment.parent_name
        ? `${assignment.parent_name} / ${assignment.project_name}`
        : assignment.project_name;
      labels.add(assignment.group_name ? `${assignment.group_name} · ${name}` : name);
    }
  }
  return [...labels];
}

function resourceCell(
  people: ReportSharedResource[],
  sharedPeople: ReportSharedResource[],
  resourceKey: string,
  label: string,
  homeIds: Set<number>,
  shareProjects: Record<string, string[]>,
): string {
  const total = countCell(people.length, "resources", resourceKey, label);
  if (sharedPeople.length === 0) return total;
  const projects = sharedProjectLink(
    elsewhereLabels(sharedPeople, homeIds),
    resourceKey,
    label,
    shareProjects,
  );
  const shared = countCell(sharedPeople.length, "shared", resourceKey, label);
  const sharedPhrase = projects ? `${shared} shared with ${projects}` : `${shared} shared`;
  const uniqueCount = uniquePeople(people, sharedPeople).length;
  if (uniqueCount <= 0) return `<div>${sharedPhrase}</div>`;
  const unique = countCell(uniqueCount, "unique", resourceKey, label);
  return `<div class="res-line">${total}</div><ul class="share-list"><li>${unique} unique</li><li>${sharedPhrase}</li></ul>`;
}

function stateCell(status: ProjectStatus): string {
  return escapeHtml(projectStatusLabel(status));
}

const STATUS_REPORT_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function statusReportIsStale(reportedAt: string | null | undefined): boolean {
  if (!reportedAt) return false;
  const reported = new Date(reportedAt).getTime();
  if (Number.isNaN(reported)) return false;
  return Date.now() - reported > STATUS_REPORT_STALE_MS;
}

const REPORT_PREVIEW_MAX_CHARS = 120;

function textThroughFirstBlank(value: string): { preview: string; hasMore: boolean } {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const breakAt = normalized.search(/\n[ \t]*\n/);
  if (breakAt === -1) return { preview: normalized, hasMore: false };
  const preview = normalized.slice(0, breakAt).trim();
  const rest = normalized.slice(breakAt).trim();
  if (!preview || !rest) return { preview: normalized, hasMore: false };
  return { preview, hasMore: true };
}

function shortenToLength(text: string, maxChars: number): { text: string; shortened: boolean } {
  if (text.length <= maxChars) return { text, shortened: false };
  const window = text.slice(0, maxChars);
  const lastBreak = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\n"));
  const cutAt = lastBreak >= Math.floor(maxChars * 0.5) ? lastBreak : maxChars;
  const trimmed = window.slice(0, cutAt).replace(/[\s.,;:!?]+$/g, "").trimEnd();
  const preview = trimmed || window.trimEnd();
  return { text: `${preview}...`, shortened: true };
}

function clippedTextCell(
  raw: string,
  textKey: string,
  label: string,
  store: Record<string, string>,
  linkText: string,
  kind: "status" | "description",
  maxChars?: number,
): string {
  const throughBlank = textThroughFirstBlank(raw);
  const limited = maxChars ? shortenToLength(throughBlank.preview, maxChars) : { text: throughBlank.preview, shortened: false };
  const preview = limited.text;
  const hasMore = throughBlank.hasMore || limited.shortened;
  if (!hasMore) return textBlock(preview);
  store[textKey] = raw;
  const button = `<button type="button" class="status-more" data-text-kind="${kind}" data-status-key="${escapeHtml(textKey)}" data-label="${escapeHtml(label)}">${escapeHtml(linkText)}</button>`;
  return `<span class="status-screen">${textBlock(preview)} ${button}</span><span class="status-full-print">${textBlock(raw)}</span>`;
}

function descriptionCell(
  body: string | null | undefined,
  textKey: string,
  label: string,
  descriptions: Record<string, string>,
): string {
  const raw = body?.trim();
  if (!raw) return "Not available.";
  return clippedTextCell(
    raw,
    textKey,
    label,
    descriptions,
    "See complete description",
    "description",
    REPORT_PREVIEW_MAX_CHARS,
  );
}

const NOT_WITH_PMO_STATUS = "Status not available. Reporting is not with PMO.";
const SUB_PROJECT_STATUS_HINT = "Click to view individual project status.";

function statusCell(
  body: string | null | undefined,
  reportedAt: string | null | undefined,
  statusKey: string,
  label: string,
  statuses: Record<string, string>,
  reportsWithPmo: boolean,
): { className: string; html: string } {
  if (!reportsWithPmo) {
    return { className: "st st-not-pmo", html: escapeHtml(NOT_WITH_PMO_STATUS) };
  }
  const raw = body?.trim();
  if (!raw) return { className: "st", html: "" };
  const stale = statusReportIsStale(reportedAt);
  const statusHtml = clippedTextCell(raw, statusKey, label, statuses, "View complete status", "status", REPORT_PREVIEW_MAX_CHARS);
  return {
    className: stale ? "st st-stale" : "st st-reported",
    html: stale
      ? `<div class="status-stack"><div class="status-main">${statusHtml}</div><p class="status-week-note">No update for this week</p></div>`
      : statusHtml,
  };
}

function outsideProjectLabels(people: ReportSharedResource[], groupName: string): string[] {
  const labels = new Set<string>();
  for (const person of people) {
    for (const assignment of person.assignments) {
      if ((assignment.group_name || "No group") === groupName) continue;
      const name = assignment.parent_name
        ? `${assignment.parent_name} / ${assignment.project_name}`
        : assignment.project_name;
      labels.add(assignment.group_name ? `${assignment.group_name} · ${name}` : name);
    }
  }
  return [...labels];
}

function groupResourceNote(
  group: ReportGroup,
  key: string,
  shareProjects: Record<string, string[]>,
  hideCrossGroupNotes = false,
): string {
  if (group.resources.length === 0) return "None assigned";
  if (hideCrossGroupNotes) return "";
  const shared = group.shared_with_other_groups;
  if (shared.length === 0) return "No sharing across groups";
  const projects = sharedProjectLink(
    outsideProjectLabels(shared, group.name),
    `${key}-other`,
    group.name,
    shareProjects,
  );
  const sharedCount = countCell(shared.length, "group-shared", `${key}-other`, group.name);
  const sharedPhrase = projects ? `${sharedCount} shared with ${projects}` : `${sharedCount} shared`;
  const uniqueCount = uniquePeople(group.resources, shared).length;
  if (uniqueCount <= 0) return `<div>${sharedPhrase}</div>`;
  const unique = countCell(uniqueCount, "unique", key, group.name);
  return `<div>${unique} unique</div><div>${sharedPhrase}</div>`;
}

function projectTableRows(
  projects: ReportProject[],
  resources: Record<string, ReportSharedResource[]>,
  shared: Record<string, ReportSharedResource[]>,
  unique: Record<string, ReportSharedResource[]>,
  shareProjects: Record<string, string[]>,
  statuses: Record<string, string>,
  descriptions: Record<string, string>,
): string {
  return projects
    .map((project) => {
      const rootKey = `project-${project.id}`;
      resources[rootKey] = project.resources;
      shared[rootKey] = project.shared_resources;
      unique[rootKey] = uniquePeople(project.resources, project.shared_resources);
      const homeIds = new Set([project.id, ...project.sub_projects.map((sub) => sub.id)]);
      const subCount = project.sub_projects.length;
      const subLabel = subCount === 1 ? "1 sub-project" : `${subCount} sub-projects`;
      const expand =
        subCount > 0
          ? `<button type="button" class="expand" aria-expanded="false" aria-label="Show ${subLabel}"><span class="chevron" aria-hidden="true">▶</span> ${subLabel}</button>`
          : "";
      const status =
        project.reports_with_pmo && subCount > 0
          ? {
              className: "st",
              html: `<button type="button" class="status-expand">${escapeHtml(SUB_PROJECT_STATUS_HINT)}</button>`,
            }
          : statusCell(
              project.latest_status,
              project.latest_status_at,
              rootKey,
              project.name,
              statuses,
              project.reports_with_pmo,
            );
      const root = `<tr data-project="${project.id}">
        <td>${escapeHtml(project.name)}${expand}</td>
        <td>${descriptionCell(project.description, rootKey, project.name, descriptions)}</td>
        <td class="res">${resourceCell(project.resources, project.shared_resources, rootKey, project.name, homeIds, shareProjects)}</td>
        <td class="state">${stateCell(project.status)}</td>
        <td class="${status.className}">${status.html}</td>
      </tr>`;
      const subs = project.sub_projects
        .map((sub) => {
          const subKey = `project-${sub.id}`;
          resources[subKey] = sub.resources;
          shared[subKey] = sub.shared_resources;
          unique[subKey] = uniquePeople(sub.resources, sub.shared_resources);
          const label = `${project.name} / ${sub.name}`;
          const subStatus = statusCell(
            sub.latest_status,
            sub.latest_status_at,
            subKey,
            label,
            statuses,
            sub.reports_with_pmo,
          );
          return `<tr class="sub" data-parent="${project.id}">
        <td class="sub-name">${escapeHtml(sub.name)}</td>
        <td>${descriptionCell(sub.description, subKey, label, descriptions)}</td>
        <td class="res">${resourceCell(sub.resources, sub.shared_resources, subKey, label, new Set([sub.id]), shareProjects)}</td>
        <td class="state">${stateCell(sub.status)}</td>
        <td class="${subStatus.className}">${subStatus.html}</td>
      </tr>`;
        })
        .join("");
      return root + subs;
    })
    .join("");
}

export function buildProjectReportHtml(
  groups: ReportGroup[],
  filterLabel: string,
  options?: { title?: string; hideCrossGroupNotes?: boolean },
): string {
  const title = options?.title?.trim() || "Project report";
  const hideCrossGroupNotes = options?.hideCrossGroupNotes === true;
  const generated = formatUpdated(new Date().toISOString());
  const resources: Record<string, ReportSharedResource[]> = {};
  const shared: Record<string, ReportSharedResource[]> = {};
  const unique: Record<string, ReportSharedResource[]> = {};
  const shareProjects: Record<string, string[]> = {};
  const statuses: Record<string, string> = {};
  const descriptions: Record<string, string> = {};
  const projectTotal = groups.reduce((sum, group) => sum + group.project_count, 0);
  const uniqueResources = new Set(groups.flatMap((group) => group.resources.map((person) => person.id)));
  const summaryRows = groups
    .map((group, index) => {
      const tone = toneForGroup(group.name, index);
      const key = `group-${group.id ?? "none"}`;
      resources[key] = group.resources;
      if (!hideCrossGroupNotes) {
        shared[`${key}-other`] = group.shared_with_other_groups;
        unique[key] = uniquePeople(group.resources, group.shared_with_other_groups);
      }
      return `<tr class="row-${tone}">
            <td><span class="tag ${tone}">${escapeHtml(group.name)}</span></td>
            <td class="num">${group.project_count}</td>
            <td class="num">${countCell(group.resources.length, "resources", key, group.name)}</td>
            <td class="notes">${groupResourceNote(group, key, shareProjects, hideCrossGroupNotes)}</td>
          </tr>`;
    })
    .join("");
  const summary = groups.length
    ? `<h2>Summary by project family</h2>
      <table>
        <thead>
          <tr>
            <th>Project family</th>
            <th class="num">Projects</th>
            <th class="num">Engineering resources</th>
            <th class="notes">Resource notes</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRows}
          <tr class="total">
            <td>Total</td>
            <td class="num">${projectTotal}</td>
            <td class="num">${uniqueResources.size}</td>
            <td class="notes"></td>
          </tr>
        </tbody>
      </table>`
    : "";
  const sections = groups
    .map((group, index) => {
      const tone = toneForGroup(group.name, index);
      const rows = projectTableRows(group.projects, resources, shared, unique, shareProjects, statuses, descriptions);
      return `<h2 class="${tone}">Project family — ${escapeHtml(group.name)}</h2>
      <table class="family ${tone}">
        <thead>
          <tr>
            <th>Project</th>
            <th>Description</th>
            <th>Engineering resources</th>
            <th>State</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
    })
    .join("");
  const hasSubProjects = groups.some((group) =>
    group.projects.some((project) => project.sub_projects.length > 0),
  );
  const subToggle = hasSubProjects
    ? `<div class="sub-toggle">
      <button type="button" class="expand-all">Expand all sub-projects</button>
      <button type="button" class="collapse-all">Collapse all sub-projects</button>
    </div>`
    : "";
  const listJson = JSON.stringify({ resources, shared, unique, shareProjects, statuses, descriptions }).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --ink: #1c2430;
      --muted: #5c6570;
      --rule: #d8dde3;
      --paper: #ffffff;
      --wash: #f4f6f8;
      --navy: #16324f;
      --navy-2: #1e4a73;
      --gold: #c9a227;
      --sw: #0f766e;
      --dv: #4338ca;
      --ai: #0369a1;
      --na: #15803d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: #e8ecef;
      font: 15px/1.55 "Calibri", "Segoe UI", Arial, sans-serif;
    }
    .page {
      max-width: 920px;
      margin: 28px auto 48px;
      background: var(--paper);
      border: 1px solid var(--rule);
    }
    .page > header {
      position: relative;
      background: linear-gradient(120deg, #0f2740 0%, #1e4a73 58%, #0f766e 100%);
      color: #fff;
      padding: 28px 36px 24px;
      border-bottom: 5px solid var(--gold);
    }
    .page > header p {
      margin: 0;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.78;
    }
    .page > header h1 {
      margin: 8px 0 6px;
      font-size: 26px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .page > header .sub {
      margin: 0;
      font-size: 14.5px;
      line-height: 1.45;
      opacity: 0.9;
      text-transform: none;
      letter-spacing: 0;
    }
    button.print {
      position: absolute;
      top: 22px;
      right: 28px;
      background: transparent;
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.55);
      padding: 6px 12px;
      cursor: pointer;
      font: inherit;
    }
    .body { padding: 28px 36px 40px; }
    .kpis {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin: 0 0 18px;
    }
    .kpi {
      border: 1px solid var(--rule);
      border-left: 6px solid var(--navy);
      padding: 14px 16px;
      background: #eef4fb;
    }
    .kpi.teal { border-left-color: var(--sw); background: #f0fdfa; }
    .kpi b {
      display: block;
      font-size: 28px;
      font-weight: 600;
      color: var(--navy);
      line-height: 1.1;
    }
    .kpi.teal b { color: var(--sw); }
    .kpi span {
      display: block;
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }
    h2 {
      margin: 28px 0 10px;
      padding: 8px 0 8px 12px;
      border-top: 1px solid var(--rule);
      border-left: 5px solid var(--navy-2);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--navy-2);
    }
    h2.sw { color: var(--sw); border-left-color: var(--sw); }
    h2.dv { color: var(--dv); border-left-color: var(--dv); }
    h2.ai { color: var(--ai); border-left-color: var(--ai); }
    h2:first-of-type { margin-top: 4px; padding-top: 8px; border-top: 0; }
    h2.na { color: var(--na); border-left-color: var(--na); }
    .tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }
    .tag.sw { background: #ccfbf1; color: #115e59; }
    .tag.dv { background: #e0e7ff; color: #3730a3; }
    .tag.ai { background: #e0f2fe; color: #075985; }
    .tag.na { background: #dcfce7; color: #166534; }
    p.lead { margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td {
      border-bottom: 1px solid var(--rule);
      padding: 9px 10px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--navy);
      color: #fff;
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-bottom: 0;
    }
    th.num, td.num { text-align: right; white-space: nowrap; width: 1%; }
    th.notes, td.notes { text-align: right; }
    td.res { width: 24%; }
    td.state { width: 1%; white-space: nowrap; }
    td.st { width: 28%; }
    table.family td.st.st-not-pmo {
      background: #fff4d6;
      color: #7a4e00;
      font-weight: 600;
      box-shadow: inset 4px 0 0 #b45309;
    }
    table.family td.st.st-reported {
      background: #f0fdf4;
      color: #3f6b4e;
      font-weight: 600;
      box-shadow: inset 4px 0 0 #86efac;
    }
    table.family td.st.st-stale {
      height: 1px;
      background: #fef2f2;
      color: #9f1239;
      font-weight: 600;
      box-shadow: inset 4px 0 0 #fca5a5;
    }
    .status-stack {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 100%;
    }
    .status-week-note {
      margin: auto 0 0;
      padding-top: 6px;
      font-size: 9px;
      font-weight: 400;
      line-height: 1.2;
      letter-spacing: 0;
    }
    button.status-more {
      display: inline;
      white-space: nowrap;
      margin: 0;
      border: 0;
      padding: 0;
      background: none;
      color: var(--navy-2);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      text-decoration: underline;
    }
    .status-full-print { display: none; }
    .status-dialog-body {
      margin: 0;
      padding: 16px 20px 20px;
      white-space: pre-wrap;
      font-size: 14px;
      line-height: 1.45;
    }
    .res-line { font-weight: 600; }
    ul.share-list {
      margin: 4px 0 0;
      padding-left: 1.15em;
    }
    button.share-projects-btn {
      display: inline;
      font-size: inherit;
      font-weight: 700;
      text-align: left;
    }
    ul.share-projects-print, ul.share-dialog-list { margin: 2px 0 0; padding-left: 1.15em; }
    ul.share-projects-print { display: none; }
    ul.share-dialog-list { margin: 0; padding: 16px 20px 20px 36px; }
    tbody tr:nth-child(even) { background: var(--wash); }
    tbody tr.total { background: #dbeafe; font-weight: 600; }
    tbody tr.total td { border-bottom: 0; }
    table.family { border-top: 4px solid var(--navy); }
    table.sw { border-top-color: var(--sw); }
    table.dv { border-top-color: var(--dv); }
    table.ai { border-top-color: var(--ai); }
    table.na { border-top-color: var(--na); }
    table.sw th { background: var(--sw); }
    table.dv th { background: var(--dv); }
    table.ai th { background: var(--ai); }
    table.na th { background: var(--na); }
    tbody tr.row-sw { background: #f0fdfa; }
    tbody tr.row-dv { background: #eef2ff; }
    tbody tr.row-ai { background: #f0f9ff; }
    tbody tr.row-na { background: #f0fdf4; }
    tr.row-sw td:first-child { box-shadow: inset 5px 0 0 var(--sw); }
    tr.row-dv td:first-child { box-shadow: inset 5px 0 0 var(--dv); }
    tr.row-ai td:first-child { box-shadow: inset 5px 0 0 var(--ai); }
    tr.row-na td:first-child { box-shadow: inset 5px 0 0 var(--na); }
    tbody tr:not(.sub) td:first-child { font-weight: 600; }
    tr.total td:first-child { font-weight: 600; }
    tr.sub { display: none; }
    tr.sub.is-open { display: table-row; }
    button.expand {
      display: block;
      margin: 2px 0 0;
      border: 0;
      padding: 0;
      background: none;
      color: var(--navy-2);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      white-space: nowrap;
    }
    button.expand .chevron { display: inline-block; width: 0.9em; }
    .sub-toggle {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 18px;
    }
    button.expand-all, button.collapse-all {
      background: transparent;
      color: var(--navy);
      border: 1px solid var(--navy-2);
      padding: 6px 12px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
    }
    button.status-expand {
      border: 0;
      padding: 0;
      background: none;
      color: var(--navy-2);
      font: inherit;
      text-align: left;
      text-decoration: underline;
      cursor: pointer;
    }
    .sub-name { padding-left: 22px; color: var(--muted); font-weight: 400; }
    button.count-btn {
      border: 0;
      padding: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      text-decoration: underline;
    }
    th .count-btn, tr.total .count-btn { color: inherit; }
    .empty { color: var(--muted); }
    .shared-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 39, 64, 0.45);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 48px 16px;
    }
    .shared-backdrop[hidden] { display: none; }
    .sheet {
      width: min(720px, 100%);
      max-height: calc(100vh - 96px);
      overflow: auto;
      background: #fff;
      border: 1px solid var(--rule);
    }
    .sheet > header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      background: var(--navy);
      color: #fff;
      padding: 16px 20px;
      border-bottom: 4px solid var(--gold);
    }
    .sheet h2 {
      margin: 0;
      padding: 0;
      border: 0;
      color: #fff;
      font-size: 18px;
      letter-spacing: 0;
      text-transform: none;
    }
    button.shared-close {
      background: transparent;
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.55);
      padding: 6px 12px;
      cursor: pointer;
      font: inherit;
    }
    table.shared-assignments { margin: 0; }
    tr.shared-person-name td {
      background: #e8eef5;
      color: var(--navy-2);
      font-size: 15px;
      font-weight: 600;
      padding-top: 14px;
      padding-bottom: 8px;
    }
    tr.shared-person-name .shared-person-type {
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
    }
    table.shared-assignments tbody tr:not(.shared-person-name) td {
      font-size: 12px;
      font-weight: 400;
    }
    table.shared-assignments tbody tr:not(.shared-person-name) td:first-child {
      padding-left: 28px;
    }
    @media (max-width: 720px) {
      .page { margin: 0; border: 0; }
      .page > header, .body { padding: 20px; }
      .kpis { grid-template-columns: 1fr; }
      button.print { position: static; display: inline-block; margin-top: 12px; }
    }
    @media print {
      body { background: #fff; }
      .page { margin: 0; border: 0; }
      .page > header, th, .kpi, .tag, tbody tr, td.st.st-not-pmo, td.st.st-reported, td.st.st-stale {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      h2 { break-after: avoid; }
      table { break-inside: avoid; }
      button.print, .shared-backdrop, button.share-projects-btn, button.expand, button.status-more, .status-screen, .sub-toggle { display: none; }
      .status-full-print { display: inline; }
      tr.sub { display: table-row; }
      ul.share-projects-print { display: block; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <button class="print" type="button" onclick="window.print()">Print</button>
      <p>PM Tool · Management briefing</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="sub">${escapeHtml(filterLabel)}. Generated ${escapeHtml(generated)}.</p>
    </header>
    <div class="body">
      <div class="kpis">
        <div class="kpi navy"><b>${projectTotal}</b><span>Projects currently tracked</span></div>
        <div class="kpi teal"><b>${uniqueResources.size}</b><span>Engineering resources (de-duplicated)</span></div>
      </div>
      <p class="lead">Engineering resources are counted once when a person appears on more than one project. Select a number to see names and utilization, or a project count to see the other projects. ${hasSubProjects ? "Select Expand all sub-projects or Collapse all sub-projects to show or hide every sub-project. " : ""}Select a sub-project count under a project name to show or hide its sub-projects. A project that is not reporting with PMO shows “Status not available. Reporting is not with PMO.” in Status even when it has sub-projects. Otherwise a project with sub-projects shows “Click to view individual project status.” in Status. Select that text to show or hide that project’s sub-projects, and each sub-project shows its own status. Description and status show through the first blank line. A longer description or status is shortened with ... and See complete description or View complete status. Select See complete description or View complete status when the text continues.</p>
      ${subToggle}
      ${groups.length ? summary : `<p class="empty">No projects match this filter.</p>`}
      ${sections}
    </div>
  </div>
  <div id="shared-dialog" class="shared-backdrop" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shared-title">
      <header>
        <h2 id="shared-title">Shared resources</h2>
        <button class="shared-close" type="button">Close</button>
      </header>
      <div id="shared-body"></div>
    </div>
  </div>
  <script id="shared-data" type="application/json">${listJson}</script>
  <script>
    const listData = JSON.parse(document.getElementById("shared-data").textContent);
    const dialog = document.getElementById("shared-dialog");
    const title = document.getElementById("shared-title");
    const body = document.getElementById("shared-body");
    function projectLabel(assignment) {
      const name = assignment.parent_name ? assignment.parent_name + " / " + assignment.project_name : assignment.project_name;
      return assignment.group_name ? assignment.group_name + " · " + name : name;
    }
    function resourceTypeLabel(role) {
      const labels = {
        software_engineer: "Software",
        hardware_engineer: "Hardware",
        it_engineer: "IT",
        analog_design_engineer: "Analog design",
        pd_engineer: "Physical Design",
      };
      return labels[role] || "";
    }
    function openList(kind, key, label) {
      if (kind === "share-projects") {
        const names = (listData.shareProjects && listData.shareProjects[key]) || [];
        title.textContent = "Shared projects — " + label;
        body.replaceChildren();
        const list = document.createElement("ul");
        list.className = "share-dialog-list";
        for (const name of names) {
          const item = document.createElement("li");
          item.textContent = name;
          list.append(item);
        }
        body.append(list);
        dialog.hidden = false;
        return;
      }
      const buckets = {
        resources: listData.resources,
        unique: listData.unique,
        shared: listData.shared,
        "group-shared": listData.shared,
      };
      const bucket = buckets[kind] || listData.shared;
      const people = (bucket && bucket[key]) || [];
      const headings = {
        resources: "Resources — ",
        unique: "Unique resources — ",
        shared: "Shared resources — ",
        "group-shared": "Shared with other groups — ",
      };
      title.textContent = (headings[kind] || "") + label;
      body.replaceChildren();
      const table = document.createElement("table");
      table.className = "shared-assignments";
      table.innerHTML = "<thead><tr><th>Project</th><th class=\\"num\\">Utilization</th></tr></thead>";
      const tbody = document.createElement("tbody");
      for (const person of people) {
        const nameRow = document.createElement("tr");
        nameRow.className = "shared-person-name";
        const nameCell = document.createElement("td");
        nameCell.colSpan = 2;
        nameCell.textContent = person.name;
        const typeLabel = resourceTypeLabel(person.role);
        if (typeLabel) {
          const type = document.createElement("span");
          type.className = "shared-person-type";
          type.textContent = " · " + typeLabel;
          nameCell.append(type);
        }
        nameRow.append(nameCell);
        tbody.append(nameRow);
        for (const assignment of person.assignments) {
          const row = document.createElement("tr");
          const projectCell = document.createElement("td");
          projectCell.textContent = projectLabel(assignment);
          const utilizationCell = document.createElement("td");
          utilizationCell.className = "num";
          utilizationCell.textContent = assignment.utilization_percent + "%";
          row.append(projectCell, utilizationCell);
          tbody.append(row);
        }
      }
      table.append(tbody);
      body.append(table);
      dialog.hidden = false;
    }
    function setSubProjects(expand, open) {
      const row = expand.closest("tr");
      const id = row && row.dataset.project;
      expand.setAttribute("aria-expanded", open ? "true" : "false");
      const countLabel = expand.textContent.replace(/^\\s*[▶▼]\\s*/, "").trim();
      expand.setAttribute("aria-label", (open ? "Hide " : "Show ") + countLabel);
      const chevron = expand.querySelector(".chevron");
      if (chevron) chevron.textContent = open ? "▼" : "▶";
      document.querySelectorAll('tr.sub[data-parent="' + id + '"]').forEach((sub) => {
        sub.classList.toggle("is-open", open);
      });
    }
    function toggleSubProjects(expand) {
      setSubProjects(expand, expand.getAttribute("aria-expanded") !== "true");
    }
    function setAllSubProjects(open) {
      document.querySelectorAll("button.expand").forEach((expand) => setSubProjects(expand, open));
    }
    document.body.addEventListener("click", (event) => {
      const expandAll = event.target.closest(".expand-all");
      if (expandAll) {
        event.preventDefault();
        setAllSubProjects(true);
        return;
      }
      const collapseAll = event.target.closest(".collapse-all");
      if (collapseAll) {
        event.preventDefault();
        setAllSubProjects(false);
        return;
      }
      const statusExpand = event.target.closest(".status-expand");
      if (statusExpand) {
        event.preventDefault();
        const row = statusExpand.closest("tr");
        const expand = row && row.querySelector(".expand");
        if (expand) toggleSubProjects(expand);
        return;
      }
      const expand = event.target.closest(".expand");
      if (expand) {
        event.preventDefault();
        toggleSubProjects(expand);
        return;
      }
      const statusButton = event.target.closest(".status-more");
      if (statusButton) {
        event.preventDefault();
        const kind = statusButton.dataset.textKind || "status";
        const key = statusButton.dataset.statusKey;
        const store = kind === "description" ? listData.descriptions : listData.statuses;
        const text = (store && store[key]) || "";
        const heading = kind === "description" ? "Description — " : "Status — ";
        title.textContent = heading + (statusButton.dataset.label || "");
        body.replaceChildren();
        const block = document.createElement("p");
        block.className = "status-dialog-body";
        block.textContent = text;
        body.append(block);
        dialog.hidden = false;
        return;
      }
      const button = event.target.closest(".count-btn");
      if (button) {
        event.preventDefault();
        openList(button.dataset.kind, button.dataset.key, button.dataset.label);
        return;
      }
      if (event.target.closest(".shared-close") || event.target === dialog) {
        dialog.hidden = true;
      }
    });
  </script>
</body>
</html>`;
}
