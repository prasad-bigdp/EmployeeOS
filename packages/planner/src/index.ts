import type { DatabaseService } from "@employeeos/database";
import type { AIProvider } from "@employeeos/ai";

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

Create a 3-5 step action plan to execute this opportunity.
Format as JSON array:
[{"step":1,"description":"...","tool":"optional_tool_name"}]`;

  const result = await ai.generate(prompt, {
    system: "You create precise, executable business plans.",
    maxTokens: 512
  });

  const match = result.match(/\[[\s\S]*\]/);
  const actions = match ? JSON.parse(match[0]) : [];

  const planId = await db.createPlan(
    companyId,
    employeeRole,
    opportunity.title,
    actions,
    "recommend"
  );

  await db.createEvent(companyId, "plan.created", {
    planId,
    title: opportunity.title,
    employeeRole
  });

  return planId;
}
