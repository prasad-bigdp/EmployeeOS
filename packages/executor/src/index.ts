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

      await db.updatePlanStatus(plan.id, "done");
      await db.createEvent(companyId, "plan.executed", {
        planId: plan.id,
        title: plan.title,
        role: plan.employeeRole,
        outcome,
      });

      // Feed result into the learning engine so future ticks benefit
      await extractLearning(db, ai, companyId, {
        action: plan.title,
        expected: actions.join("; "),
        actual: outcome,
        context: `Executed by ${plan.employeeRole}`,
      });

      executed++;
      log(`Executor: "${plan.title}" done — learning extracted`);
    } catch (err) {
      log(`Executor: "${plan.title}" failed — ${(err as Error).message}`);
    }
  }

  return executed;
}
