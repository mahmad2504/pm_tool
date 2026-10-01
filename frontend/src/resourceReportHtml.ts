import {
  Resource,
  ResourceRole,
  RoleItem,
  projectRoleLabel,
} from "./api";
import { formatUpdated } from "./reportHtml";
import { ResourceReportSort, resourceReportSortLabel } from "./resourceReportSort";
import { projectListLabel } from "./utils/projectLabel";

const ROLE_ORDER: { code: ResourceRole; label: string }[] = [
  { code: "software_engineer", label: "Software engineer" },
  { code: "it_engineer", label: "IT engineer" },
  { code: "hardware_engineer", label: "Hardware engineer" },
  { code: "analog_design_engineer", label: "Analog design engineer" },
  { code: "pd_engineer", label: "PD engineer" },
  { code: "lead", label: "Lead" },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function roleCatalog(roles: RoleItem[]): { code: ResourceRole; label: string }[] {
  return ROLE_ORDER.map((role) => ({
    code: role.code,
    label: roles.find((item) => item.code === role.code)?.label ?? role.label,
  }));
}

function assignmentLines(person: Resource): string {
  const assignments = person.project_assignments ?? [];
  if (assignments.length === 0) return `<span class="muted">No projects</span>`;
  const items = assignments
    .map((assignment) => {
      const label = projectListLabel(
        assignment.project_name,
        !assignment.parent_name,
        assignment.parent_name,
      );
      const details = [
        assignment.group_name,
        projectRoleLabel(assignment.project_role),
        `${assignment.utilization_percent}%`,
      ].filter((part): part is string => Boolean(part));
      const onboarded = assignment.onboarded
        ? `<span class="onboarded">Onboarded</span>`
        : "";
      return `<li><a class="project" href="/projects/${assignment.project_id}" target="_top">${escapeHtml(label)}</a><span class="meta">${escapeHtml(details.join(" · "))}</span>${onboarded}</li>`;
    })
    .join("");
  return `<ul class="assignments">${items}</ul>`;
}

function columnHeader(label: string, active: boolean, descending: boolean): string {
  if (!active) return escapeHtml(label);
  return `${escapeHtml(label)} ${descending ? "↓" : "↑"}`;
}

export function buildResourceReportHtml(
  items: Resource[],
  roles: RoleItem[],
  filterLabel: string,
  emptyMessage: string,
  sort: ResourceReportSort = "name",
): string {
  const catalog = roleCatalog(roles);
  const labelFor = (code: ResourceRole) =>
    catalog.find((role) => role.code === code)?.label ?? code;
  const overCount = items.filter((person) => (person.total_utilization_percent ?? 0) > 100).length;
  const roleSummary = catalog
    .map((role) => {
      const count = items.filter((person) => person.role === role.code).length;
      return `${escapeHtml(role.label)} ${count}`;
    })
    .join(" · ");
  const generated = formatUpdated(new Date().toISOString());
  const rows = items
    .map((person) => {
      const total = person.total_utilization_percent ?? 0;
      const over = total > 100 ? " over" : "";
      return `<tr class="${over.trim()}">
        <td>${escapeHtml(person.name)}</td>
        <td>${escapeHtml(labelFor(person.role))}</td>
        <td>${person.location ? escapeHtml(person.location) : ""}</td>
        <td><a href="mailto:${escapeHtml(person.email)}">${escapeHtml(person.email)}</a></td>
        <td class="num util${over}">${total}%</td>
        <td>${assignmentLines(person)}</td>
      </tr>`;
    })
    .join("");
  const table = items.length
    ? `<table>
        <thead>
          <tr>
            <th>${columnHeader("Name", sort === "name" || sort === "name_desc", sort === "name_desc")}</th>
            <th>${columnHeader("Organization role", sort === "role", false)}</th>
            <th>Location</th>
            <th>${columnHeader("Email", sort === "email", false)}</th>
            <th class="num">${columnHeader("Utilization", sort === "utilization" || sort === "utilization_asc", sort === "utilization")}</th>
            <th>Projects</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
    : `<p class="empty">${escapeHtml(emptyMessage)}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Resource utilization report</title>
  <style>
    :root {
      --ink: #1c2430;
      --muted: #5c6570;
      --rule: #d8dde3;
      --paper: #ffffff;
      --navy: #16324f;
      --navy-2: #1e4a73;
      --gold: #c9a227;
      --sw: #0f766e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: #e8ecef;
      font: 15px/1.55 "Calibri", "Segoe UI", Arial, sans-serif;
    }
    .page {
      max-width: 1100px;
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
      margin: 0 0 12px;
    }
    .kpi {
      border: 1px solid var(--rule);
      border-left: 6px solid var(--navy);
      padding: 14px 16px;
      background: #eef4fb;
    }
    .kpi.warn { border-left-color: #b42318; background: #fff4f2; }
    .kpi b {
      display: block;
      font-size: 28px;
      font-weight: 600;
      color: var(--navy);
      line-height: 1.1;
    }
    .kpi.warn b { color: #b42318; }
    .kpi span {
      display: block;
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }
    p.roles { margin: 0 0 16px; color: var(--muted); }
    p.lead { margin: 0 0 16px; }
    p.empty { margin: 0; color: var(--muted); }
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
    td.util.over {
      color: #b42318;
      font-weight: 700;
      background: #fff4f2;
    }
    a { color: var(--navy-2); }
    a.project { font-weight: 600; }
    .muted, .meta { color: var(--muted); }
    .meta { margin-left: 6px; }
    ul.assignments { margin: 0; padding: 0; list-style: none; }
    ul.assignments li { margin: 0 0 8px; }
    ul.assignments li:last-child { margin: 0; }
    .onboarded {
      display: inline-block;
      margin-left: 6px;
      padding: 0 6px;
      border-radius: 999px;
      background: #dcfce7;
      color: #166534;
      font-size: 12px;
      font-weight: 600;
    }
    @media (max-width: 720px) {
      .page { margin: 0; border: 0; }
      .page > header, .body { padding: 20px; }
      .kpis { grid-template-columns: 1fr; }
      button.print { position: static; display: inline-block; margin-top: 12px; }
    }
    @media print {
      body { background: #fff; }
      .page { margin: 0; border: 0; max-width: none; }
      .page > header, th, .kpi, td.util.over, .onboarded {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      button.print { display: none; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <button class="print" type="button" onclick="window.print()">Print</button>
      <p>PM Tool · People</p>
      <h1>Resource utilization</h1>
      <p class="sub">${escapeHtml(filterLabel)}. ${escapeHtml(resourceReportSortLabel(sort))}. Generated ${escapeHtml(generated)}.</p>
    </header>
    <div class="body">
      <div class="kpis">
        <div class="kpi"><b>${items.length}</b><span>People</span></div>
        <div class="kpi warn"><b>${overCount}</b><span>Over 100%</span></div>
      </div>
      <p class="roles">${roleSummary}</p>
      <p class="lead">Each row is one person. Utilization is the sum of that person’s assignments and is highlighted when it is over 100%. A sub-project is shown with its root. Select a project name to open it.</p>
      ${table}
    </div>
  </div>
</body>
</html>`;
}
