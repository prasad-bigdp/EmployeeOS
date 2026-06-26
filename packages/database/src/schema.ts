import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  industry: text("industry").notNull().default("other"),
  description: text("description").notNull().default(""),
  ceoName: text("ceo_name").notNull().default(""),
  ceoEmail: text("ceo_email").notNull().default(""),
  createdAt: text("created_at").notNull()
});

export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull()
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull()
});

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default(""),
  status: text("status").notNull().default("active"),
  progress: integer("progress").notNull().default(0),
  createdAt: text("created_at").notNull()
});

export const integrations = sqliteTable("integrations", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  config: text("config").notNull().default("{}"),
  createdAt: text("created_at").notNull()
});

export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull()
});

export const knowledge = sqliteTable("knowledge", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  kind: text("kind").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  confidence: real("confidence").notNull().default(0.8),
  createdAt: text("created_at").notNull()
});

export const observations = sqliteTable("observations", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  source: text("source").notNull(),
  signalType: text("signal_type").notNull(),
  content: text("content").notNull(),
  occurredAt: text("occurred_at").notNull(),
  processedAt: text("processed_at")
});

export const learnings = sqliteTable("learnings", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  subject: text("subject").notNull(),
  pattern: text("pattern").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  evidenceCount: integer("evidence_count").notNull().default(1),
  lastSeen: text("last_seen").notNull()
});

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  employeeRole: text("employee_role").notNull(),
  title: text("title").notNull(),
  actions: text("actions").notNull().default("[]"),
  status: text("status").notNull().default("pending"),
  autonomyRequired: text("autonomy_required").notNull().default("recommend"),
  createdAt: text("created_at").notNull()
});

export const healthScores = sqliteTable("health_scores", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  score: integer("score").notNull(),
  breakdown: text("breakdown").notNull().default("{}"),
  scoredAt: text("scored_at").notNull()
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  brandId: text("brand_id"),
  filename: text("filename").notNull(),
  kind: text("kind").notNull(),
  contentSummary: text("content_summary").notNull().default(""),
  wordCount: integer("word_count").notNull().default(0),
  indexedAt: text("indexed_at").notNull()
});

export const documentChunks = sqliteTable("document_chunks", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull()
});

export const executions = sqliteTable("executions", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  planId: text("plan_id").notNull(),
  status: text("status").notNull().default("running"),
  outcome: text("outcome"),
  error: text("error"),
  learningId: text("learning_id"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at")
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  type: text("type").notNull(),
  payload: text("payload").notNull().default("{}"),
  occurredAt: text("occurred_at").notNull()
});

export const executionSteps = sqliteTable("execution_steps", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull(),
  companyId: text("company_id").notNull(),
  tool: text("tool").notNull(),
  operation: text("operation").notNull(),
  input: text("input").notNull().default("{}"),
  expectedOutcome: text("expected_outcome"),
  status: text("status").notNull().default("pending"),
  result: text("result"),
  error: text("error"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});

export const toolConnections = sqliteTable("tool_connections", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  tool: text("tool").notNull(),
  status: text("status").notNull().default("disconnected"),
  config: text("config").notNull().default("{}"),
  connectedAt: text("connected_at"),
});

export const usageStats = sqliteTable("usage_stats", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  employeeRole: text("employee_role").notNull().default("unknown"),
  model: text("model"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  recordedAt: text("recorded_at").notNull(),
});

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  kind: text("kind").notNull().default("daily_brief"),
  score: integer("score"),
  createdAt: text("created_at").notNull()
});
