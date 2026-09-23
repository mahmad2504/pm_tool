const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export type ResourceRole = "software_engineer" | "hardware_engineer" | "lead";

export interface RoleItem {
  code: ResourceRole;
  label: string;
}

export interface Resource {
  id: number;
  name: string;
  role: ResourceRole;
  email: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
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
}): Promise<ResourceListResponse> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.role) search.set("role", params.role);
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
