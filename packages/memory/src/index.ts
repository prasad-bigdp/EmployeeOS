import type { MemoryKind } from "@employeeos/shared";

export interface MemoryBucket {
  kind: MemoryKind;
  name: string;
  storage: "sqlite" | "lancedb";
  description: string;
}

export const memoryBuckets: MemoryBucket[] = [
  {
    kind: "company",
    name: "Company Memory",
    storage: "sqlite",
    description: "Companies, employees, goals, knowledge, events, reports"
  },
  {
    kind: "historical",
    name: "Historical Memory",
    storage: "sqlite",
    description: "Observation, decision, action, outcome, learning"
  },
  {
    kind: "pattern",
    name: "Semantic Memory",
    storage: "lancedb",
    description: "Documents, emails, meetings, insights, conversations, patterns"
  }
];
