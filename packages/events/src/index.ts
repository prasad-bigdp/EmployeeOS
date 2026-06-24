import Emittery from "emittery";

export type EmployeeOSEvent =
  | "observation.created"
  | "plan.created"
  | "task.completed"
  | "learning.created"
  | "report.generated";

export function createEventBus() {
  return new Emittery<{ [K in EmployeeOSEvent]: unknown }>();
}
