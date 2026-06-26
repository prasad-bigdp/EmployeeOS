import type { DatabaseService } from "@employeeos/database";
import type { AIProvider } from "@employeeos/ai";
import type { PlanStep, ToolName } from "@employeeos/shared";

export interface Opportunity {
  title: string;
  impact: "high" | "medium" | "low";
  effort: "high" | "medium" | "low";
  rationale: string;
}

export async function rankOpportunities(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string
): Promise<Opportunity[]> {
  const company = await db.getCompany();
  if (!company) return [];

  const goals = await db.getGoals(companyId);
  const learnings = await db.getRecentLearnings(companyId, 10);
  const knowledge = await db.getRecentKnowledge(companyId, 10);

  const context = [
    `Company: ${company.name}`,
    `Goals: ${goals.map(g => g.title).join(", ")}`,
    learnings.length > 0
      ? `Recent learnings:\n${learnings.map(l => `- ${l.pattern}`).join("\n")}`
      : "",
    knowledge.length > 0
      ? `Knowledge:\n${knowledge.slice(0, 5).map(k => `- ${k.body}`).join("\n")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = `${context}

Identify the top 3 opportunities to improve this company right now.
For each, provide:
- Title (short, action-oriented)
- Impact: high/medium/low
- Effort: high/medium/low
- Rationale (one sentence)

Format as JSON array:
[{"title":"...","impact":"high","effort":"low","rationale":"..."}]`;

  const result = await ai.generate(prompt, {
    system: "You are a business strategist identifying high-ROI opportunities.",
    maxTokens: 512
  });

  try {
    const match = result.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]) as Opportunity[];
  } catch {
    return [];
  }
}

const VALID_TOOLS: ToolName[] = [
  "github", "slack", "gmail", "notion", "hubspot", "stripe", "composio", "browser",
  "googlecalendar", "googledrive", "linear", "jira",
];

export async function composePlan(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  employeeRole: string,
  opportunity: Opportunity
): Promise<string> {
  const prompt = `You are the ${employeeRole} for a company.

Opportunity: ${opportunity.title}
Rationale: ${opportunity.rationale}

Create a 3–5 step action plan. Each step must use one of these tools:
github (create_issue, comment_on_issue, create_pr, label_issue, close_issue),
slack (SLACK_SEND_MESSAGE),
gmail (GMAIL_SEND_EMAIL),
notion (NOTION_CREATE_PAGE),
hubspot (HUBSPOT_CREATE_DEAL),
stripe (no operations — use browser for research instead),
browser (research, extract_metrics),
composio (any SaaS action).

Return ONLY a JSON array, no extra text:
[
  {
    "tool": "github",
    "operation": "create_issue",
    "input": {"title": "...", "body": "..."},
    "expectedOutcome": "Issue created for tracking the task"
  }
]`;

  const result = await ai.generate(prompt, {
    system: "You create precise, executable business plans. Return only valid JSON.",
    maxTokens: 700,
  });

  const match = result.match(/\[[\s\S]*?\]/);
  const rawSteps: Array<{
    tool?: string;
    operation?: string;
    input?: Record<string, unknown>;
    expectedOutcome?: string;
  }> = match ? (JSON.parse(match[0]) as typeof rawSteps) : [];

  const steps: PlanStep[] = rawSteps.map(s => ({
    id: crypto.randomUUID(),
    tool: (VALID_TOOLS.includes(s.tool as ToolName) ? s.tool : "browser") as ToolName,
    operation: s.operation ?? "research",
    input: s.input ?? {},
    expectedOutcome: s.expectedOutcome,
    status: "pending" as const,
  }));

  const planId = await db.createPlan(
    companyId,
    employeeRole,
    opportunity.title,
    steps,
    "recommend"
  );

  await db.createEvent(companyId, "plan.created", {
    planId,
    title: opportunity.title,
    employeeRole,
  });

  return planId;
}
