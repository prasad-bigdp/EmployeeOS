import type { DatabaseService } from "@employeeos/database";
import type { AIProvider } from "@employeeos/ai";
import type { PlanStep } from "@employeeos/shared";
import { extractLearning } from "@employeeos/learner";

export interface ToolConfig {
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;
  composioApiKey?: string;
}

interface ExecutionContext {
  db: DatabaseService;
  ai: AIProvider;
  companyId: string;
  toolConfig: ToolConfig;
}

interface StepResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

// ── Tool runners ─────────────────────────────────────────────────────────────

async function runGitHubStep(step: PlanStep, ctx: ExecutionContext): Promise<StepResult> {
  const { githubToken, githubOwner, githubRepo } = ctx.toolConfig;
  if (!githubToken) {
    return { success: false, error: "GitHub token not configured. Run: employeeos github" };
  }
  try {
    const { runGitHubOperation } = await import("@employeeos/github");
    const result = await runGitHubOperation(
      { token: githubToken, owner: githubOwner, repo: githubRepo },
      step.operation,
      step.input
    );
    return { success: true, result: result as Record<string, unknown> };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function runComposioStep(step: PlanStep, ctx: ExecutionContext): Promise<StepResult> {
  const { composioApiKey } = ctx.toolConfig;
  if (!composioApiKey) {
    return { success: false, error: "Composio API key not configured. Run: employeeos connect" };
  }
  try {
    const { executeAction, getConnectionForApp } = await import("@employeeos/composio");
    const appName = step.tool === "composio"
      ? (step.input.app as string | undefined) ?? "unknown"
      : step.tool;
    const conn = await getConnectionForApp(composioApiKey, appName);
    const result = await executeAction(composioApiKey, step.operation, step.input, conn?.id);
    if (!result.successfull) {
      return { success: false, error: result.error ?? "Composio action failed" };
    }
    return { success: true, result: result.data };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function runBrowserStep(step: PlanStep, ctx: ExecutionContext): Promise<StepResult> {
  const url = step.input["url"] as string | undefined;
  if (!url) {
    return { success: false, error: "Browser step requires input.url" };
  }
  const task =
    (step.input["task"] as string | undefined) ??
    (step.input["query"] as string | undefined) ??
    step.expectedOutcome ??
    step.operation;
  try {
    const { browseAndExtractMetrics } = await import("@employeeos/browser");
    const { metrics, summary } = await browseAndExtractMetrics(
      url, task, ctx.ai, ctx.db, ctx.companyId
    );
    return { success: true, result: { url, metricsCount: metrics.length, summary } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function runAIFallbackStep(step: PlanStep, ctx: ExecutionContext): Promise<StepResult> {
  const prompt = `You are executing a plan step as a business action engine.
Tool: ${step.tool}
Operation: ${step.operation}
Input: ${JSON.stringify(step.input, null, 2)}
Expected outcome: ${step.expectedOutcome ?? "complete the operation successfully"}

Write a concrete execution report (2-3 sentences) describing exactly what was done and the expected outcome.`;

  const text = await ctx.ai.generate(prompt, {
    system: "You are a business execution engine. Be specific and action-oriented.",
    maxTokens: 300,
  });
  return { success: true, result: { text } };
}

async function dispatchStep(step: PlanStep, ctx: ExecutionContext): Promise<StepResult> {
  switch (step.tool) {
    case "github":
      return runGitHubStep(step, ctx);
    case "slack":
    case "gmail":
    case "notion":
    case "hubspot":
    case "stripe":
    case "googlecalendar":
    case "googledrive":
    case "linear":
    case "jira":
    case "composio":
      return runComposioStep(step, ctx);
    case "browser":
      return runBrowserStep(step, ctx);
    default:
      return runAIFallbackStep(step, ctx);
  }
}

// ── Main executor ─────────────────────────────────────────────────────────────

export async function executeApprovedPlans(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  onLog?: (msg: string) => void,
  toolConfig?: ToolConfig
): Promise<number> {
  const log = onLog ?? (() => {});
  const ctx: ExecutionContext = { db, ai, companyId, toolConfig: toolConfig ?? {} };

  const approved = await db.getApprovedPlans(companyId);
  if (approved.length === 0) return 0;

  const company = await db.getCompany();
  let executed = 0;

  for (const plan of approved) {
    log(`Executor: running "${plan.title}" [${plan.employeeRole}]...`);
    const executionId = await db.createExecution(companyId, plan.id);

    try {
      const rawActions = JSON.parse(plan.actions || "[]") as unknown[];
      // PlanStep requires both `tool` and `operation`; legacy { step, description, tool? }
      // only has an optional tool but never has operation — check for both.
      const isStructured =
        rawActions.length > 0 &&
        typeof rawActions[0] === "object" &&
        rawActions[0] !== null &&
        "tool" in (rawActions[0] as object) &&
        "operation" in (rawActions[0] as object);

      if (!isStructured) {
        // Legacy string-array plans — AI text generation only
        const actions = rawActions as string[];
        const prompt = `You are the EmployeeOS execution engine for ${company?.name ?? "the company"}.

Plan: ${plan.title}
Employee role: ${plan.employeeRole}
Actions:
${actions.map((a, i) => `${i + 1}. ${a}`).join("\n")}

Write a brief execution report (3-5 sentences):
- What was done for each action
- Expected outcome and timeline
- Any blockers that need human follow-up`;

        const outcome = await ai.generate(prompt, {
          system: "You are a business execution engine. Be specific and action-oriented.",
          maxTokens: 400,
        });

        const learningId = await extractLearning(db, ai, companyId, {
          action: plan.title,
          expected: actions.join("; "),
          actual: outcome,
          context: `Executed by ${plan.employeeRole}`,
        });

        await db.updateExecution(executionId, {
          status: "done",
          outcome,
          learningId: learningId ?? undefined,
          completedAt: new Date().toISOString(),
        });
        await db.updatePlanStatus(plan.id, "done");
        await db.createEvent(companyId, "plan.executed", {
          planId: plan.id, title: plan.title, role: plan.employeeRole, executionId, outcome,
        });
        executed++;
        log(`Executor: "${plan.title}" done`);
        continue;
      }

      // Structured step execution
      const steps = rawActions as PlanStep[];
      let anyFailed = false;
      let anyBlocked = false;
      const stepSummaries: string[] = [];

      for (const step of steps) {
        log(`Executor: step [${step.tool}:${step.operation}]...`);

        // Security: block dangerous ops unless autonomy level permits it
        const dangerousOps = ["delete", "destroy", "drop", "truncate"];
        const isDangerous = dangerousOps.some(op => step.operation.toLowerCase().includes(op));
        if (isDangerous && plan.autonomyRequired === "observe") {
          const stepId = await db.createExecutionStep(
            executionId, companyId, step.tool, step.operation, step.input, step.expectedOutcome
          );
          await db.updateExecutionStep(stepId, {
            status: "skipped",
            error: "Blocked — autonomy level is 'observe'. Raise to 'execute' to allow this action.",
            completedAt: new Date().toISOString(),
          });
          // step.blocked — distinct from step.failed so observers can separate policy from errors
          await db.createEvent(companyId, "step.blocked", {
            executionId, stepId, tool: step.tool, operation: step.operation, reason: "autonomy_blocked",
          });
          stepSummaries.push(`[BLOCKED] ${step.tool}:${step.operation} — requires execute autonomy`);
          anyBlocked = true;
          continue;
        }

        const stepId = await db.createExecutionStep(
          executionId, companyId, step.tool, step.operation, step.input, step.expectedOutcome
        );
        const now = new Date().toISOString();
        await db.updateExecutionStep(stepId, { status: "running", startedAt: now });
        await db.createEvent(companyId, "step.started", {
          executionId, stepId, tool: step.tool, operation: step.operation,
        });

        const stepResult = await dispatchStep(step, ctx);

        if (stepResult.success) {
          await db.updateExecutionStep(stepId, {
            status: "done",
            result: stepResult.result,
            completedAt: new Date().toISOString(),
          });
          await db.createEvent(companyId, "step.completed", {
            executionId, stepId, tool: step.tool, operation: step.operation,
            result: stepResult.result,
          });
          const summary = stepResult.result?.text
            ? String(stepResult.result.text).slice(0, 120)
            : JSON.stringify(stepResult.result ?? {}).slice(0, 120);
          stepSummaries.push(`[OK] ${step.tool}:${step.operation} → ${summary}`);
          log(`Executor: step [${step.tool}:${step.operation}] done`);
        } else {
          await db.updateExecutionStep(stepId, {
            status: "failed",
            error: stepResult.error,
            completedAt: new Date().toISOString(),
          });
          await db.createEvent(companyId, "step.failed", {
            executionId, stepId, tool: step.tool, operation: step.operation, error: stepResult.error,
          });
          stepSummaries.push(`[FAILED] ${step.tool}:${step.operation} — ${stepResult.error}`);
          log(`Executor: step [${step.tool}:${step.operation}] failed — ${stepResult.error}`);
          anyFailed = true;
        }
      }

      const combinedOutcome = stepSummaries.join("\n");
      // "blocked" = policy stopped steps but nothing errored; "failed" = a step threw
      const finalStatus = anyFailed ? "failed" : anyBlocked ? "blocked" : "done";
      const eventType =
        anyFailed ? "plan.failed" : anyBlocked ? "plan.blocked" : "plan.executed";

      const learningId = await extractLearning(db, ai, companyId, {
        action: plan.title,
        expected: steps.map(s => `${s.tool}:${s.operation}`).join("; "),
        actual: combinedOutcome,
        context: `Executed by ${plan.employeeRole}`,
      });

      await db.updateExecution(executionId, {
        status: finalStatus,
        outcome: combinedOutcome,
        learningId: learningId ?? undefined,
        completedAt: new Date().toISOString(),
      });
      await db.updatePlanStatus(plan.id, finalStatus);
      await db.createEvent(companyId, eventType, {
        planId: plan.id, title: plan.title, role: plan.employeeRole,
        executionId, stepCount: steps.length, anyFailed, anyBlocked,
      });

      executed++;
      log(`Executor: "${plan.title}" ${finalStatus} (${steps.length} steps)`);
    } catch (err) {
      const error = (err as Error).message;
      log(`Executor: "${plan.title}" failed — ${error}`);
      await db.updateExecution(executionId, {
        status: "failed", error, completedAt: new Date().toISOString(),
      });
      await db.updatePlanStatus(plan.id, "failed");
      await db.createEvent(companyId, "plan.failed", {
        planId: plan.id, title: plan.title, executionId, error,
      });
    }
  }

  return executed;
}
