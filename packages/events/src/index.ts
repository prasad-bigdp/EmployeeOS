import Emittery from "emittery";

export type EmployeeOSEvent =
  | "observation.created"
  | "plan.created"
  | "plan.approved"
  | "plan.rejected"
  | "plan.executed"
  | "plan.failed"
  | "learning.created"
  | "report.generated"
  | "task.completed";

export function createEventBus() {
  return new Emittery<{ [K in EmployeeOSEvent]: unknown }>();
}
