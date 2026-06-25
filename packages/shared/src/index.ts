export type MemoryKind = "company" | "historical" | "pattern" | "relationship";
export type AutonomyLevel = "observe" | "recommend" | "execute" | "autonomous";
export type GoalKind =
  | "increase_revenue"
  | "increase_leads"
  | "improve_conversions"
  | "improve_satisfaction"
  | "reduce_costs"
  | "reduce_churn";
export type Industry =
  | "education"
  | "saas"
  | "ecommerce"
  | "agency"
  | "consulting"
  | "healthcare"
  | "other";
export type EmployeeRole =
  | "ceo-assistant"
  | "marketing-manager"
  | "sales-manager"
  | "support-manager"
  | "finance-manager"
  | "hr-manager";
export type IntegrationType =
  | "gmail"
  | "outlook"
  | "calendar"
  | "slack"
  | "notion"
  | "github"
  | "google_analytics"
  | "meta_ads"
  | "google_ads"
  | "hubspot"
  | "zoho_crm"
  | "whatsapp";

export interface CompanyProfile {
  id: string;
  name: string;
  industry: Industry;
  description: string;
  ceoName: string;
  ceoEmail: string;
  createdAt: string;
}

export interface BrandProfile {
  id: string;
  companyId: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface EmployeeDefinition {
  name: string;
  role: EmployeeRole;
  goal: string[];
  daily_routine: string[];
  tools: string[];
}

export interface CompanyGoal {
  id: string;
  title: string;
  kind: GoalKind;
  progress: number;
  status: "active" | "paused" | "complete";
}

export interface CompanyEvent {
  id: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  subject: string;
  body: string;
  confidence: number;
}

export interface Observation {
  id: string;
  source: string;
  signalType: string;
  content: string;
  occurredAt: string;
}

export interface Learning {
  id: string;
  subject: string;
  pattern: string;
  confidence: number;
  evidenceCount: number;
}

export interface PlanAction {
  step: number;
  description: string;
  tool?: string;
}

export interface Plan {
  id: string;
  employeeRole: string;
  title: string;
  actions: PlanAction[];
  status: "pending" | "approved" | "executing" | "done" | "rejected";
  autonomyRequired: AutonomyLevel;
}

export interface HealthScore {
  score: number;
  breakdown: {
    revenue?: number;
    leads?: number;
    conversions?: number;
    retention?: number;
    satisfaction?: number;
    operations?: number;
  };
  scoredAt: string;
}

export type AIProviderName = "anthropic" | "openai" | "openrouter" | "ollama";

export interface OnboardingConfig {
  companyName: string;
  industry: Industry;
  description: string;
  ceoName: string;
  ceoEmail: string;
  goals: GoalKind[];
  brands: string[];
  integrations: IntegrationType[];
  employees: EmployeeRole[];
  autonomyLevel: AutonomyLevel;
  learningEnabled: boolean;
  aiProvider: AIProviderName;
  aiApiKey: string;
  aiModel?: string;
  aiBaseURL?: string;
}

export interface AppConfig {
  version: number;
  companyId: string;
  dbPath: string;
  aiProvider: AIProviderName;
  aiApiKey: string;
  aiModel?: string;
  aiBaseURL?: string;
  autonomyLevel: AutonomyLevel;
  initialized: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  emailTo?: string;
  emailSmtp?: string;
  emailUser?: string;
  emailPass?: string;
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  imapPass?: string;
  imapTls?: boolean;
}

export const GOAL_LABELS: Record<GoalKind, string> = {
  increase_revenue: "Increase Revenue",
  increase_leads: "Increase Leads",
  improve_conversions: "Improve Conversions",
  improve_satisfaction: "Improve Customer Satisfaction",
  reduce_costs: "Reduce Costs",
  reduce_churn: "Reduce Churn"
};

export const INDUSTRY_LABELS: Record<Industry, string> = {
  education: "Education",
  saas: "SaaS",
  ecommerce: "E-commerce",
  agency: "Agency",
  consulting: "Consulting",
  healthcare: "Healthcare",
  other: "Other"
};

export const INTEGRATION_LABELS: Record<IntegrationType, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  calendar: "Google Calendar",
  slack: "Slack",
  notion: "Notion",
  github: "GitHub",
  google_analytics: "Google Analytics",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  hubspot: "HubSpot",
  zoho_crm: "Zoho CRM",
  whatsapp: "WhatsApp Business"
};
