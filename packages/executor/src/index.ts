import type { DatabaseService } from "@employeeos/database";
import type { AIProvider } from "@employeeos/ai";
import { extractLearning } from "@employeeos/learner";

export async function executeApprovedPlans(
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  onLog?: (msg: string) => void
): Promise<number> {
  const log = onLog ?? (() => {});

  const allPlans = await db.getPendingPlans(companyId);
  const approved = allPlans.filter(p => p.status === "approved");
  if (approved.length === 0) return 0;

  const company = await db.getCompany();
  let executed = 0;

  for (const plan of approved) {
    log(`Executor: running "${plan.title}" [${plan.employeeRole}]...`);
    const executionId = await db.createExecution(companyId, plan.id);

    try {
      const actions = JSON.parse(plan.actions || "[]") as string[];

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

      const now = new Date().toISOString();
      await db.updateExecution(executionId, {
        status: "done",
        outcome,
        learningId: learningId ?? undefined,
        completedAt: now,
      });

      await db.updatePlanStatus(plan.id, "done");
      await db.createEvent(companyId, "plan.executed", {
        planId: plan.id,
        title: plan.title,
        role: plan.employeeRole,
        executionId,
        outcome,
      });

      executed++;
      log(`Executor: "${plan.title}" done`);
    } catch (err) {
      const error = (err as Error).message;
      log(`Executor: "${plan.title}" failed — ${error}`);

      await db.updateExecution(executionId, {
        status: "failed",
        error,
        completedAt: new Date().toISOString(),
      });
      await db.updatePlanStatus(plan.id, "failed");
      await db.createEvent(companyId, "plan.failed", {
        planId: plan.id,
        title: plan.title,
        executionId,
        error,
      });
    }
  }

  return executed;
}
