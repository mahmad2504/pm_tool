import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  GroupItem,
  projectRoleLabel,
  projectStatusLabel,
  ProjectSummary,
  ReportGroup,
  ReportProject,
  ReportSharedResource,
  StatusReport,
  PROJECT_STATUSES,
  ProjectStatus,
  createRootProject,
  createStatusReport,
  downloadProjectsExport,
  projectsExportFilename,
  getProject,
  groupIconSrc,
  listGroups,
  listProjects,
  listStatusReports,
  projectReport,
  patchProject,
  updateGroup,
  updateStatusReport,
  uploadGroupIcon,
} from "../api";
import { OnboardedIcon } from "../components/OnboardedIcon";
import { ProjectStatusSelect } from "../components/ProjectStatusBadge";
import { PeopleNameHover, SubProjectPeopleHint } from "../components/SubProjectPeopleHint";
import { AppShell } from "../layout/AppShell";
import { currentDatetimeLocalValue, datetimeLocalToIso } from "../utils/datetimeLocal";

function formatUpdated(value: string): string {
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

function staleStatusMark(reportedAt: string): string {
  const title = `Last status report is more than a week old (${formatUpdated(reportedAt)})`;
  const label = escapeHtml(title);
  return `<span class="status-stale" title="${label}"><svg viewBox="0 0 24 24" aria-label="${label}"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.75" r="1.15" fill="currentColor"/></svg></span>`;
}

function textThroughFirstBlank(value: string): { preview: string; hasMore: boolean } {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const breakAt = normalized.search(/\n[ \t]*\n/);
  if (breakAt === -1) return { preview: normalized, hasMore: false };
  const preview = normalized.slice(0, breakAt).trim();
  const rest = normalized.slice(breakAt).trim();
  if (!preview || !rest) return { preview: normalized, hasMore: false };
  return { preview, hasMore: true };
}

function clippedTextCell(
  raw: string,
  textKey: string,
  label: string,
  store: Record<string, string>,
  linkText: string,
  kind: "status" | "description",
): string {
  const { preview, hasMore } = textThroughFirstBlank(raw);
  if (!hasMore) return textBlock(preview);
  store[textKey] = raw;
  const button = `<button type="button" class="status-more" data-text-kind="${kind}" data-status-key="${escapeHtml(textKey)}" data-label="${escapeHtml(label)}">${escapeHtml(linkText)}</button>`;
  const lines = textBlock(preview).split("<br>");
  const lastLine = lines.pop() ?? "";
  const earlier = lines.length ? `${lines.join("<br>")}<br>` : "";
  const tail = lastLine.match(/^(.*?)(\S+)\s*$/);
  const screen = tail
    ? `${earlier}${tail[1]}<span class="status-tail">${tail[2]} ${button}</span>`
    : `${earlier}<span class="status-tail">${lastLine} ${button}</span>`;
  return `<span class="status-screen">${screen}</span><span class="status-full-print">${textBlock(raw)}</span>`;
}

function descriptionCell(
  body: string | null | undefined,
  textKey: string,
  label: string,
  descriptions: Record<string, string>,
): string {
  const raw = body?.trim();
  if (!raw) return "Not available.";
  return clippedTextCell(raw, textKey, label, descriptions, "See complete description", "description");
}

function statusCell(
  body: string | null | undefined,
  reportedAt: string | null | undefined,
  statusKey: string,
  label: string,
  statuses: Record<string, string>,
): string {
  const raw = body?.trim();
  if (!raw) return "";
  const stale = statusReportIsStale(reportedAt) ? staleStatusMark(reportedAt as string) : "";
  return `${stale}${clippedTextCell(raw, statusKey, label, statuses, "See complete status", "status")}`;
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
): string {
  const shared = group.shared_with_other_groups;
  if (group.resources.length === 0) return "None assigned";
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
      const root = `<tr data-project="${project.id}">
        <td>${escapeHtml(project.name)}${expand}</td>
        <td>${descriptionCell(project.description, rootKey, project.name, descriptions)}</td>
        <td class="res">${resourceCell(project.resources, project.shared_resources, rootKey, project.name, homeIds, shareProjects)}</td>
        <td class="state">${stateCell(project.status)}</td>
        <td class="st">${statusCell(project.latest_status, project.latest_status_at, rootKey, project.name, statuses)}</td>
      </tr>`;
      const subs = project.sub_projects
        .map((sub) => {
          const subKey = `project-${sub.id}`;
          resources[subKey] = sub.resources;
          shared[subKey] = sub.shared_resources;
          unique[subKey] = uniquePeople(sub.resources, sub.shared_resources);
          const label = `${project.name} / ${sub.name}`;
          return `<tr class="sub" data-parent="${project.id}">
        <td class="sub-name">${escapeHtml(sub.name)}</td>
        <td>${descriptionCell(sub.description, subKey, label, descriptions)}</td>
        <td class="res">${resourceCell(sub.resources, sub.shared_resources, subKey, label, new Set([sub.id]), shareProjects)}</td>
        <td class="state">${stateCell(sub.status)}</td>
        <td class="st">${statusCell(sub.latest_status, sub.latest_status_at, subKey, label, statuses)}</td>
      </tr>`;
        })
        .join("");
      return root + subs;
    })
    .join("");
}

function buildProjectReportHtml(groups: ReportGroup[], filterLabel: string): string {
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
      shared[`${key}-other`] = group.shared_with_other_groups;
      unique[key] = uniquePeople(group.resources, group.shared_with_other_groups);
      return `<tr class="row-${tone}">
            <td><span class="tag ${tone}">${escapeHtml(group.name)}</span></td>
            <td class="num">${group.project_count}</td>
            <td class="num">${countCell(group.resources.length, "resources", key, group.name)}</td>
            <td class="notes">${groupResourceNote(group, key, shareProjects)}</td>
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
  const listJson = JSON.stringify({ resources, shared, unique, shareProjects, statuses, descriptions }).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Project report</title>
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
      --ai: #c2410c;
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
    .tag.ai { background: #ffedd5; color: #9a3412; }
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
    .status-stale {
      display: inline-block;
      width: 16px;
      height: 16px;
      margin: 0 6px 0 0;
      vertical-align: -2px;
      color: #b42318;
    }
    .status-stale svg { display: block; width: 16px; height: 16px; }
    .status-tail { white-space: nowrap; }
    button.status-more {
      display: inline;
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
    tbody tr.row-ai { background: #fff7ed; }
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
    .shared-person { padding: 4px 20px 8px; }
    .shared-person h3 { margin: 16px 0 8px; font-size: 16px; }
    @media (max-width: 720px) {
      .page { margin: 0; border: 0; }
      .page > header, .body { padding: 20px; }
      .kpis { grid-template-columns: 1fr; }
      button.print { position: static; display: inline-block; margin-top: 12px; }
    }
    @media print {
      body { background: #fff; }
      .page { margin: 0; border: 0; }
      .page > header, th, .kpi, .tag, tbody tr, .status-stale {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      h2 { break-after: avoid; }
      table { break-inside: avoid; }
      button.print, .shared-backdrop, button.share-projects-btn, button.expand, button.status-more, .status-screen { display: none; }
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
      <h1>Project report</h1>
      <p class="sub">${escapeHtml(filterLabel)}. Generated ${escapeHtml(generated)}.</p>
    </header>
    <div class="body">
      <div class="kpis">
        <div class="kpi navy"><b>${projectTotal}</b><span>Projects currently tracked</span></div>
        <div class="kpi teal"><b>${uniqueResources.size}</b><span>Engineering resources (de-duplicated)</span></div>
      </div>
      <p class="lead">Engineering resources are counted once when a person appears on more than one project. Select a number to see names and utilization, or a project count to see the other projects. Select a sub-project count under a project name to show or hide its sub-projects. Description and status show through the first blank line. Select See complete description or See complete status when the text continues. A red mark in Status means the last status report is more than a week old.</p>
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
      for (const person of people) {
        const section = document.createElement("section");
        section.className = "shared-person";
        const heading = document.createElement("h3");
        heading.textContent = person.name;
        const table = document.createElement("table");
        table.innerHTML = "<thead><tr><th>Project</th><th>Utilization</th></tr></thead>";
        const tbody = document.createElement("tbody");
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
        table.append(tbody);
        section.append(heading, table);
        body.append(section);
      }
      dialog.hidden = false;
    }
    document.body.addEventListener("click", (event) => {
      const expand = event.target.closest(".expand");
      if (expand) {
        event.preventDefault();
        const row = expand.closest("tr");
        const id = row && row.dataset.project;
        const open = expand.getAttribute("aria-expanded") === "true";
        const nextOpen = !open;
        expand.setAttribute("aria-expanded", nextOpen ? "true" : "false");
        const countLabel = expand.textContent.replace(/^\\s*[▶▼]\\s*/, "").trim();
        expand.setAttribute("aria-label", (nextOpen ? "Hide " : "Show ") + countLabel);
        const chevron = expand.querySelector(".chevron");
        if (chevron) chevron.textContent = nextOpen ? "▼" : "▶";
        document.querySelectorAll('tr.sub[data-parent="' + id + '"]').forEach((sub) => {
          sub.classList.toggle("is-open", nextOpen);
        });
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
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<number | "">("");
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
  const [reportTarget, setReportTarget] = useState<ProjectSummary | null>(null);
  const [latestReport, setLatestReport] = useState<StatusReport | null>(null);
  const [reportBody, setReportBody] = useState("");
  const [newReportBody, setNewReportBody] = useState("");
  const [newReportAt, setNewReportAt] = useState(currentDatetimeLocalValue);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSaving, setReportSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    group_name: "",
    status: "assessment" as ProjectStatus,
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
  const [projectReportLoading, setProjectReportLoading] = useState(false);
  const [projectReportHtml, setProjectReportHtml] = useState<string | null>(null);

  useEffect(() => {
    listGroups().then(setGroups).catch(() => setGroups([]));
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
        roots_only: true,
      });
      setProjects(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [search, groupFilter]);

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

  async function openLastReport(project: ProjectSummary) {
    setReportTarget(project);
    setLatestReport(null);
    setReportBody("");
    setNewReportBody("");
    setNewReportAt(currentDatetimeLocalValue());
    setReportError(null);
    setReportLoading(true);
    try {
      const data = await listStatusReports(project.id, 1);
      const latest = data.items[0];
      if (!latest) {
        setReportError("No report yet.");
        return;
      }
      setLatestReport(latest);
      setReportBody(latest.body);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to load the report");
    } finally {
      setReportLoading(false);
    }
  }

  async function saveLastReport(event: FormEvent) {
    event.preventDefault();
    if (!reportTarget || !latestReport) return;
    const body = reportBody.trim();
    if (!body) return;
    setReportSaving(true);
    setReportError(null);
    try {
      await updateStatusReport(reportTarget.id, latestReport.id, body);
      setReportTarget(null);
      await load();
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to save the report");
    } finally {
      setReportSaving(false);
    }
  }

  async function addReport(event: FormEvent) {
    event.preventDefault();
    if (!reportTarget) return;
    const body = newReportBody.trim();
    if (!body) return;
    setReportSaving(true);
    setReportError(null);
    try {
      await createStatusReport(reportTarget.id, body, datetimeLocalToIso(newReportAt));
      setNewReportBody("");
      setNewReportAt(currentDatetimeLocalValue());
      setReportTarget(null);
      await load();
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to add the report");
    } finally {
      setReportSaving(false);
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
          roots_only: true,
        }),
      ]);
      setGroups(nextGroups);
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
    const query = search.trim();
    return query ? `${groupName} ${query}` : groupName;
  }

  function closeProjectReport() {
    setProjectReportHtml(null);
    setProjectReportLoading(false);
  }

  async function openProjectReport() {
    setProjectReportHtml(null);
    setProjectReportLoading(true);
    setError(null);
    try {
      const data = await projectReport({
        q: search.trim() || undefined,
        group_id: groupFilter || undefined,
      });
      setProjectReportHtml(buildProjectReportHtml(data.groups, `Filter: ${exportFilterLabel()}`));
    } catch (err) {
      setProjectReportLoading(false);
      setError(err instanceof Error ? err.message : "Failed to load the report");
    } finally {
      setProjectReportLoading(false);
    }
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
      });
      setModalOpen(false);
      setForm({ name: "", description: "", group_name: "", status: "assessment" });
      setGroupMode(groups.length > 0 ? "existing" : "new");
      await load();
      listGroups().then(setGroups).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setForm({ name: "", description: "", group_name: "", status: "assessment" });
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
            Every root project belongs to a group. Sub-projects inherit that group.
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
              placeholder="Search name, description, or group…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <select
            className="filter-select"
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
          <button
            type="button"
            className="btn btn--secondary"
            disabled={loading || projectReportLoading}
            onClick={() => void openProjectReport()}
          >
            Report
          </button>
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
            <h2>No projects yet</h2>
            <p>Create a root project to get started.</p>
            <button type="button" className="btn btn--primary" onClick={openCreate}>
              Create project
            </button>
          </div>
        ) : (
          <ul className="resource-grid">
            {projects.map((p) => {
              const duplicates = p.duplicate_resources ?? [];
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
                  <h3 className="project-card__title">
                    <Link to={`/projects/${p.id}`}>{p.name}</Link>
                  </h3>
                  <div className="project-card__head-actions">
                    <ProjectStatusSelect
                      status={p.status}
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
                    {p.status_report_count > 0 && (
                      <button
                        type="button"
                        className="project-card__report"
                        aria-label="Last report"
                        onClick={() => void openLastReport(p)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <path d="M14 2v6h6" />
                          <path d="M16 13H8" />
                          <path d="M16 17H8" />
                          <path d="M10 9H8" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <p className="project-card__description">
                  {p.description || "No description"}
                </p>
                {p.sub_projects.length > 0 && (
                  <ul className="project-card__subs">
                    {p.sub_projects.map((sub) => (
                      <li key={sub.id}>
                        <Link to={`/projects/${sub.id}`}>
                          {sub.name}
                          {sub.resource_count > 0 && (
                            <SubProjectPeopleHint
                              projectId={sub.id}
                              count={sub.resource_count}
                            />
                          )}
                        </Link>
                      </li>
                    ))}
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

      {(projectReportLoading || projectReportHtml) && (
        <div className="html-report">
          <div className="html-report__bar">
            <button type="button" className="btn btn--secondary" onClick={closeProjectReport}>
              Close
            </button>
          </div>
          {projectReportLoading && <p className="html-report__status">Loading…</p>}
          {projectReportHtml && (
            <iframe className="html-report__frame" title="Project report" srcDoc={projectReportHtml} />
          )}
        </div>
      )}

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
              Exports {total} root project{total === 1 ? "" : "s"} matching the current search and
              group filter. Each project is one JSONL line, with people, sub-projects, and the
              latest status reports.
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

      {reportTarget && (
        <div className="modal-backdrop" onClick={() => setReportTarget(null)} role="presentation">
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="last-report-title"
          >
            <header className="modal__header">
              <h2 id="last-report-title">Last report</h2>
              <button type="button" className="icon-btn" onClick={() => setReportTarget(null)}>
                ×
              </button>
            </header>
            <p className="modal__message">{reportTarget.name}</p>
            {reportLoading && <p className="modal__message">Loading…</p>}
            {reportError && <p className="modal__message">{reportError}</p>}
            {!reportLoading && latestReport && (
              <form className="modal__form" onSubmit={(event) => void saveLastReport(event)}>
                <p className="project-card__updated">
                  Submitted{" "}
                  <time dateTime={latestReport.created_at}>{formatUpdated(latestReport.created_at)}</time>
                </p>
                <label>
                  Report
                  <textarea
                    required
                    rows={6}
                    value={reportBody}
                    onChange={(event) => setReportBody(event.target.value)}
                  />
                </label>
                <footer className="modal__footer">
                  <button type="submit" className="btn btn--primary" disabled={reportSaving || !reportBody.trim()}>
                    {reportSaving ? "Saving…" : "Save"}
                  </button>
                </footer>
              </form>
            )}
            {!reportLoading && (
              <form
                className="modal__form report-dialog__new"
                onSubmit={(event) => void addReport(event)}
              >
                <label>
                  New report
                  <textarea
                    rows={4}
                    value={newReportBody}
                    onChange={(event) => setNewReportBody(event.target.value)}
                    placeholder="Write a new status report…"
                  />
                </label>
                <label>
                  Reported at
                  <input
                    type="datetime-local"
                    required
                    value={newReportAt}
                    onChange={(event) => setNewReportAt(event.target.value)}
                  />
                </label>
                <footer className="modal__footer">
                  <button type="button" className="btn btn--ghost" onClick={() => setReportTarget(null)}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn--secondary"
                    disabled={reportSaving || !newReportBody.trim()}
                  >
                    {reportSaving ? "Saving…" : "Add report"}
                  </button>
                </footer>
              </form>
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
