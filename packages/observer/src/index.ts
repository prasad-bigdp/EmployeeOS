import type { DatabaseService } from "@employeeos/database";
import type { AIProvider } from "@employeeos/ai";

export interface Signal {
  source: string;
  type: string;
  content: string;
}

export async function processSignal(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  signal: Signal
): Promise<string> {
  const observationId = await db.createObservation(
    companyId,
    signal.source,
    signal.type,
    signal.content
  );

  await db.createEvent(companyId, "observation.created", {
    observationId,
    source: signal.source,
    type: signal.type
  });

  return observationId;
}

export async function detectAnomalies(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string
): Promise<string[]> {
  const observations = await db.getUnprocessedObservations(companyId);
  if (observations.length === 0) return [];

  const recentContent = observations
    .slice(-10)
    .map(o => `[${o.source}] ${o.content}`)
    .join("\n");

  const company = await db.getCompany();
  if (!company) return [];

  const prompt = `You are the observer for ${company.name}.

Recent signals:
${recentContent}

Identify any anomalies, drops, or risks. List each as one short sentence.
If nothing significant, reply: none`;

  const result = await ai.generate(prompt, {
    system: "You are a business intelligence observer. Be concise and specific.",
    maxTokens: 512
  });

  if (result.trim().toLowerCase() === "none") return [];

  return result
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("#"));
}

export async function synthesizeObservations(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string
): Promise<string> {
  const observations = await db.getUnprocessedObservations(companyId);
  const knowledge = await db.getRecentKnowledge(companyId, 10);

  if (observations.length === 0) {
    return "No new observations to synthesize.";
  }

  const obsText = observations
    .slice(-15)
    .map(o => `${o.signalType}: ${o.content}`)
    .join("\n");

  const knowledgeText = knowledge
    .map(k => `${k.subject}: ${k.body}`)
    .join("\n");

  const company = await db.getCompany();

  const prompt = `Company: ${company?.name ?? "Unknown"}

Recent observations:
${obsText}

Existing knowledge:
${knowledgeText}

Synthesize what is happening in the business right now. Be specific. 2-3 sentences.`;

  return ai.generate(prompt, {
    system: "You are a business analyst synthesizing real-time company signals.",
    maxTokens: 400
  });
}
