import type { DatabaseService } from "@employeeos/database";
import type { AIProvider } from "@employeeos/ai";

export interface ActionOutcome {
  action: string;
  expected: string;
  actual: string;
  context?: string;
}

export async function extractLearning(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  outcome: ActionOutcome
): Promise<string | null> {  // returns learningId or null
  const prompt = `Analyze this business outcome and extract a learning:

Action: ${outcome.action}
Expected: ${outcome.expected}
Actual: ${outcome.actual}
${outcome.context ? `Context: ${outcome.context}` : ""}

Extract:
1. Subject (what this learning is about, e.g. "Email campaigns", "Lead quality")
2. Pattern (the specific lesson learned, one sentence)
3. Confidence (0.0-1.0, how certain is this learning)

Reply in this exact format:
Subject: <subject>
Pattern: <pattern>
Confidence: <0.0-1.0>`;

  const result = await ai.generate(prompt, {
    system: "You are a business learning engine. Extract actionable patterns from outcomes.",
    maxTokens: 256
  });

  const subjectMatch = result.match(/Subject:\s*(.+)/i);
  const patternMatch = result.match(/Pattern:\s*(.+)/i);
  const confidenceMatch = result.match(/Confidence:\s*([\d.]+)/i);

  if (!subjectMatch || !patternMatch) return null;

  const subject = subjectMatch[1]!.trim();
  const pattern = patternMatch[1]!.trim();
  const confidence = parseFloat(confidenceMatch?.[1] ?? "0.6");

  const learningId = await db.createLearning(companyId, subject, pattern, confidence);
  await db.createEvent(companyId, "learning.created", { learningId, subject, pattern });

  return learningId;
}

export async function promotePatterns(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string
): Promise<void> {
  const learnings = await db.getRecentLearnings(companyId, 20);
  if (learnings.length < 3) return;

  const learningText = learnings
    .map(l => `[${l.subject}] ${l.pattern} (confidence: ${l.confidence})`)
    .join("\n");

  const prompt = `Review these business learnings and identify meta-patterns:

${learningText}

If there is a strong cross-cutting pattern (high confidence, appears multiple times),
describe it as a single insight. Otherwise reply: none`;

  const result = await ai.generate(prompt, {
    system: "You identify high-level business patterns from individual learnings.",
    maxTokens: 256
  });

  if (result.trim().toLowerCase() !== "none" && result.trim().length > 10) {
    await db.createKnowledge(
      companyId,
      "pattern",
      "Cross-cutting insight",
      result.trim(),
      0.75
    );
  }
}

export async function buildLearningContext(
  db: DatabaseService,
  companyId: string
): Promise<string> {
  const learnings = await db.getRecentLearnings(companyId, 15);
  if (learnings.length === 0) return "No learnings recorded yet.";

  return learnings
    .map(l => `• [${l.subject}] ${l.pattern}`)
    .join("\n");
}
