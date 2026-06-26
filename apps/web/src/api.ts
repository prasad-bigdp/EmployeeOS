const BASE = "/api";

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export async function getHealth() {
  return apiFetch<{ ok: boolean; initialized: boolean }>("/health");
}

export async function getCompany() {
  return apiFetch<{ company: CompanyRow | null; brands: BrandRow[] }>("/company");
}

export async function getBrief() {
  return apiFetch<{ title: string; body: string; createdAt: string } | null>("/brief");
}

export async function getGoals() {
  return apiFetch<GoalRow[]>("/goals");
}

export async function getEmployees() {
  return apiFetch<EmployeeRow[]>("/employees");
}

export async function getPlans() {
  return apiFetch<PlanRow[]>("/plans");
}

export async function getHealthScore() {
  return apiFetch<{ score: number; label: string; breakdown: Record<string, number> }>("/health-score");
}

export async function ask(question: string) {
  return apiFetch<{ answer: string }>("/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question })
  });
}

export async function getObservations() {
  return apiFetch<ObsRow[]>("/observations");
}

export async function getIntegrations() {
  return apiFetch<IntegrationsRow>("/integrations");
}

export interface IntegrationApp { app: string; status: string; connectedAt: string | null; connectionId: string | null; }
export interface IntegrationsRow {
  github: { connected: boolean; status: string; owner: string | null; repo: string | null };
  composio: { keyConfigured: boolean; apps: IntegrationApp[] };
}

export interface CompanyRow { id: string; name: string; industry: string; ceoName: string; }
export interface BrandRow { id: string; name: string; }
export interface GoalRow { id: string; title: string; progress: number; status: string; }
export interface EmployeeRow { id: string; name: string; role: string; emoji: string; }
export interface PlanRow { id: string; title: string; employeeRole: string; autonomyRequired: string; status: string; createdAt: string; }
export interface ObsRow { id: string; source: string; signalType: string; content: string; occurredAt: string; }
