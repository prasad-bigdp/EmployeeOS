export interface MCPPluginDefinition {
  name: string;
  version: string;
  tools: string[];
}

export const pluginRegistry: MCPPluginDefinition[] = [
  { name: "gmail", version: "1.0.0", tools: ["read", "search", "draft"] },
  { name: "calendar", version: "1.0.0", tools: ["read", "schedule"] },
  { name: "github", version: "1.0.0", tools: ["issues", "pull_requests"] },
  { name: "slack", version: "1.0.0", tools: ["channels", "messages"] },
  { name: "notion", version: "1.0.0", tools: ["pages", "databases"] },
  { name: "browser", version: "1.0.0", tools: ["navigate", "extract", "verify"] },
  { name: "filesystem", version: "1.0.0", tools: ["read", "write", "watch"] }
];
