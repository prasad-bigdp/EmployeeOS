import fs from "node:fs";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic, BindParams } from "sql.js";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { and, or, eq, desc, isNull, lt, gt } from "drizzle-orm";
import * as schema from "./schema.js";
import { runMigrations } from "./migrations.js";

type DrizzleDB = SqliteRemoteDatabase<typeof schema>;

function uid(): string {
  return crypto.randomUUID();
}

function makeDriver(sqliteDB: Database) {
  return async (sql: string, params: unknown[], method: string) => {
    const bindParams = params as BindParams;
    if (method === "run") {
      sqliteDB.run(sql, bindParams);
      return { rows: [] as unknown[][] };
    }
    const result = sqliteDB.exec(sql, bindParams);
    if (!result[0]) return { rows: [] as unknown[][] };
    return { rows: result[0].values as unknown[][] };
  };
}

export class DatabaseService {
  private db: DrizzleDB;
  private sqliteDB: Database;
  private dbPath: string;

  private constructor(db: DrizzleDB, sqliteDB: Database, dbPath: string) {
    this.db = db;
    this.sqliteDB = sqliteDB;
    this.dbPath = dbPath;
  }

  static async open(filePath: string): Promise<DatabaseService> {
    const SQL: SqlJsStatic = await initSqlJs();
    const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    const sqliteDB = new SQL.Database(buffer ?? undefined);
    runMigrations(sqliteDB);
    const db = drizzle(makeDriver(sqliteDB), { schema });
    const svc = new DatabaseService(db, sqliteDB, filePath);
    svc.save();
    return svc;
  }

  save() {
    const data = this.sqliteDB.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  // ── Company ────────────────────────────────────────────────────────────────

  async createCompany(data: {
    name: string;
    industry: string;
    description: string;
    ceoName: string;
    ceoEmail: string;
  }) {
    const id = uid();
    await this.db.insert(schema.companies).values({
      id,
      name: data.name,
      industry: data.industry,
      description: data.description,
      ceoName: data.ceoName,
      ceoEmail: data.ceoEmail,
      createdAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getCompany() {
    const rows = await this.db.select().from(schema.companies).limit(1);
    return rows[0] ?? null;
  }

  // ── Brands ─────────────────────────────────────────────────────────────────

  async createBrand(companyId: string, name: string, description = "") {
    const id = uid();
    await this.db.insert(schema.brands).values({
      id,
      companyId,
      name,
      description,
      createdAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getBrands(companyId: string) {
    return this.db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.companyId, companyId));
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  setSetting(key: string, value: string) {
    this.sqliteDB.run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      [key, value]
    );
    this.save();
  }

  getSetting(key: string): string | null {
    const result = this.sqliteDB.exec(
      "SELECT value FROM settings WHERE key = ?",
      [key]
    );
    if (!result[0]?.values[0]) return null;
    return result[0].values[0][0] as string;
  }

  // ── Goals ──────────────────────────────────────────────────────────────────

  async createGoal(companyId: string, title: string, kind: string) {
    const id = uid();
    await this.db.insert(schema.goals).values({
      id,
      companyId,
      title,
      kind,
      status: "active",
      progress: 0,
      createdAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getGoals(companyId: string) {
    return this.db
      .select()
      .from(schema.goals)
      .where(eq(schema.goals.companyId, companyId));
  }

  async updateGoalProgress(goalId: string, progress: number) {
    await this.db
      .update(schema.goals)
      .set({ progress })
      .where(eq(schema.goals.id, goalId));
    this.save();
  }

  // ── Integrations ───────────────────────────────────────────────────────────

  async createIntegration(companyId: string, type: string) {
    const id = uid();
    await this.db.insert(schema.integrations).values({
      id,
      companyId,
      type,
      status: "pending",
      config: "{}",
      createdAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getIntegrations(companyId: string) {
    return this.db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.companyId, companyId));
  }

  // ── Employees ──────────────────────────────────────────────────────────────

  async createEmployee(companyId: string, name: string, role: string) {
    const id = uid();
    await this.db.insert(schema.employees).values({
      id,
      companyId,
      name,
      role,
      active: true,
      createdAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getEmployees(companyId: string) {
    return this.db
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.companyId, companyId));
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────

  async createKnowledge(
    companyId: string,
    kind: string,
    subject: string,
    body: string,
    confidence = 0.8
  ) {
    const id = uid();
    await this.db.insert(schema.knowledge).values({
      id,
      companyId,
      kind,
      subject,
      body,
      confidence,
      createdAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getRecentKnowledge(companyId: string, limit = 20) {
    return this.db
      .select()
      .from(schema.knowledge)
      .where(eq(schema.knowledge.companyId, companyId))
      .orderBy(desc(schema.knowledge.createdAt))
      .limit(limit);
  }

  // ── Observations ───────────────────────────────────────────────────────────

  async createObservation(
    companyId: string,
    source: string,
    signalType: string,
    content: string
  ) {
    const id = uid();
    await this.db.insert(schema.observations).values({
      id,
      companyId,
      source,
      signalType,
      content,
      occurredAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getUnprocessedObservations(companyId: string) {
    return this.db
      .select()
      .from(schema.observations)
      .where(
        and(
          eq(schema.observations.companyId, companyId),
          isNull(schema.observations.processedAt)
        )
      );
  }

  async markAllObservationsProcessed(companyId: string) {
    await this.db
      .update(schema.observations)
      .set({ processedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.observations.companyId, companyId),
          isNull(schema.observations.processedAt)
        )
      );
    this.save();
  }

  async getRecentObservations(companyId: string, limit = 20) {
    return this.db
      .select()
      .from(schema.observations)
      .where(eq(schema.observations.companyId, companyId))
      .orderBy(desc(schema.observations.occurredAt))
      .limit(limit);
  }

  async markObservationProcessed(observationId: string) {
    await this.db
      .update(schema.observations)
      .set({ processedAt: new Date().toISOString() })
      .where(eq(schema.observations.id, observationId));
    this.save();
  }

  // ── Learnings ──────────────────────────────────────────────────────────────

  async createLearning(
    companyId: string,
    subject: string,
    pattern: string,
    confidence = 0.6
  ) {
    const id = uid();
    await this.db.insert(schema.learnings).values({
      id,
      companyId,
      subject,
      pattern,
      confidence,
      evidenceCount: 1,
      lastSeen: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getRecentLearnings(companyId: string, limit = 10) {
    return this.db
      .select()
      .from(schema.learnings)
      .where(eq(schema.learnings.companyId, companyId))
      .orderBy(desc(schema.learnings.lastSeen))
      .limit(limit);
  }

  // ── Plans ──────────────────────────────────────────────────────────────────

  async createPlan(
    companyId: string,
    employeeRole: string,
    title: string,
    actions: unknown[],
    autonomyRequired = "recommend"
  ) {
    const id = uid();
    await this.db.insert(schema.plans).values({
      id,
      companyId,
      employeeRole,
      title,
      actions: JSON.stringify(actions),
      status: "pending",
      autonomyRequired,
      createdAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getPendingPlans(companyId: string) {
    return this.db
      .select()
      .from(schema.plans)
      .where(and(eq(schema.plans.companyId, companyId), eq(schema.plans.status, "pending")))
      .orderBy(desc(schema.plans.createdAt));
  }

  async getApprovedPlans(companyId: string) {
    return this.db
      .select()
      .from(schema.plans)
      .where(and(eq(schema.plans.companyId, companyId), eq(schema.plans.status, "approved")))
      .orderBy(desc(schema.plans.createdAt));
  }

  async getAllPlans(companyId: string) {
    return this.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.companyId, companyId))
      .orderBy(desc(schema.plans.createdAt));
  }

  async updatePlanStatus(planId: string, status: string) {
    await this.db
      .update(schema.plans)
      .set({ status })
      .where(eq(schema.plans.id, planId));
    this.save();
  }

  // ── Usage Stats ───────────────────────────────────────────────────────────

  async recordUsage(
    companyId: string,
    employeeRole: string,
    inputTokens: number,
    outputTokens: number,
    model?: string
  ) {
    await this.db.insert(schema.usageStats).values({
      id: uid(),
      companyId,
      employeeRole,
      model: model ?? null,
      inputTokens,
      outputTokens,
      recordedAt: new Date().toISOString(),
    });
    this.save();
  }

  async getUsageStats(companyId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return this.db
      .select()
      .from(schema.usageStats)
      .where(and(eq(schema.usageStats.companyId, companyId), gt(schema.usageStats.recordedAt, since)))
      .orderBy(desc(schema.usageStats.recordedAt));
  }

  // ── Health Scores ──────────────────────────────────────────────────────────

  async createHealthScore(
    companyId: string,
    score: number,
    breakdown: Record<string, number>
  ) {
    const id = uid();
    await this.db.insert(schema.healthScores).values({
      id,
      companyId,
      score,
      breakdown: JSON.stringify(breakdown),
      scoredAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getLatestHealthScore(companyId: string) {
    const rows = await this.db
      .select()
      .from(schema.healthScores)
      .where(eq(schema.healthScores.companyId, companyId))
      .orderBy(desc(schema.healthScores.scoredAt))
      .limit(1);
    return rows[0] ?? null;
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  async createDocument(
    companyId: string,
    filename: string,
    kind: string,
    contentSummary: string,
    wordCount: number,
    brandId?: string
  ) {
    const id = uid();
    await this.db.insert(schema.documents).values({
      id,
      companyId,
      brandId: brandId ?? null,
      filename,
      kind,
      contentSummary,
      wordCount,
      indexedAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getDocuments(companyId: string) {
    return this.db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.companyId, companyId));
  }

  createDocumentChunk(documentId: string, chunkIndex: number, content: string) {
    const id = uid();
    this.sqliteDB.run(
      "INSERT INTO document_chunks (id, document_id, chunk_index, content) VALUES (?, ?, ?, ?)",
      [id, documentId, chunkIndex, content]
    );
    this.sqliteDB.run(
      "INSERT INTO document_fts (content, document_id, chunk_id) VALUES (?, ?, ?)",
      [content, documentId, id]
    );
    this.save();
    return id;
  }

  searchDocuments(query: string, limit = 5) {
    const result = this.sqliteDB.exec(
      `SELECT dc.content, dc.document_id, d.filename
       FROM document_fts fts
       JOIN document_chunks dc ON dc.id = fts.chunk_id
       JOIN documents d ON d.id = dc.document_id
       WHERE document_fts MATCH ?
       LIMIT ?`,
      [query, limit]
    );
    if (!result[0]) return [];
    const [{ columns, values }] = result;
    return values.map(row => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj as { content: string; document_id: string; filename: string };
    });
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  async createReport(
    companyId: string,
    title: string,
    body: string,
    kind = "daily_brief",
    score?: number
  ) {
    const id = uid();
    await this.db.insert(schema.reports).values({
      id,
      companyId,
      title,
      body,
      kind,
      score: score ?? null,
      createdAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getTodayReport(companyId: string, kind = "daily_brief") {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.companyId, companyId))
      .orderBy(desc(schema.reports.createdAt));
    return rows.find(r => r.kind === kind && r.createdAt.startsWith(today)) ?? null;
  }

  async deleteTodayReport(companyId: string, kind = "daily_brief") {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.companyId, companyId));
    const todayIds = rows
      .filter(r => r.kind === kind && r.createdAt.startsWith(today))
      .map(r => r.id);
    for (const id of todayIds) {
      await this.db.delete(schema.reports).where(eq(schema.reports.id, id));
    }
    if (todayIds.length > 0) this.save();
  }

  async getLatestReport(companyId: string, kind = "morning_brief") {
    const rows = await this.db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.companyId, companyId))
      .orderBy(desc(schema.reports.createdAt));
    return rows.find(r => r.kind === kind) ?? null;
  }

  async getRecentReports(companyId: string, limit = 5) {
    return this.db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.companyId, companyId))
      .orderBy(desc(schema.reports.createdAt))
      .limit(limit);
  }

  // ── Executions ─────────────────────────────────────────────────────────────

  async createExecution(companyId: string, planId: string) {
    const id = uid();
    await this.db.insert(schema.executions).values({
      id, companyId, planId,
      status: "running",
      startedAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async updateExecution(executionId: string, fields: {
    status: string;
    outcome?: string;
    error?: string;
    learningId?: string;
    completedAt?: string;
  }) {
    await this.db.update(schema.executions)
      .set({
        status: fields.status,
        outcome: fields.outcome ?? null,
        error: fields.error ?? null,
        learningId: fields.learningId ?? null,
        completedAt: fields.completedAt ?? null,
      })
      .where(eq(schema.executions.id, executionId));
    this.save();
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  async createEvent(companyId: string, type: string, payload: Record<string, unknown>) {
    const id = uid();
    await this.db.insert(schema.events).values({
      id,
      companyId,
      type,
      payload: JSON.stringify(payload),
      occurredAt: new Date().toISOString()
    });
    this.save();
    return id;
  }

  async getEvents(
    companyId: string,
    limit = 50,
    before?: string
  ) {
    // Composite cursor: "occurredAt::id" — prevents skipping events that share the same timestamp.
    // Secondary sort on id (descending) gives a stable page boundary within the same millisecond.
    let conditions;
    if (before) {
      const sepIdx = before.lastIndexOf("::");
      if (sepIdx !== -1) {
        const beforeTime = before.slice(0, sepIdx);
        const beforeId = before.slice(sepIdx + 2);
        conditions = and(
          eq(schema.events.companyId, companyId),
          or(
            lt(schema.events.occurredAt, beforeTime),
            and(eq(schema.events.occurredAt, beforeTime), lt(schema.events.id, beforeId))
          )
        );
      } else {
        // Legacy plain-timestamp cursor (backwards compat)
        conditions = and(eq(schema.events.companyId, companyId), lt(schema.events.occurredAt, before));
      }
    } else {
      conditions = eq(schema.events.companyId, companyId);
    }

    const rows = await this.db
      .select()
      .from(schema.events)
      .where(conditions)
      .orderBy(desc(schema.events.occurredAt), desc(schema.events.id))
      .limit(limit);
    return rows.map(e => ({
      ...e,
      payload: JSON.parse(e.payload) as Record<string, unknown>,
    }));
  }

  // ── Settings (key-value meta store) ────────────────────────────────────────

  async getMeta(key: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    const existing = await this.getMeta(key);
    if (existing !== null) {
      await this.db
        .update(schema.settings)
        .set({ value })
        .where(eq(schema.settings.key, key));
    } else {
      await this.db.insert(schema.settings).values({ key, value });
    }
    this.save();
  }

  // ── Execution Steps ────────────────────────────────────────────────────────

  async createExecutionStep(
    executionId: string,
    companyId: string,
    tool: string,
    operation: string,
    input: Record<string, unknown>,
    expectedOutcome?: string
  ): Promise<string> {
    const id = uid();
    await this.db.insert(schema.executionSteps).values({
      id,
      executionId,
      companyId,
      tool,
      operation,
      input: JSON.stringify(input),
      expectedOutcome: expectedOutcome ?? null,
      status: "pending",
    });
    this.save();
    return id;
  }

  async updateExecutionStep(
    stepId: string,
    fields: {
      status?: string;
      result?: Record<string, unknown>;
      error?: string;
      startedAt?: string;
      completedAt?: string;
    }
  ): Promise<void> {
    await this.db
      .update(schema.executionSteps)
      .set({
        ...(fields.status !== undefined && { status: fields.status }),
        ...(fields.result !== undefined && { result: JSON.stringify(fields.result) }),
        ...(fields.error !== undefined && { error: fields.error }),
        ...(fields.startedAt !== undefined && { startedAt: fields.startedAt }),
        ...(fields.completedAt !== undefined && { completedAt: fields.completedAt }),
      })
      .where(eq(schema.executionSteps.id, stepId));
    this.save();
  }

  async getExecutionSteps(executionId: string) {
    const rows = await this.db
      .select()
      .from(schema.executionSteps)
      .where(eq(schema.executionSteps.executionId, executionId));
    return rows.map(r => ({
      ...r,
      input: JSON.parse(r.input) as Record<string, unknown>,
      result: r.result ? JSON.parse(r.result) as Record<string, unknown> : null,
    }));
  }

  // ── Tool Connections ────────────────────────────────────────────────────────

  async getToolConnection(companyId: string, tool: string) {
    const rows = await this.db
      .select()
      .from(schema.toolConnections)
      .where(and(eq(schema.toolConnections.companyId, companyId), eq(schema.toolConnections.tool, tool)))
      .limit(1);
    if (!rows[0]) return null;
    return { ...rows[0], config: JSON.parse(rows[0].config) as Record<string, unknown> };
  }

  async upsertToolConnection(
    companyId: string,
    tool: string,
    status: string,
    config: Record<string, unknown>
  ): Promise<void> {
    const existing = await this.getToolConnection(companyId, tool);
    const now = new Date().toISOString();
    if (existing) {
      await this.db
        .update(schema.toolConnections)
        .set({ status, config: JSON.stringify(config), connectedAt: now })
        .where(and(eq(schema.toolConnections.companyId, companyId), eq(schema.toolConnections.tool, tool)));
    } else {
      await this.db.insert(schema.toolConnections).values({
        id: uid(),
        companyId,
        tool,
        status,
        config: JSON.stringify(config),
        connectedAt: now,
      });
    }
    this.save();
  }

  async listToolConnections(companyId: string) {
    const rows = await this.db
      .select()
      .from(schema.toolConnections)
      .where(eq(schema.toolConnections.companyId, companyId));
    return rows.map(r => ({ ...r, config: JSON.parse(r.config) as Record<string, unknown> }));
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  close() {
    this.save();
    this.sqliteDB.close();
  }
}
