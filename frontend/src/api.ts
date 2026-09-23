const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export type ResourceRole = "software_engineer" | "hardware_engineer" | "lead";

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
  over_utilized?: boolean;
}): Promise<ResourceListResponse> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.role) search.set("role", params.role);
  if (params?.project_id) search.set("project_id", String(params.project_id));
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.over_utilized) search.set("over_utilized", "true");
  const query = search.toString();
  return request(`/api/resources${query ? `?${query}` : ""}`);
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

export function updateResource(id: number, data: ResourceInput): Promise<Resource> {
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

export interface SubProjectSummary {
  id: number;
  name: string;
  description: string | null;
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
  group_icon_url: string | null;
  resource_count: number;
  status_report_count: number;
  sub_project_count: number;
  sub_projects: SubProjectSummary[];
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
  resources: AssignedResource[];
  sub_projects: SubProjectSummary[];
  recent_status_reports: StatusReport[];
  created_at: string;
  updated_at: string;
}

export function listGroups(): Promise<GroupItem[]> {
  return request("/api/groups");
}

export function groupIconSrc(iconUrl: string | null | undefined): string | null {
  if (!iconUrl) return null;
  return `${API_BASE}${iconUrl}`;
}

export async function uploadGroupIcon(groupId: number, file: File): Promise<GroupItem> {
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

export function listProjects(params?: {
  q?: string;
  group_id?: number;
  roots_only?: boolean;
  parent_id?: number;
  limit?: number;
}): Promise<{ items: ProjectSummary[]; total: number }> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.group_id) search.set("group_id", String(params.group_id));
  if (params?.roots_only) search.set("roots_only", "true");
  if (params?.parent_id) search.set("parent_id", String(params.parent_id));
  if (params?.limit) search.set("limit", String(params.limit));
  const query = search.toString();
  return request(`/api/projects${query ? `?${query}` : ""}`);
}

export function getProject(
  id: number,
  recentStatusCount?: number,
): Promise<ProjectDetail> {
  const search = new URLSearchParams();
  if (recentStatusCount) search.set("recent_status_count", String(recentStatusCount));
  const query = search.toString();
  return request(`/api/projects/${id}${query ? `?${query}` : ""}`);
}

export function createRootProject(data: {
  name: string;
  description?: string | null;
  group_name: string;
}): Promise<ProjectSummary> {
  return request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function createSubProject(
  parentId: number,
  data: { name: string; description?: string | null },
): Promise<ProjectSummary> {
  return request(`/api/projects/${parentId}/sub-projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function patchProject(
  id: number,
  data: { name?: string; description?: string | null; group_name?: string },
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
): Promise<void> {
  return request(`/api/projects/${projectId}/resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resource_id: resourceId,
      utilization_percent: utilizationPercent,
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
): Promise<{ items: StatusReport[]; total: number }> {
  const search = new URLSearchParams();
  if (limit) search.set("limit", String(limit));
  const query = search.toString();
  return request(`/api/projects/${projectId}/status-reports${query ? `?${query}` : ""}`);
}

export function createStatusReport(
  projectId: number,
  body: string,
): Promise<StatusReport> {
  return request(`/api/projects/${projectId}/status-reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export function updateStatusReport(
  projectId: number,
  reportId: number,
  body: string,
): Promise<StatusReport> {
  return request(`/api/projects/${projectId}/status-reports/${reportId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export function deleteStatusReport(projectId: number, reportId: number): Promise<void> {
  return request(`/api/projects/${projectId}/status-reports/${reportId}`, {
    method: "DELETE",
  });
}
