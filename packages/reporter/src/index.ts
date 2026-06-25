import type { DatabaseService } from "@employeeos/database";
import type { AIProvider } from "@employeeos/ai";

export async function generateFirstReport(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string
): Promise<{ body: string; score: number }> {
  const company = await db.getCompany();
  if (!company) throw new Error("Company not found");

  const goals = await db.getGoals(companyId);
  const integrations = await db.getIntegrations(companyId);
  const employees = await db.getEmployees(companyId);
  const documents = await db.getDocuments(companyId);
  const brands = await db.getBrands(companyId);
  const knowledge = await db.getRecentKnowledge(companyId, 10);

  const docSummaries = documents
    .map(d => `- ${d.filename} (${d.wordCount} words): ${d.contentSummary}`)
    .join("\n");

  const knowledgeContext = knowledge
    .map(k => `- ${k.subject}: ${k.body}`)
    .join("\n");

  const prompt = `You are the Company Brain for ${company.name}.

Company: ${company.name}
Industry: ${company.industry}
Description: ${company.description}
${brands.length > 0 ? `Brands: ${brands.map(b => b.name).join(", ")}` : ""}

Goals:
${goals.map(g => `- ${g.title}`).join("\n")}

Connected Systems:
${integrations.map(i => `- ${i.type}`).join("\n")}

Active Employees:
${employees.map(e => `- ${e.name}`).join("\n")}

${documents.length > 0 ? `Indexed Documents:\n${docSummaries}` : ""}
${knowledge.length > 0 ? `\nKnowledge Base:\n${knowledgeContext}` : ""}

Generate the company's first intelligence brief with:
1. A welcome message to ${company.ceoName}
2. Company overview (2 sentences)
3. Goal analysis — for each goal, one sentence on what the brain will track
4. Top 3 immediate recommendations based on what you know
5. What to expect next (how the brain will work)

Be specific, professional, and genuinely insightful. Not generic.`;

  const body = await ai.generate(prompt, {
    system: `You are the Company Brain — an intelligent system that knows this company deeply and gives sharp, actionable intelligence. Sound like a highly capable Chief of Staff, not a chatbot.`,
    maxTokens: 1500
  });

  const scorePrompt = `Based on this company profile, assign an initial health score from 0-100.

Company: ${company.name}
Industry: ${company.industry}
Goals set: ${goals.length}
Connected integrations: ${integrations.length}
Documents indexed: ${documents.length}
Active employees: ${employees.length}

Consider: goal clarity, system connectivity, knowledge depth.
A company with clear goals, good integrations, and solid documents scores 65-80.
A company just starting (few integrations, no docs) scores 45-60.

Reply with only a number, nothing else.`;

  const scoreResult = await ai.generate(scorePrompt, { maxTokens: 10 });
  const score = Math.min(100, Math.max(0, parseInt(scoreResult.trim()) || 55));

  return { body, score };
}

export async function generateMorningBrief(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string
): Promise<{ title: string; body: string; score: number }> {
  const company = await db.getCompany();
  if (!company) throw new Error("Company not found");

  const goals = await db.getGoals(companyId);
  const learnings = await db.getRecentLearnings(companyId, 10);
  const plans = await db.getPendingPlans(companyId);
  const latestScore = await db.getLatestHealthScore(companyId);
  const knowledge = await db.getRecentKnowledge(companyId, 5);

  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const context = [
    `Company: ${company.name}`,
    `Date: ${date}`,
    `Current Health Score: ${latestScore?.score ?? "Not yet scored"}/100`,
    "",
    `Active Goals (${goals.length}):`,
    goals.map(g => `- ${g.title} (${g.progress}% complete)`).join("\n"),
    "",
    learnings.length > 0
      ? `Recent Learnings:\n${learnings.map(l => `- ${l.pattern}`).join("\n")}`
      : "",
    plans.filter(p => p.status === "pending").length > 0
      ? `Pending Approvals: ${plans.filter(p => p.status === "pending").length} plans awaiting review`
      : "",
    knowledge.length > 0
      ? `Key Knowledge:\n${knowledge.map(k => `- ${k.body}`).join("\n")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `${context}

Generate a morning brief for ${company.ceoName}. Include:
1. Good morning greeting with today's date
2. Company health snapshot
3. Key focus areas for today
4. Any risks or opportunities to address
5. One specific recommendation

Be sharp and specific. No generic platitudes.`;

  const body = await ai.generate(prompt, {
    system: `You are the Company Brain giving ${company.ceoName} their daily morning brief. Be insightful, specific, and action-oriented.`,
    maxTokens: 1000
  });

  const scoreResult = await ai.generate(
    `Given this company context:\n${context}\n\nRate the company health 0-100. Reply with just a number.`,
    { maxTokens: 10 }
  );

  const score = Math.min(
    100,
    Math.max(0, parseInt(scoreResult.trim()) || latestScore?.score || 55)
  );

  const title = `Morning Brief — ${date}`;

  return { title, body, score };
}

export async function generateWeeklyReview(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string
): Promise<string> {
  const company = await db.getCompany();
  if (!company) throw new Error("Company not found");

  const goals = await db.getGoals(companyId);
  const learnings = await db.getRecentLearnings(companyId, 20);
  const recentReports = await db.getRecentReports(companyId, 7);
  const latestScore = await db.getLatestHealthScore(companyId);

  const prompt = `Company: ${company.name}
Week ending: ${new Date().toLocaleDateString()}
Health Score: ${latestScore?.score ?? "N/A"}/100

Goals: ${goals.map(g => `${g.title} (${g.progress}%)`).join(", ")}

Learnings this week:
${learnings.map(l => `- ${l.pattern}`).join("\n")}

Recent briefs summary:
${recentReports.slice(0, 3).map(r => r.title).join("\n")}

Generate a weekly executive review with:
1. Week summary (what happened, key metrics)
2. Wins
3. Losses / areas to improve
4. Patterns discovered
5. Priorities for next week

Be executive-level sharp. No fluff.`;

  const body = await ai.generate(prompt, {
    system: "You produce crisp weekly executive reviews for company leadership.",
    maxTokens: 1200
  });

  const title = `Weekly Review — Week of ${new Date().toLocaleDateString()}`;
  await db.createReport(companyId, title, body, "weekly_review", latestScore?.score);

  return body;
}

export async function answerQuestion(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  question: string
): Promise<string> {
  const company = await db.getCompany();
  if (!company) throw new Error("Company not found");

  const goals = await db.getGoals(companyId);
  const learnings = await db.getRecentLearnings(companyId, 15);
  const knowledge = await db.getRecentKnowledge(companyId, 15);
  const latestScore = await db.getLatestHealthScore(companyId);
  const brands = await db.getBrands(companyId);

  const searchResults = question.split(" ").length > 2
    ? db.searchDocuments(question.split(" ").slice(0, 3).join(" "), 3)
    : [];

  const context = [
    `Company: ${company.name} (${company.industry})`,
    `Description: ${company.description}`,
    brands.length > 0 ? `Brands: ${brands.map(b => b.name).join(", ")}` : "",
    `Health Score: ${latestScore?.score ?? "N/A"}/100`,
    "",
    `Goals:\n${goals.map(g => `- ${g.title}`).join("\n")}`,
    "",
    learnings.length > 0
      ? `Learnings:\n${learnings.map(l => `- [${l.subject}] ${l.pattern}`).join("\n")}`
      : "",
    knowledge.length > 0
      ? `\nKnowledge:\n${knowledge.map(k => `- ${k.subject}: ${k.body}`).join("\n")}`
      : "",
    searchResults.length > 0
      ? `\nRelevant documents:\n${searchResults.map(r => `- ${r.filename}: ${r.content.slice(0, 200)}`).join("\n")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

  return ai.generate(question, {
    system: `You are the Company Brain for ${company.name}. Answer based on what you know about this company. Be specific and direct. If you don't have enough information, say what you'd need to give a better answer.\n\n${context}`,
    maxTokens: 800
  });
}

export async function computeHealthScore(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string
): Promise<number> {
  const company = await db.getCompany();
  if (!company) return 50;

  const goals = await db.getGoals(companyId);
  const integrations = await db.getIntegrations(companyId);
  const documents = await db.getDocuments(companyId);
  const learnings = await db.getRecentLearnings(companyId, 5);
  const employees = await db.getEmployees(companyId);

  const prompt = `Rate this company's operational health from 0-100:

Company: ${company.name} (${company.industry})
Goals defined: ${goals.length} (progress: ${goals.map(g => g.progress).join("%, ")}%)
Connected systems: ${integrations.length}
Documents indexed: ${documents.length}
Active employees: ${employees.length}
Recent learnings: ${learnings.length}

Reply with only a number.`;

  const result = await ai.generate(prompt, { maxTokens: 10 });
  const score = Math.min(100, Math.max(0, parseInt(result.trim()) || 55));

  await db.createHealthScore(companyId, score, {});
  return score;
}
