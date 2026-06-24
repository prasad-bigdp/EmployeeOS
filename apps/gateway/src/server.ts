import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DatabaseService } from "@employeeos/database";
import { createProvider } from "@employeeos/ai";
import { generateMorningBrief, answerQuestion } from "@employeeos/reporter";
import { processSignal } from "@employeeos/observer";
import type { AppConfig } from "@employeeos/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(os.homedir(), ".employeeos", "config.json");
// Try bundled npm layout first (dist/web/), then monorepo layout (../../web/dist)
const WEB_DIST = [
  path.resolve(__dirname, "web"),
  path.resolve(__dirname, "../../web/dist"),
].find(p => fs.existsSync(p)) ?? path.resolve(__dirname, "../../web/dist");

function scoreLabel(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 55) return "Fair";
  if (score >= 40) return "Needs attention";
  return "Critical";
}

const ROLE_EMOJI: Record<string, string> = {
  "ceo-assistant": "🧠",
  "marketing-manager": "📣",
  "sales-manager": "📈",
  "support-manager": "💬",
  "finance-manager": "💰",
  "hr-manager": "👥",
};

function loadConfig(): AppConfig | null {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as AppConfig; }
  catch { return null; }
}

// Global WS client set — populated on connection, cleared on close
const wsClients = new Set<import("ws").WebSocket>();

export function broadcastLog(message: string): void {
  const payload = JSON.stringify({ type: "log", message, time: new Date().toISOString() });
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

export async function startGateway(port = 3001): Promise<{
  broadcast: typeof broadcastLog;
  close: () => Promise<void>;
}> {
  const config = loadConfig();
  const db = config ? await DatabaseService.open(config.dbPath) : null;

  const server = Fastify({ logger: false });

  await server.register(cors, { origin: true });
  await server.register(websocket);

  const webExists = fs.existsSync(WEB_DIST);
  if (webExists) {
    await server.register(staticPlugin, {
      root: WEB_DIST,
      prefix: "/",
      decorateReply: false,
    });
  }

  // -------------------------------------------------------------------------
  // API routes — all prefixed with /api
  // -------------------------------------------------------------------------

  server.get("/api/health", async () => ({
    ok: true,
    service: "employeeos-gateway",
    initialized: Boolean(config?.initialized),
  }));

  server.get("/api/company", async (_, reply) => {
    if (!db || !config) return reply.code(503).send({ error: "Not initialized" });
    const company = await db.getCompany();
    const brands = await db.getBrands(config.companyId);
    return { company, brands };
  });

  server.get("/api/brief", async (_, reply) => {
    if (!db || !config) return reply.code(503).send({ error: "Not initialized" });
    const report = await db.getLatestReport(config.companyId, "morning_brief");
    if (!report) return null;
    return { title: report.title, body: report.body, createdAt: report.createdAt };
  });

  server.get("/api/goals", async (_, reply) => {
    if (!db || !config) return reply.code(503).send({ error: "Not initialized" });
    return db.getGoals(config.companyId);
  });

  server.get("/api/employees", async (_, reply) => {
    if (!db || !config) return reply.code(503).send({ error: "Not initialized" });
    const rows = await db.getEmployees(config.companyId);
    return rows.map(e => ({ ...e, emoji: ROLE_EMOJI[e.role] ?? "🤖" }));
  });

  server.get("/api/plans", async (_, reply) => {
    if (!db || !config) return reply.code(503).send({ error: "Not initialized" });
    return db.getPendingPlans(config.companyId);
  });

  server.get("/api/health-score", async (_, reply) => {
    if (!db || !config) return reply.code(503).send({ error: "Not initialized" });
    const s = await db.getLatestHealthScore(config.companyId);
    if (!s) return { score: 0, label: "No data", breakdown: {} };
    const breakdown = typeof s.breakdown === "string"
      ? JSON.parse(s.breakdown || "{}") as Record<string, number>
      : (s.breakdown as Record<string, number> ?? {});
    return { score: s.score, label: scoreLabel(s.score ?? 0), breakdown, scoredAt: s.scoredAt };
  });

  server.get("/api/telegram/status", async () => ({
    connected: Boolean(config?.telegramBotToken && config?.telegramChatId),
    chatId: config?.telegramChatId ?? null,
  }));

  server.get("/api/observations", async (_, reply) => {
    if (!db || !config) return reply.code(503).send({ error: "Not initialized" });
    return db.getRecentObservations(config.companyId, 20);
  });

  server.get("/api/events", async (_, reply) => {
    if (!db || !config) return reply.code(503).send({ error: "Not initialized" });
    const plans = await db.getPendingPlans(config.companyId);
    const learnings = await db.getRecentLearnings(config.companyId, 5);
    const reports = await db.getRecentReports(config.companyId, 3);
    return {
      items: [
        ...plans.map(p => ({ type: "plan.created", detail: p.title, status: p.status, createdAt: p.createdAt })),
        ...learnings.map(l => ({ type: "learning.created", detail: l.pattern, subject: l.subject, createdAt: l.lastSeen })),
        ...reports.map(r => ({ type: "report.generated", detail: r.title, createdAt: r.createdAt })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    };
  });

  const obsSchema = z.object({
    source: z.string().min(1),
    type: z.string().min(1),
    content: z.string().min(1),
  });

  server.post("/api/observations", async (request, reply) => {
    if (!db || !config) return reply.code(503).send({ error: "Not initialized" });
    const payload = obsSchema.parse(request.body);
    const ai = await createProvider(config.aiProvider, {
      apiKey: config.aiApiKey,
      model: config.aiModel,
      baseURL: config.aiBaseURL,
    });
    const id = await processSignal(db, ai, config.companyId, payload);
    reply.code(201);
    return { accepted: true, observationId: id };
  });

  const askSchema = z.object({ question: z.string().min(1) });

  server.post("/api/ask", async (request, reply) => {
    if (!db || !config) return reply.code(503).send({ error: "Not initialized" });
    const { question } = askSchema.parse(request.body);
    const ai = await createProvider(config.aiProvider, {
      apiKey: config.aiApiKey,
      model: config.aiModel,
      baseURL: config.aiBaseURL,
    });
    const answer = await answerQuestion(db, ai, config.companyId, question);
    return { question, answer };
  });

  // Force-generate a fresh brief and persist it
  server.post("/api/brief/refresh", async (_, reply) => {
    if (!db || !config) return reply.code(503).send({ error: "Not initialized" });
    const ai = await createProvider(config.aiProvider, {
      apiKey: config.aiApiKey,
      model: config.aiModel,
      baseURL: config.aiBaseURL,
    });
    const result = await generateMorningBrief(db, ai, config.companyId);
    await db.createReport(config.companyId, result.title, result.body, "morning_brief", result.score);
    const saved = await db.getLatestReport(config.companyId, "morning_brief");
    return saved ? { title: saved.title, body: saved.body, createdAt: saved.createdAt } : null;
  });

  // -------------------------------------------------------------------------
  // WebSocket — brain log streaming
  // -------------------------------------------------------------------------

  server.get("/ws/terminal", { websocket: true }, (socket) => {
    wsClients.add(socket);
    socket.send(JSON.stringify({
      type: "connected",
      message: "EmployeeOS Company Brain connected",
      time: new Date().toISOString(),
    }));
    socket.on("close", () => wsClients.delete(socket));
    socket.on("error", () => wsClients.delete(socket));
  });

  // -------------------------------------------------------------------------
  // SPA fallback — non-API GET requests serve index.html
  // -------------------------------------------------------------------------

  if (webExists) {
    server.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api") || request.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  await server.listen({ port, host: "127.0.0.1" });

  return {
    broadcast: broadcastLog,
    close: async () => {
      db?.close();
      await server.close();
    },
  };
}

// Direct execution support: `node dist/server.js` or `tsx src/server.ts`
const thisFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (thisFile === entryFile || entryFile.endsWith("server.ts")) {
  const port = Number(process.env["PORT"] ?? 3001);
  const { close } = await startGateway(port);
  console.log(`Gateway running at http://localhost:${port}`);
  process.on("SIGINT", () => close().then(() => process.exit(0)));
  process.on("SIGTERM", () => close().then(() => process.exit(0)));
}
