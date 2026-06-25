import type { DatabaseService } from "@employeeos/database";
import type { AIProvider } from "@employeeos/ai";
import { detectAnomalies, synthesizeObservations } from "@employeeos/observer";
import { promotePatterns } from "@employeeos/learner";
import { executeApprovedPlans } from "@employeeos/executor";
import { rankOpportunities, composePlan } from "@employeeos/planner";
import { getOrGenerateBrief, generateWeeklyReview, computeHealthScore } from "@employeeos/reporter";
import type { ImapConfig } from "@employeeos/email";

export interface BrainLoop {
  stop(): void;
}

export interface BrainTickResult {
  anomalies: string[];
  synthesis: string;
  newPlans: number;
  executedPlans: number;
}

// -- Sub-agent spawning -------------------------------------------------------
// Each task runs as an independent AI call. Tasks are fired in parallel.

export interface SubAgentTask {
  role: string;
  task: string;
  context: string;
}

export async function spawnParallelAgents(
  tasks: SubAgentTask[],
  ai: AIProvider,
  onLog?: (msg: string) => void
): Promise<string[]> {
  const log = onLog ?? (() => {});
  log(`[agents] Spawning ${tasks.length} sub-agents in parallel...`);

  const results = await Promise.all(
    tasks.map(async ({ role, task, context }) => {
      log(`[agent:${role}] ${task.slice(0, 60)}...`);
      const result = await ai.generate(
        `You are a specialized ${role}.\n\nTask: ${task}\n\nContext:\n${context}\n\nBe concise and actionable:`,
        { system: `You are a ${role} specialist. Answer with specific, data-driven insights.`, maxTokens: 400 }
      );
      log(`[agent:${role}] done`);
      return result;
    })
  );

  return results;
}

// -- Per-employee focused tick ------------------------------------------------
// Each hired AI employee runs their own domain analysis using parallel sub-agents

interface EmployeeTickResult {
  role: string;
  plansCreated: number;
  insight: string;
}

async function runEmployeeTick(
  employee: { id: string; name: string; role: string },
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  onLog?: (msg: string) => void,
  extraContext?: string
): Promise<EmployeeTickResult> {
  const log = onLog ?? (() => {});
  const role = employee.role;

  // Domain focus per role
  const domainFocus: Record<string, string> = {
    "ceo-assistant":      "overall company strategy, goal progress, cross-department alignment",
    "marketing-manager":  "leads, campaigns, brand metrics, website traffic, ad spend efficiency",
    "sales-manager":      "pipeline, win rate, deal velocity, revenue targets, conversion rate",
    "support-manager":    "ticket volume, CSAT score, resolution time, churn risk, NPS",
    "finance-manager":    "burn rate, gross margin, LTV:CAC ratio, runway, cost efficiency",
    "hr-manager":         "headcount, team morale, hiring velocity, performance, retention"
  };

  const domain = domainFocus[role] ?? "general business metrics";
  const learnings = await db.getRecentLearnings(companyId, 5);
  const observations = await db.getRecentObservations(companyId, 10);
  const goals = await db.getGoals(companyId);

  const baseContext = [
    `Goals: ${goals.map(g => g.title).join(", ")}`,
    `Recent learnings: ${learnings.slice(0, 3).map(l => l.pattern).join("; ")}`,
    `Recent signals: ${observations.slice(0, 5).map(o => o.content.slice(0, 80)).join("; ")}`,
    extraContext ? `\n${extraContext}` : ""
  ].filter(Boolean).join("\n");

  // Spawn 2 parallel sub-agents for this employee's domain
  log(`[${role}] Researching ${domain}...`);
  const [signalInsight, actionInsight] = await spawnParallelAgents(
    [
      {
        role: `${role} analyst`,
        task: `Analyze the current state of ${domain} for this company. What's working? What's at risk?`,
        context: baseContext
      },
      {
        role: `${role} strategist`,
        task: `Given the goals and recent signals, what's the single most important action for ${domain} right now?`,
        context: baseContext
      }
    ],
    ai,
    onLog
  );

  const combinedInsight = `${signalInsight}\n\nRecommended action: ${actionInsight}`;

  // Save as knowledge
  await db.createKnowledge(companyId, "pattern", `${role} analysis`, combinedInsight.slice(0, 500), 0.8);

  // Create a plan if the insight suggests action
  let plansCreated = 0;
  const shouldPlan = combinedInsight.toLowerCase().includes("should") ||
                     combinedInsight.toLowerCase().includes("recommend") ||
                     combinedInsight.toLowerCase().includes("action") ||
                     combinedInsight.toLowerCase().includes("improve");

  if (shouldPlan) {
    const opportunities = await rankOpportunities(db, ai, companyId);
    const roleOpps = opportunities.filter(o =>
      o.impact === "high" || o.effort === "low"
    ).slice(0, 1);

    for (const opp of roleOpps) {
      await composePlan(db, ai, companyId, role, opp);
      plansCreated++;
      log(`[${role}] Plan created: ${opp.title}`);
    }
  }

  return { role, plansCreated, insight: combinedInsight };
}

// -- Hourly tick: parallel employee execution ---------------------------------

export async function hourlyTick(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  onLog?: (msg: string) => void,
  onNotify?: (msg: string) => void,
  extraContext?: string,
  imapConfig?: ImapConfig
): Promise<BrainTickResult> {
  const log = onLog ?? (() => {});
  const notify = onNotify ?? (() => {});

  // Pull inbox emails as observations before analyzing signals
  if (imapConfig) {
    try {
      log("Email: reading inbox for business signals...");
      const { readInboxMessages } = await import("@employeeos/email");

      // Deduplication: only fetch emails newer than the last successful tick
      const checkpointKey = `imap_checkpoint:${companyId}`;
      const lastSeen = await db.getMeta(checkpointKey);
      const since = lastSeen
        ? new Date(lastSeen)
        : new Date(Date.now() - 24 * 60 * 60 * 1000);

      const messages = await readInboxMessages(imapConfig, since, 30);
      if (messages.length > 0) {
        const prompt = `You are a business signal extractor. Given these emails, classify each as a business signal.
For each email write one line: SIGNAL|index|category|one-sentence summary
index = the number in brackets before the email (e.g. 1, 2, 3)
Categories: sales, support, hr, finance, operations, marketing, other
Skip newsletters, automated alerts, and spam — only include genuine human communication.

Emails:
${messages.map((m, i) => `[${i}] From: ${m.from}\nSubject: ${m.subject}\n${m.text.slice(0, 300)}`).join("\n---\n")}`;

        const result = await ai.generate(prompt, {
          system: "Extract only meaningful business signals. Be terse.",
          maxTokens: 600,
        });

        let imported = 0;
        for (const line of result.split("\n")) {
          if (!line.startsWith("SIGNAL|")) continue;
          const parts = line.split("|");
          const idx = parseInt(parts[1] ?? "");
          const category = parts[2]?.trim();
          const summary = parts[3]?.trim();
          if (!category || !summary) continue;

          const email = isNaN(idx) ? undefined : messages[idx];
          const obsId = await db.createObservation(
            companyId, "email_inbox", category,
            `${new Date().toISOString().slice(0, 10)}: ${summary}`
          );
          await db.createEvent(companyId, "observation.created", {
            source: "email_inbox",
            observationId: obsId,
            summary,
            subject: email?.subject ?? "",
            from: email?.from ?? "",
            messageId: email?.messageId ?? "",
          });
          imported++;
        }
        if (imported > 0) {
          log(`Email: ${imported} signal${imported > 1 ? "s" : ""} imported from ${messages.length} emails`);
        }
      } else {
        log("Email: no new messages since last tick");
      }

      // Advance checkpoint so next tick only fetches newer messages
      await db.setMeta(checkpointKey, new Date().toISOString());
    } catch (err) {
      log(`Email: inbox read failed — ${(err as Error).message}`);
    }
  }

  log("Observer: scanning for signals...");
  const anomalies = await detectAnomalies(db, ai, companyId);
  if (anomalies.length > 0) {
    notify(`Brain detected ${anomalies.length} anomaly${anomalies.length > 1 ? "s" : ""}: ${anomalies[0]}`);
  }

  log("Observer: synthesizing observations...");
  const synthesis = await synthesizeObservations(db, ai, companyId);

  // Mark all observations consumed this tick so they aren't re-analyzed next hour
  await db.markAllObservationsProcessed(companyId);

  log("Learner: promoting patterns...");
  await promotePatterns(db, ai, companyId);

  log("Executor: running approved plans...");
  const executedPlans = await executeApprovedPlans(db, ai, companyId, onLog);
  if (executedPlans > 0) {
    notify(`${executedPlans} plan${executedPlans > 1 ? "s" : ""} executed — learnings recorded`);
  }

  // Run all employees in parallel — each is a focused sub-agent team
  const employees = await db.getEmployees(companyId);
  if (employees.length > 0) {
    log(`Employees: running ${employees.length} agents in parallel...`);
    const settled = await Promise.allSettled(
      employees.map(emp => runEmployeeTick(emp, db, ai, companyId, onLog, extraContext))
    );
    const results = settled
      .filter((r): r is PromiseFulfilledResult<EmployeeTickResult> => r.status === "fulfilled")
      .map(r => r.value);
    settled
      .filter(r => r.status === "rejected")
      .forEach((r, i) => log(`[agent:${employees[i]?.role}] error: ${(r as PromiseRejectedResult).reason}`));
    const totalPlans = results.reduce((n, r) => n + r.plansCreated, 0);
    if (totalPlans > 0) {
      notify(`${totalPlans} new AI plan${totalPlans > 1 ? "s" : ""} created — review with: employeeos plans`);
    }
    log(`Hourly tick complete. Anomalies: ${anomalies.length}, Plans created: ${totalPlans}`);
    return { anomalies, synthesis, newPlans: totalPlans, executedPlans };
  }

  // Fallback: no employees hired, run CEO analysis
  log("Planner: identifying opportunities (no employees, using CEO mode)...");
  const opportunities = await rankOpportunities(db, ai, companyId);
  let newPlans = 0;
  for (const opp of opportunities.filter(o => o.impact === "high" || o.effort === "low").slice(0, 2)) {
    await composePlan(db, ai, companyId, "ceo-assistant", opp);
    newPlans++;
  }
  if (newPlans > 0) notify(`${newPlans} new AI plan${newPlans > 1 ? "s" : ""} ready — review with: employeeos plans`);
  log(`Hourly tick complete. Anomalies: ${anomalies.length}, New plans: ${newPlans}, Executed: ${executedPlans}`);
  return { anomalies, synthesis, newPlans, executedPlans };
}

// -- Daily tick ---------------------------------------------------------------

export async function dailyTick(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  onLog?: (msg: string) => void,
  onNotify?: (msg: string) => void
): Promise<void> {
  const log = onLog ?? (() => {});
  const notify = onNotify ?? (() => {});

  log("Reporter: generating morning brief...");
  const brief = await getOrGenerateBrief(db, ai, companyId);
  const briefScore = brief.score;

  log("Scoring: computing health score...");
  await computeHealthScore(db, ai, companyId);

  notify(`Morning Brief ready. Health score: ${briefScore ?? "—"}/100`);
  log("Daily tick complete.");
}

// -- Weekly tick --------------------------------------------------------------

export async function weeklyTick(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  onLog?: (msg: string) => void,
  onNotify?: (msg: string) => void
): Promise<void> {
  const log = onLog ?? (() => {});
  const notify = onNotify ?? (() => {});
  log("Reporter: generating weekly review...");
  await generateWeeklyReview(db, ai, companyId);
  notify("Weekly executive review generated — check your dashboard.");
  log("Weekly tick complete.");
}

// -- Brain loop ---------------------------------------------------------------

export interface BrainLoopOptions {
  onLog?: (msg: string) => void;
  onNotify?: (msg: string) => void;
  extraContext?: string;
  imapConfig?: ImapConfig;
}

export function startBrainLoop(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  onLogOrOptions?: ((msg: string) => void) | BrainLoopOptions,
  onNotify?: (msg: string) => void
): BrainLoop {
  // Accept both legacy (onLog fn) and new (options object) calling conventions
  let onLog: ((msg: string) => void) | undefined;
  let notifyFn: ((msg: string) => void) | undefined;

  if (typeof onLogOrOptions === "function") {
    onLog = onLogOrOptions;
    notifyFn = onNotify;
  } else if (onLogOrOptions) {
    onLog = onLogOrOptions.onLog;
    notifyFn = onLogOrOptions.onNotify;
  }

  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const WEEK_MS = 7 * DAY_MS;

  const extraCtx = typeof onLogOrOptions === "object" ? onLogOrOptions.extraContext : undefined;
  const imapCfg = typeof onLogOrOptions === "object" ? onLogOrOptions.imapConfig : undefined;

  const hourlyTimer = setInterval(
    () => hourlyTick(db, ai, companyId, onLog, notifyFn, extraCtx, imapCfg).catch(console.error),
    HOUR_MS
  );
  const dailyTimer = setInterval(
    () => dailyTick(db, ai, companyId, onLog, notifyFn).catch(console.error),
    DAY_MS
  );
  const weeklyTimer = setInterval(
    () => weeklyTick(db, ai, companyId, onLog, notifyFn).catch(console.error),
    WEEK_MS
  );

  return {
    stop() {
      clearInterval(hourlyTimer);
      clearInterval(dailyTimer);
      clearInterval(weeklyTimer);
    }
  };
}
