export interface MCPPluginDefinition {
  name: string;
  version: string;
  tools: string[];
}

// Legacy registry kept for MCP tool listing
export const pluginRegistry: MCPPluginDefinition[] = [
  { name: "gmail", version: "1.0.0", tools: ["read", "search", "draft", "send"] },
  { name: "calendar", version: "1.0.0", tools: ["read", "schedule"] },
  { name: "github", version: "1.0.0", tools: ["create_issue", "comment_on_issue", "create_pr", "label_issue", "close_issue", "get_repo_health"] },
  { name: "slack", version: "1.0.0", tools: ["send_message", "fetch_history"] },
  { name: "notion", version: "1.0.0", tools: ["create_page", "search", "update_page"] },
  { name: "hubspot", version: "1.0.0", tools: ["create_deal", "create_contact", "list_contacts"] },
  { name: "stripe", version: "1.0.0", tools: ["get_balance", "list_customers"] },
  { name: "browser", version: "1.0.0", tools: ["navigate", "extract", "verify"] },
  { name: "filesystem", version: "1.0.0", tools: ["read", "write", "watch"] }
];

export type ProviderType = "native" | "composio" | "fallback";
export type DangerLevel = "safe" | "moderate" | "dangerous";

export interface ToolCapability {
  name: string;
  tool: string;
  operation: string;
  description: string;
  provider: ProviderType;
  requiredConfig: string[];
  dangerLevel: DangerLevel;
  example?: Record<string, unknown>;
}

export const TOOL_CAPABILITIES: ToolCapability[] = [
  // GitHub — native
  { name: "Create GitHub Issue", tool: "github", operation: "create_issue", description: "Open a new issue in a GitHub repository", provider: "native", requiredConfig: ["githubToken"], dangerLevel: "safe", example: { title: "Bug: login fails on mobile", body: "Steps to reproduce...", labels: ["bug"] } },
  { name: "Comment on GitHub Issue", tool: "github", operation: "comment_on_issue", description: "Add a comment to an existing issue or PR", provider: "native", requiredConfig: ["githubToken"], dangerLevel: "safe", example: { issueNumber: 42, body: "Investigated — root cause is in auth middleware" } },
  { name: "Create GitHub PR", tool: "github", operation: "create_pr", description: "Open a new pull request", provider: "native", requiredConfig: ["githubToken"], dangerLevel: "moderate", example: { title: "Fix: auth middleware session bug", head: "fix/auth-session", base: "main" } },
  { name: "Label GitHub Issue", tool: "github", operation: "label_issue", description: "Add labels to an issue or PR", provider: "native", requiredConfig: ["githubToken"], dangerLevel: "safe", example: { issueNumber: 42, labels: ["needs-triage"] } },
  { name: "Close GitHub Issue", tool: "github", operation: "close_issue", description: "Close an issue with optional closing comment", provider: "native", requiredConfig: ["githubToken"], dangerLevel: "moderate", example: { issueNumber: 42, comment: "Fixed in v1.2.3" } },
  { name: "Get Repo Health", tool: "github", operation: "get_repo_health", description: "Read open issues, PRs, last push", provider: "native", requiredConfig: ["githubToken"], dangerLevel: "safe", example: {} },
  // Slack — Composio
  { name: "Send Slack Message", tool: "slack", operation: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL", description: "Post a message to a Slack channel", provider: "composio", requiredConfig: ["composioApiKey"], dangerLevel: "moderate", example: { channel: "#alerts", text: "Anomaly detected in revenue" } },
  { name: "Fetch Slack History", tool: "slack", operation: "SLACK_FETCH_CONVERSATION_HISTORY", description: "Read recent messages from a Slack channel", provider: "composio", requiredConfig: ["composioApiKey"], dangerLevel: "safe", example: { channel: "#general", limit: 20 } },
  // Gmail — Composio
  { name: "Send Email via Gmail", tool: "gmail", operation: "GMAIL_SEND_EMAIL", description: "Send an email from connected Gmail account", provider: "composio", requiredConfig: ["composioApiKey"], dangerLevel: "moderate", example: { to: "team@company.com", subject: "Weekly summary", body: "..." } },
  { name: "Fetch Gmail Inbox", tool: "gmail", operation: "GMAIL_FETCH_EMAILS", description: "Read recent emails from Gmail inbox", provider: "composio", requiredConfig: ["composioApiKey"], dangerLevel: "safe", example: { maxResults: 10 } },
  // Notion — Composio
  { name: "Create Notion Page", tool: "notion", operation: "NOTION_CREATE_PAGE", description: "Create a new page in a Notion database", provider: "composio", requiredConfig: ["composioApiKey"], dangerLevel: "safe", example: { parent: { database_id: "xxx" }, title: "Q2 Review" } },
  { name: "Search Notion", tool: "notion", operation: "NOTION_SEARCH", description: "Search Notion pages and databases", provider: "composio", requiredConfig: ["composioApiKey"], dangerLevel: "safe", example: { query: "OKR Q1 2025" } },
  // HubSpot — Composio
  { name: "Create HubSpot Deal", tool: "hubspot", operation: "HUBSPOT_CREATE_DEAL", description: "Create a new deal in HubSpot CRM", provider: "composio", requiredConfig: ["composioApiKey"], dangerLevel: "moderate", example: { dealname: "Acme Corp - Enterprise", amount: 10000 } },
  { name: "Create HubSpot Contact", tool: "hubspot", operation: "HUBSPOT_CREATE_CONTACT", description: "Add a new contact to HubSpot", provider: "composio", requiredConfig: ["composioApiKey"], dangerLevel: "moderate", example: { email: "jane@acme.com", firstname: "Jane" } },
  // Stripe — Composio
  { name: "Get Stripe Balance", tool: "stripe", operation: "STRIPE_RETRIEVE_BALANCE", description: "Retrieve current Stripe account balance", provider: "composio", requiredConfig: ["composioApiKey"], dangerLevel: "safe", example: {} },
  { name: "List Stripe Customers", tool: "stripe", operation: "STRIPE_LIST_CUSTOMERS", description: "List recent customers from Stripe", provider: "composio", requiredConfig: ["composioApiKey"], dangerLevel: "safe", example: { limit: 10 } },
];

export function getCapabilitiesForTool(tool: string): ToolCapability[] {
  return TOOL_CAPABILITIES.filter(c => c.tool === tool);
}

export function getCapabilityByOperation(tool: string, operation: string): ToolCapability | undefined {
  return TOOL_CAPABILITIES.find(c => c.tool === tool && c.operation === operation);
}

export function getAvailableCapabilities(config: {
  githubToken?: string;
  composioApiKey?: string;
}): ToolCapability[] {
  return TOOL_CAPABILITIES.filter(cap => {
    if (cap.requiredConfig.includes("githubToken") && !config.githubToken) return false;
    if (cap.requiredConfig.includes("composioApiKey") && !config.composioApiKey) return false;
    return true;
  });
}

export function getCapabilitySummary(config: {
  githubToken?: string;
  composioApiKey?: string;
}): string {
  const available = getAvailableCapabilities(config);
  if (available.length === 0) {
    return "No integrations connected. Run `employeeos github` or `employeeos connect` to enable real actions.";
  }
  const byTool = available.reduce<Record<string, number>>((acc, c) => {
    acc[c.tool] = (acc[c.tool] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(byTool).map(([t, n]) => `${t}(${n})`).join(", ");
}
