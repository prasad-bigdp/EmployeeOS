import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DatabaseService } from "@employeeos/database";
import { createProvider } from "@employeeos/ai";
import { answerQuestion, getOrGenerateBrief } from "@employeeos/reporter";
import type { AppConfig } from "@employeeos/shared";

const CONFIG_FILE = path.join(os.homedir(), ".employeeos", "config.json");

function loadConfig(): AppConfig | null {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as AppConfig;
  } catch {
    return null;
  }
}

async function openResources() {
  const config = loadConfig();
  if (!config) {
    throw new Error("EmployeeOS not configured. Run `employeeos init` first.");
  }
  const db = await DatabaseService.open(config.dbPath);
  const ai = await createProvider(config.aiProvider, {
    apiKey: config.aiApiKey,
    model: config.aiModel,
    baseURL: config.aiBaseURL
  });
  return { db, ai, config };
}

// -- Server setup ----------------------------------------------------------

const server = new McpServer({
  name: "employeeos",
  version: "1.0.0",
  description: "The Open Source Company Brain - access your company intelligence via Claude"
});

// -- Tools -----------------------------------------------------------------

server.tool(
  "think",
  "Ask the company brain a strategic business question. Uses your company's goals, history, documents, and AI analysis to answer.",
  { question: z.string().describe("The business question to ask, e.g. 'why are conversions down?' or 'what should we prioritize this quarter?'") },
  async ({ question }) => {
    const { db, ai, config } = await openResources();
    try {
      const answer = await answerQuestion(db, ai, config.companyId, question);
      return { content: [{ type: "text" as const, text: answer }] };
    } finally {
      db.close();
    }
  }
);

server.tool(
  "get_brief",
  "Get the latest morning intelligence brief for your company.",
  {},
  async () => {
    const { db, ai, config } = await openResources();
    try {
      const report = await getOrGenerateBrief(db, ai, config.companyId);
      const text = report.body;
      return { content: [{ type: "text" as const, text }] };
    } finally {
      db.close();
    }
  }
);

server.tool(
  "get_status",
  "Get company health score, active goals with progress, and pending AI-generated plans.",
  {},
  async () => {
    const { db, config } = await openResources();
    try {
      const company = await db.getCompany();
      const goals = await db.getGoals(config.companyId);
      const plans = await db.getPendingPlans(config.companyId);
      const employees = await db.getEmployees(config.companyId);

      const lines = [
        "=== Company Status ===",
        "Company: " + (company?.name ?? "Unknown"),
        "Industry: " + (company?.industry ?? "Unknown"),
        "",
        "Active Goals (" + goals.length + "):",
        ...goals.map(g => "  - " + g.title + " (" + g.progress + "% progress)"),
        "",
        "AI Employees (" + employees.length + "):",
        ...employees.map(e => "  - " + e.name + " [" + e.role + "]"),
        "",
        "Pending Plans (" + plans.length + "):",
        ...plans.map(p => "  - " + p.title + " [" + p.employeeRole + "] requires: " + p.autonomyRequired)
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } finally {
      db.close();
    }
  }
);

server.tool(
  "import_metric",
  "Add a business metric to the company brain. The brain will use this data in future analysis and reports.",
  {
    category: z.enum(["revenue", "marketing", "sales", "support", "hr", "finance", "operations"]).describe("Business category"),
    metric: z.string().describe("Metric name, e.g. monthly_revenue, leads_generated, csat_score"),
    value: z.number().describe("Numeric value"),
    unit: z.string().describe("Unit: USD, count, percent, score, days, hours, etc."),
    date: z.string().optional().describe("Date in YYYY-MM-DD format (defaults to today)"),
    brand: z.string().optional().describe("Specific brand if multi-brand company"),
    notes: z.string().optional().describe("Additional context or notes")
  },
  async ({ category, metric, value, unit, date, brand, notes }) => {
    const { db, config } = await openResources();
    try {
      const dateStr = date ?? new Date().toISOString().slice(0, 10);
      const brandStr = brand ? " [" + brand + "]" : "";
      const notesStr = notes ? " - " + notes : "";
      const content = dateStr + brandStr + ": " + metric + " = " + value + " " + unit + notesStr;
      await db.createObservation(config.companyId, "mcp_import", category, content);
      return { content: [{ type: "text" as const, text: "Imported: " + content }] };
    } finally {
      db.close();
    }
  }
);

server.tool(
  "search_knowledge",
  "Search your company's uploaded documents and knowledge base using semantic search.",
  { query: z.string().describe("What to search for, e.g. 'pricing strategy' or 'Q3 targets'") },
  async ({ query }) => {
    const { db } = await openResources();
    try {
      const results = db.searchDocuments(query, 8);
      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No documents found matching: " + query }] };
      }
      const text = results.map((r, i) => (i + 1) + ". " + r.content).join("\n\n---\n\n");
      return { content: [{ type: "text" as const, text }] };
    } finally {
      db.close();
    }
  }
);

server.tool(
  "get_plans",
  "List AI-generated action plans that are pending approval.",
  {},
  async () => {
    const { db, config } = await openResources();
    try {
      const plans = await db.getPendingPlans(config.companyId);
      if (plans.length === 0) {
        return { content: [{ type: "text" as const, text: "No pending plans. Run `employeeos start` to generate plans." }] };
      }
      const lines = plans.flatMap((p, i) => [
        (i + 1) + ". " + p.title,
        "   Role: " + p.employeeRole,
        "   Autonomy required: " + p.autonomyRequired,
        ""
      ]);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } finally {
      db.close();
    }
  }
);

// -- Resources -------------------------------------------------------------

server.resource(
  "company-profile",
  "company://profile",
  { description: "JSON snapshot of company info, goals, brands, and employees", mimeType: "application/json" },
  async (uri) => {
    const { db, config } = await openResources();
    try {
      const company = await db.getCompany();
      const goals = await db.getGoals(config.companyId);
      const brands = await db.getBrands(config.companyId);
      const employees = await db.getEmployees(config.companyId);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ company, goals, brands, employees }, null, 2)
        }]
      };
    } finally {
      db.close();
    }
  }
);

server.resource(
  "latest-report",
  "company://report/latest",
  { description: "The latest intelligence report generated for your company", mimeType: "text/plain" },
  async (uri) => {
    const { db, config } = await openResources();
    try {
      const report = await db.getLatestReport(config.companyId);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text: report?.body ?? "No report available. Run `employeeos brief` first."
        }]
      };
    } finally {
      db.close();
    }
  }
);

// -- Start -----------------------------------------------------------------

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
