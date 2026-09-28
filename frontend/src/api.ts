const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export type ResourceRole = "software_engineer" | "hardware_engineer" | "lead";

export type ProjectRole =
  | "member"
  | "lead"
  | "director"
  | "dv_engineer"
  | "rtl_engineer"
  | "software_engineer"
  | "firmware_engineer";

export const PROJECT_ROLES: { code: ProjectRole; label: string }[] = [
  { code: "member", label: "Member" },
  { code: "lead", label: "Lead" },
  { code: "director", label: "Director" },
  { code: "dv_engineer", label: "DV engineer" },
  { code: "rtl_engineer", label: "RTL engineer" },
  { code: "software_engineer", label: "Software engineer" },
  { code: "firmware_engineer", label: "Firmware engineer" },
];

export function projectRoleLabel(code: ProjectRole): string {
  return PROJECT_ROLES.find((role) => role.code === code)?.label ?? code;
}

export type ProjectStatus =
  | "assessment"
  | "in_progress"
  | "closing"
  | "completed";

export const PROJECT_STATUSES: { code: ProjectStatus; label: string }[] = [
  { code: "assessment", label: "Assessment" },
  { code: "in_progress", label: "In Progress" },
  { code: "closing", label: "Closing" },
  { code: "completed", label: "Completed" },
];

export function projectStatusLabel(code: ProjectStatus): string {
  return PROJECT_STATUSES.find((status) => status.code === code)?.label ?? code;
}

export interface RoleItem {
  code: ResourceRole;
  label: string;
}

export interface ResourceProjectAssignment {
  project_id: number;
  project_name: string;
  parent_name: string | null;
  group_name: string | null;
  utilization_percent: number;
  project_role: ProjectRole;
  onboarded: boolean;
}

export interface Resource {
  id: number;
  name: string;
  role: ResourceRole;
  email: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  total_utilization_percent?: number;
  project_assignments?: ResourceProjectAssignment[];
}

export interface ResourceListResponse {
  items: Resource[];
  total: number;
}

export interface ResourceInput {
  name: string;
  role: ResourceRole;
  email: string;
  notes: string | null;
}

export interface AssignedResource {
  resource: Resource;
  utilization_percent: number;
  project_role: ProjectRole;
  onboarded: boolean;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; detail: string }[];
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") {
      return body.detail;
    }
    return response.statusText;
  } catch {
    return response.statusText;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function listResources(params?: {
  q?: string;
  role?: ResourceRole;
  project_id?: number;
  limit?: number;
  offset?: number;
  over_utilized?: boolean;
  sort?: "name" | "newest";
}): Promise<ResourceListResponse> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.role) search.set("role", params.role);
  if (params?.project_id) search.set("project_id", String(params.project_id));
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  if (params?.over_utilized) search.set("over_utilized", "true");
  if (params?.sort) search.set("sort", params.sort);
  const query = search.toString();
  return request(`/api/resources${query ? `?${query}` : ""}`);
}

export async function listAllResources(params?: {
  q?: string;
  sort?: "name" | "newest";
}): Promise<Resource[]> {
  const pageSize = 200;
  const items: Resource[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (items.length < total) {
    const page = await listResources({ ...params, limit: pageSize, offset });
    items.push(...page.items);
    total = page.total;
    if (page.items.length === 0) break;
    offset += page.items.length;
  }
  return items;
}

export function listRoles(): Promise<RoleItem[]> {
  return request("/api/roles");
}

export function createResource(data: ResourceInput): Promise<Resource> {
  return request("/api/resources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function updateResource(
  id: number,
  data: ResourceInput,
): Promise<Resource> {
  return request(`/api/resources/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function deleteResource(id: number): Promise<void> {
  return request(`/api/resources/${id}`, { method: "DELETE" });
}

export async function importResources(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/api/resources/import`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export function templateCsvUrl(): string {
  return `${API_BASE}/api/resources/import/template`;
}

export interface GroupItem {
  id: number;
  name: string;
  project_count: number;
  icon_url: string | null;
}

export interface TagRef {
  id: number;
  name: string;
}

export interface TagItem extends TagRef {
  project_count: number;
}

export interface SubProjectSummary {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  reports_with_pmo: boolean;
  resource_count: number;
  shared_count?: number;
  tags: TagRef[];
  latest_report_at: string | null;
}

export interface DuplicateResource {
  id: number;
  name: string;
}

export interface ProjectSummary {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null;
  parent_name: string | null;
  root_project_id: number;
  is_root: boolean;
  group_name: string | null;
  group_id: number | null;
  group_icon_url: string | null;
  status: ProjectStatus;
  tags: TagRef[];
  resource_count: number;
  status_report_count: number;
  sub_project_count: number;
  sub_projects: SubProjectSummary[];
  duplicate_resources: DuplicateResource[];
  created_at: string;
  updated_at: string;
}

export interface StatusReport {
  id: number;
  project_id: number;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null;
  parent_name: string | null;
  root_project_id: number;
  root_name: string;
  is_root: boolean;
  group_name: string | null;
  group_icon_url: string | null;
  status: ProjectStatus;
  reports_with_pmo: boolean;
  tags: TagRef[];
  resources: AssignedResource[];
  sub_projects: SubProjectSummary[];
  recent_status_reports: StatusReport[];
  created_at: string;
  updated_at: string;
}

export function listTags(): Promise<TagItem[]> {
  return request("/api/tags");
}

export function listGroups(): Promise<GroupItem[]> {
  return request("/api/groups");
}

export function groupIconSrc(
  iconUrl: string | null | undefined,
): string | null {
  if (!iconUrl) return null;
  return `${API_BASE}${iconUrl}`;
}

export function updateGroup(groupId: number, name: string): Promise<GroupItem> {
  return request(`/api/groups/${groupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function uploadGroupIcon(
  groupId: number,
  file: File,
): Promise<GroupItem> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/api/groups/${groupId}/icon`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export function projectsExportFilename(
  filterLabel: string,
  now = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const safe =
    filterLabel
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "all groups";
  return `projects ${stamp} ${safe}.jsonl`;
}

export function portfolioReportFilename(
  filterLabel: string,
  now = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const safe =
    filterLabel
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "all groups";
  return `portfolio-report ${stamp} ${safe}.html`;
}

export function downloadHtmlFile(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".html") ? filename : `${filename}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadProjectsExport(params: {
  q?: string;
  group_id?: number;
  tag_id?: number;
  reports: number;
  filename: string;
}): Promise<void> {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.group_id) search.set("group_id", String(params.group_id));
  if (params.tag_id) search.set("tag_id", String(params.tag_id));
  search.set("reports", String(params.reports));
  const response = await fetch(`${API_BASE}/api/projects/export?${search}`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = params.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface ReportAssignment {
  project_id: number;
  project_name: string;
  parent_name: string | null;
  group_name?: string | null;
  utilization_percent: number;
}

export interface ReportSharedResource {
  id: number;
  name: string;
  assignments: ReportAssignment[];
}

export interface ReportSubProject {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  tags: string[];
  reports_with_pmo: boolean;
  latest_status: string | null;
  latest_status_at: string | null;
  resource_count: number;
  resources: ReportSharedResource[];
  shared_resources: ReportSharedResource[];
}

export interface ReportGroup {
  id: number | null;
  name: string;
  project_count: number;
  resource_count: number;
  resources: ReportSharedResource[];
  shared_with_other_groups: ReportSharedResource[];
  projects: ReportProject[];
}

export interface ReportProject {
  id: number;
  name: string;
  description: string | null;
  group_name: string | null;
  status: ProjectStatus;
  tags: string[];
  reports_with_pmo: boolean;
  latest_status: string | null;
  latest_status_at: string | null;
  resource_count: number;
  resources: ReportSharedResource[];
  shared_resources: ReportSharedResource[];
  sub_projects: ReportSubProject[];
}

export function projectReport(params?: {
  q?: string;
  group_id?: number;
  tag_id?: number;
}): Promise<{ groups: ReportGroup[] }> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.group_id) search.set("group_id", String(params.group_id));
  if (params?.tag_id) search.set("tag_id", String(params.tag_id));
  const query = search.toString();
  return request(`/api/projects/report${query ? `?${query}` : ""}`);
}

export function listProjects(params?: {
  q?: string;
  group_id?: number;
  tag_id?: number;
  roots_only?: boolean;
  parent_id?: number;
  limit?: number;
  offset?: number;
}): Promise<{ items: ProjectSummary[]; total: number }> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.group_id) search.set("group_id", String(params.group_id));
  if (params?.tag_id) search.set("tag_id", String(params.tag_id));
  if (params?.roots_only) search.set("roots_only", "true");
  if (params?.parent_id) search.set("parent_id", String(params.parent_id));
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  const query = search.toString();
  return request(`/api/projects${query ? `?${query}` : ""}`);
}

export function getProject(
  id: number,
  recentStatusCount?: number,
): Promise<ProjectDetail> {
  const search = new URLSearchParams();
  if (recentStatusCount)
    search.set("recent_status_count", String(recentStatusCount));
  const query = search.toString();
  return request(`/api/projects/${id}${query ? `?${query}` : ""}`);
}

export function createRootProject(data: {
  name: string;
  description?: string | null;
  group_name: string;
  status: ProjectStatus;
  tags?: string[];
}): Promise<ProjectSummary> {
  return request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function moveSubProject(
  id: number,
  parentId: number,
): Promise<ProjectSummary> {
  return request(`/api/projects/${id}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_id: parentId }),
  });
}

export function createSubProject(
  parentId: number,
  data: { name: string; description?: string | null; status?: ProjectStatus; tags?: string[] },
): Promise<ProjectSummary> {
  return request(`/api/projects/${parentId}/sub-projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function patchProject(
  id: number,
  data: {
    name?: string;
    description?: string | null;
    group_name?: string;
    status?: ProjectStatus;
    reports_with_pmo?: boolean;
    tags?: string[];
  },
): Promise<ProjectSummary> {
  return request(`/api/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function deleteProject(id: number): Promise<void> {
  return request(`/api/projects/${id}`, { method: "DELETE" });
}

export function attachResourceToProject(
  projectId: number,
  resourceId: number,
  utilizationPercent: number = 100,
  projectRole: ProjectRole = "member",
  onboarded: boolean = false,
): Promise<void> {
  return request(`/api/projects/${projectId}/resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resource_id: resourceId,
      utilization_percent: utilizationPercent,
      project_role: projectRole,
      onboarded,
    }),
  });
}

export function updateProjectResourceUtilization(
  projectId: number,
  resourceId: number,
  utilizationPercent: number,
): Promise<AssignedResource> {
  return request(`/api/projects/${projectId}/resources/${resourceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ utilization_percent: utilizationPercent }),
  });
}

export function updateProjectResourceRole(
  projectId: number,
  resourceId: number,
  projectRole: ProjectRole,
): Promise<AssignedResource> {
  return request(`/api/projects/${projectId}/resources/${resourceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_role: projectRole }),
  });
}

export function updateProjectResourceOnboarded(
  projectId: number,
  resourceId: number,
  onboarded: boolean,
): Promise<AssignedResource> {
  return request(`/api/projects/${projectId}/resources/${resourceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboarded }),
  });
}

export function detachResourceFromProject(
  projectId: number,
  resourceId: number,
): Promise<void> {
  return request(`/api/projects/${projectId}/resources/${resourceId}`, {
    method: "DELETE",
  });
}

export function listStatusReports(
  projectId: number,
  limit?: number,
  offset?: number,
): Promise<{ items: StatusReport[]; total: number }> {
  const search = new URLSearchParams();
  if (limit) search.set("limit", String(limit));
  if (offset) search.set("offset", String(offset));
  const query = search.toString();
  return request(
    `/api/projects/${projectId}/status-reports${query ? `?${query}` : ""}`,
  );
}

export function createStatusReport(
  projectId: number,
  body: string,
  createdAt?: string,
): Promise<StatusReport> {
  return request(`/api/projects/${projectId}/status-reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      body,
      ...(createdAt ? { created_at: createdAt } : {}),
    }),
  });
}

export function updateStatusReport(
  projectId: number,
  reportId: number,
  body: string,
  createdAt?: string,
): Promise<StatusReport> {
  return request(`/api/projects/${projectId}/status-reports/${reportId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      body,
      ...(createdAt ? { created_at: createdAt } : {}),
    }),
  });
}

export function deleteStatusReport(
  projectId: number,
  reportId: number,
): Promise<void> {
  return request(`/api/projects/${projectId}/status-reports/${reportId}`, {
    method: "DELETE",
  });
}
