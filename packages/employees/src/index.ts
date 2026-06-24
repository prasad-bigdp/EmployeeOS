import type { EmployeeDefinition, EmployeeRole } from "@employeeos/shared";

export interface EmployeeRoleSpec {
  name: string;
  goal: string[];
  daily_routine: string[];
  tools: string[];
}

export const employeeRoles: Record<EmployeeRole, EmployeeRoleSpec> = {
  "ceo-assistant": {
    name: "CEO Assistant",
    goal: ["track_company_goals", "prepare_briefs", "highlight_risks"],
    daily_routine: ["monitor_signals", "compile_brief", "escalate_issues"],
    tools: ["gmail", "calendar", "crm", "analytics"]
  },
  "marketing-manager": {
    name: "Marketing Manager",
    goal: ["increase_leads", "improve_conversion"],
    daily_routine: ["analyze_ads", "check_funnel", "create_recommendations"],
    tools: ["gmail", "analytics", "meta_ads", "google_ads"]
  },
  "sales-manager": {
    name: "Sales Manager",
    goal: ["increase_pipeline", "close_deals"],
    daily_routine: ["review_pipeline", "follow_up", "analyze_objections"],
    tools: ["crm", "gmail", "calendar"]
  },
  "support-manager": {
    name: "Support Manager",
    goal: ["reduce_response_time", "improve_satisfaction"],
    daily_routine: ["review_tickets", "escalate_risks", "learn_patterns"],
    tools: ["support", "gmail", "knowledge_base"]
  },
  "finance-manager": {
    name: "Finance Manager",
    goal: ["track_revenue", "reduce_costs", "forecast_growth"],
    daily_routine: ["review_metrics", "identify_anomalies", "update_forecasts"],
    tools: ["analytics", "accounting", "spreadsheets"]
  },
  "hr-manager": {
    name: "HR Manager",
    goal: ["improve_retention", "support_hiring", "track_team_health"],
    daily_routine: ["review_feedback", "monitor_sentiment", "surface_risks"],
    tools: ["hris", "gmail", "calendar", "surveys"]
  }
};
