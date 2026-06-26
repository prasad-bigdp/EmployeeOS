import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { exec } from "node:child_process";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import ora from "ora";
import { DatabaseService } from "@employeeos/database";
import { createProvider } from "@employeeos/ai";
import { generateFirstReport, getOrGenerateBrief, answerQuestion } from "@employeeos/reporter";
import { startBrainLoop } from "@employeeos/brain";
import type {
  AppConfig,
  GoalKind,
  EmployeeRole,
  IntegrationType,
  Industry,
  AIProviderName
} from "@employeeos/shared";
import {
  GOAL_LABELS as GOALS,
  INDUSTRY_LABELS as INDUSTRIES,
  INTEGRATION_LABELS as INTEGRATIONS
} from "@employeeos/shared";

// -- Config ---------------------------------------------------------------

const CONFIG_DIR = path.join(os.homedir(), ".employeeos");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const DB_FILE = path.join(CONFIG_DIR, "brain.db");
const DOCS_DIR = path.join(CONFIG_DIR, "docs");
const SKILLS_DIR = path.join(CONFIG_DIR, "skills");

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
}

function loadConfig(): AppConfig | null {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as AppConfig;
  } catch {
    return null;
  }
}

function saveConfig(config: AppConfig) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

async function openDB(config: AppConfig): Promise<DatabaseService> {
  return DatabaseService.open(config.dbPath);
}

// -- UI Helpers -----------------------------------------------------------

function mascot(): string {
  const b = chalk.blue.bold;
  const w = chalk.bold.white;
  const t = chalk.cyan.bold;   // tie
  const f = chalk.white;       // face

  return [
    f("        .──────."),
    f("       ( ◉    ◉ )"),
    f("       (   ────  )"),
    f("        `──────'"),
    b("        /╲    /╲"),
    b("       /  ╲  /  \\"),
    b("      / ╔══╧══╗ \\"),
    b("        ║  ") + t("▲") + b("  ║"),
    b("        ║  ") + t("│") + b("  ║"),
    b("        ╚═════╝"),
    "",
    "  " + w("EmployeeOS") + chalk.gray("  ·  The Open Source Company Brain"),
  ].join("\n");
}

function banner() {
  console.log("");
  console.log(mascot());
  console.log("");
}

function divider() {
  console.log(chalk.gray("  " + "-".repeat(50)));
}

function section(title: string) {
  console.log("");
  console.log(chalk.bold.cyan("  " + title));
  divider();
}

function ok(msg: string) {
  console.log(chalk.green("  [ok] " + msg));
}

function info(msg: string) {
  console.log(chalk.gray("  " + msg));
}

function warn(msg: string) {
  console.log(chalk.yellow("  [!] " + msg));
}

// -- Document Ingestion ---------------------------------------------------

async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    try {
      const { default: pdfParse } = await import("pdf-parse");
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return data.text;
    } catch {
      warn("Could not parse PDF: " + path.basename(filePath) + ". Skipping.");
      return "";
    }
  }
  return fs.readFileSync(filePath, "utf-8");
}

function chunkText(text: string, chunkSize = 400): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }
  return chunks;
}

async function indexDocuments(
  db: DatabaseService,
  companyId: string,
  folderOrFiles: string
): Promise<number> {
  const target = folderOrFiles.trim();
  if (!fs.existsSync(target)) {
    warn("Path not found: " + target);
    return 0;
  }

  let filePaths: string[] = [];
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    filePaths = fs.readdirSync(target)
      .filter(f => /\.(pdf|txt|md|json)$/i.test(f))
      .map(f => path.join(target, f));
  } else {
    filePaths = [target];
  }

  let indexed = 0;
  for (const fp of filePaths) {
    const spinner = ora("  Indexing " + path.basename(fp) + "...").start();
    try {
      const text = await extractText(fp);
      if (!text.trim()) {
        spinner.warn("  Skipped " + path.basename(fp) + " (empty)");
        continue;
      }
      const words = text.split(/\s+/).length;
      const summary = text.split(/\s+/).slice(0, 40).join(" ") + "...";
      const ext = path.extname(fp).slice(1);
      const docId = await db.createDocument(companyId, path.basename(fp), ext, summary, words);
      const chunks = chunkText(text);
      for (let i = 0; i < chunks.length; i++) {
        db.createDocumentChunk(docId, i, chunks[i]!);
      }
      spinner.succeed("  Indexed " + path.basename(fp) + " (" + words + " words, " + chunks.length + " chunks)");
      indexed++;
    } catch {
      spinner.fail("  Failed: " + path.basename(fp));
    }
  }
  return indexed;
}

// -- Claude Code OAuth connection -----------------------------------------

async function connectClaudeCode(): Promise<string> {

  // 1. Try reusing existing Claude Code CLI credentials
  const credFile = path.join(os.homedir(), ".claude", ".credentials.json");
  if (fs.existsSync(credFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(credFile, "utf-8")) as Record<string, unknown>;
      // Credentials format: { claudeAiOAuthToken: { accessToken, refreshToken, expiresAt } }
      const oauthObj = raw["claudeAiOAuthToken"] as Record<string, unknown> | undefined;
      const token =
        (oauthObj?.["accessToken"] as string | undefined) ??
        (raw["accessToken"] as string | undefined) ??
        (raw["token"] as string | undefined);

      if (token && token.trim().length > 20) {
        const { useExisting } = await inquirer.prompt([{
          type: "confirm",
          name: "useExisting",
          message: "Found existing Claude Code session. Use it?",
          default: true,
        }]);
        if (useExisting) {
          ok("Using existing Claude Code session from ~/.claude/.credentials.json");
          return token.trim();
        }
      }
    } catch {
      // Unreadable — fall through
    }
  }

  // 2. Guide through claude setup-token (generates a long-lived OAuth token)
  console.log("");
  info("To connect your Claude Code subscription:");
  console.log(chalk.yellow("  1. Open a new terminal"));
  console.log(chalk.yellow("  2. Run: claude setup-token"));
  console.log(chalk.yellow("  3. Log in when your browser opens"));
  console.log(chalk.yellow("  4. Copy the token that appears and paste it here"));
  console.log("");

  const { token } = await inquirer.prompt([{
    type: "password",
    name: "token",
    message: "Paste your Claude Code OAuth token:",
    validate: (v: string) => v.trim().length > 20 || "Token looks too short",
  }]);

  ok("Claude Code token saved");
  return (token as string).trim();
}

// -- OpenAI Codex OAuth (PKCE) --------------------------------------------

async function connectCodexOAuth(): Promise<string> {

  // 1. Try reusing existing Codex CLI credentials
  const credFile = path.join(os.homedir(), ".codex", "auth.json");
  if (fs.existsSync(credFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(credFile, "utf-8")) as Record<string, unknown>;
      const token = (raw["access"] as string | undefined) ?? (raw["access_token"] as string | undefined);
      if (token && token.trim().length > 20) {
        const { useExisting } = await inquirer.prompt([{
          type: "confirm",
          name: "useExisting",
          message: "Found existing Codex session. Use it?",
          default: true,
        }]);
        if (useExisting) {
          ok("Using existing Codex session from ~/.codex/auth.json");
          return token.trim();
        }
      }
    } catch {
      // Unreadable — fall through
    }
  }

  // 2. Full PKCE browser flow
  const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
  const REDIRECT_PORT = 1455;
  const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/auth/callback`;
  const AUTH_URL = "https://auth.openai.com/oauth/authorize";
  const TOKEN_URL = "https://auth.openai.com/oauth/token";

  // Generate PKCE verifier + challenge
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  const authorizeURL =
    AUTH_URL +
    "?response_type=code" +
    "&client_id=" + encodeURIComponent(CLIENT_ID) +
    "&redirect_uri=" + encodeURIComponent(REDIRECT_URI) +
    "&scope=" + encodeURIComponent("openid email profile") +
    "&code_challenge_method=S256" +
    "&code_challenge=" + challenge +
    "&state=" + state;

  // Start local callback server
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${REDIRECT_PORT}`);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>You can close this tab and return to the terminal.</h2></body></html>");
      server.close();

      if (!code) return reject(new Error("No code in callback"));
      if (returnedState !== state) return reject(new Error("State mismatch - possible CSRF"));
      resolve(code);
    });

    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      info("Opening browser for Codex login...");
      // Open browser cross-platform
      const opener =
        process.platform === "win32" ? `start "" "${authorizeURL}"`
        : process.platform === "darwin" ? `open "${authorizeURL}"`
        : `xdg-open "${authorizeURL}"`;
      exec(opener, err => { if (err) info("Could not open browser. Visit: " + authorizeURL); });
    });

    server.on("error", reject);
    // 5-minute timeout
    setTimeout(() => { server.close(); reject(new Error("Login timed out after 5 minutes")); }, 300_000);
  });

  // Exchange code for tokens
  const tokenSpinner = ora("  Exchanging code for tokens...").start();
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }).toString(),
  });

  if (!resp.ok) {
    tokenSpinner.fail("  Token exchange failed");
    throw new Error("Codex token exchange failed: " + resp.status + " " + await resp.text());
  }

  const tokens = await resp.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  const accessToken = tokens.access_token;
  if (!accessToken) throw new Error("No access_token in Codex response");

  // Cache to ~/.codex/auth.json so the Codex CLI itself can reuse it
  try {
    const codexDir = path.join(os.homedir(), ".codex");
    if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(
      path.join(codexDir, "auth.json"),
      JSON.stringify({ access: accessToken, refresh: tokens.refresh_token ?? null, expires: tokens.expires_in ?? null }),
      { encoding: "utf-8", mode: 0o600 }
    );
  } catch {
    // Non-fatal: EmployeeOS still has the token in its own config
  }

  tokenSpinner.succeed("  Codex connected");
  ok("OpenAI Codex session saved");
  return accessToken;
}

// -- Onboarding -----------------------------------------------------------

async function runOnboarding() {
  console.clear();
  banner();
  console.log(chalk.bold("  Welcome to EmployeeOS\n"));
  console.log("  The Open Source Company Brain\n");
  console.log(chalk.gray("  Let's learn about your company."));
  console.log(chalk.gray("  Estimated setup time: 5 minutes\n"));

  const { proceed } = await inquirer.prompt([{
    type: "confirm",
    name: "proceed",
    message: "Ready to begin?",
    default: true
  }]);
  if (!proceed) {
    console.log("\n  Setup cancelled. Run `employeeos init` to start again.\n");
    process.exit(0);
  }

  // -- Step 1: Company Information ------------------------------------------
  section("Step 1 - Company Information");
  const step1 = await inquirer.prompt([
    {
      type: "input",
      name: "companyName",
      message: "What is your company name?",
      validate: (v: string) => v.trim().length > 0 || "Company name is required"
    },
    {
      type: "list",
      name: "industry",
      message: "What industry are you in?",
      choices: Object.entries(INDUSTRIES).map(([value, name]) => ({ name, value }))
    },
    {
      type: "input",
      name: "description",
      message: "Describe your company in one sentence.",
      validate: (v: string) => v.trim().length > 0 || "Description is required"
    }
  ]);
  ok("Company: " + step1.companyName);

  // -- Step 2: Brands -------------------------------------------------------
  section("Step 2 - Brands");
  info("Does your company operate multiple brands? (e.g. Civilore has CivilEngg + CivilMate)");

  const { hasBrands } = await inquirer.prompt([{
    type: "confirm",
    name: "hasBrands",
    message: "Do you have multiple brands?",
    default: false
  }]);

  const brands: string[] = [];
  if (hasBrands) {
    let addingBrands = true;
    while (addingBrands) {
      const { brandName } = await inquirer.prompt([{
        type: "input",
        name: "brandName",
        message: "Brand name (or leave blank to finish):",
        default: ""
      }]);
      if (!brandName.trim()) {
        addingBrands = false;
      } else {
        brands.push(brandName.trim());
        ok("Added brand: " + brandName.trim());
      }
    }
  }
  if (brands.length === 0) {
    brands.push(step1.companyName);
    info("Using company name as single brand");
  }

  // -- Step 3: CEO / Your Information ---------------------------------------
  section("Step 3 - About You");
  const step3 = await inquirer.prompt([
    {
      type: "input",
      name: "ceoName",
      message: "Your name:",
      validate: (v: string) => v.trim().length > 0 || "Name is required"
    },
    {
      type: "input",
      name: "ceoEmail",
      message: "Your email address:",
      validate: (v: string) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Enter a valid email"
    }
  ]);
  ok("CEO: " + step3.ceoName + " (" + step3.ceoEmail + ")");

  // -- Step 4: AI Provider --------------------------------------------------
  section("Step 4 - AI Configuration");
  info("EmployeeOS needs an AI brain. Pick a provider or run locally for free.");

  let aiProvider: AIProviderName = "anthropic";
  let aiApiKey = "";
  let aiAuthToken: string | undefined;
  let aiModel: string | undefined;
  let aiBaseURL: string | undefined;

  const envAnthropic = process.env["ANTHROPIC_API_KEY"];
  const envOpenAI = process.env["OPENAI_API_KEY"];
  const envOpenRouter = process.env["OPENROUTER_API_KEY"];
  const envClaudeCode = process.env["ANTHROPIC_AUTH_TOKEN"] ?? process.env["CLAUDE_CODE_OAUTH_TOKEN"];

  if (envClaudeCode) {
    aiProvider = "claude-code";
    aiAuthToken = envClaudeCode;
    ok("Detected Claude Code OAuth token - using Claude Code subscription");
  } else if (envAnthropic) {
    aiProvider = "anthropic";
    aiApiKey = envAnthropic;
    ok("Detected ANTHROPIC_API_KEY - using Anthropic (Claude)");
  } else if (envOpenRouter) {
    aiProvider = "openrouter";
    aiApiKey = envOpenRouter;
    ok("Detected OPENROUTER_API_KEY - using OpenRouter");
  } else if (envOpenAI) {
    aiProvider = "openai";
    aiApiKey = envOpenAI;
    ok("Detected OPENAI_API_KEY - using OpenAI");
  } else {
    const { chosenProvider } = await inquirer.prompt([{
      type: "list",
      name: "chosenProvider",
      message: "Which AI provider do you want to use?",
      choices: [
        { name: "Anthropic (Claude) - API key", value: "anthropic" },
        { name: "Claude Code (Max/Pro/Teams) - Browser login, no API key needed", value: "claude-code" },
        { name: "OpenAI Codex (ChatGPT Plus/Pro) - Browser login, no API key needed", value: "codex" },
        { name: "OpenAI (GPT-4o / o3-mini) - API key", value: "openai" },
        { name: "OpenRouter - 400+ models with one key", value: "openrouter" },
        { name: "Ollama - Run locally, free, fully private", value: "ollama" },
      ],
    }]);

    aiProvider = chosenProvider as AIProviderName;

    if (aiProvider === "claude-code") {
      aiAuthToken = await connectClaudeCode();
      aiModel = "claude-sonnet-4-6";
    } else if (aiProvider === "codex") {
      aiAuthToken = await connectCodexOAuth();
      aiModel = "gpt-4o";
    } else if (aiProvider === "ollama") {
      const ollamaAnswers = await inquirer.prompt([
        {
          type: "input",
          name: "ollamaURL",
          message: "Ollama base URL:",
          default: "http://localhost:11434",
        },
        {
          type: "input",
          name: "ollamaModel",
          message: "Model name (must be pulled in Ollama):",
          default: "llama3.2",
        },
      ]);
      aiBaseURL = ollamaAnswers.ollamaURL as string;
      aiModel = ollamaAnswers.ollamaModel as string;
      info("Using Ollama model: " + aiModel + " at " + aiBaseURL);
    } else {
      const providerLabel =
        aiProvider === "anthropic" ? "Anthropic"
        : aiProvider === "openai" ? "OpenAI"
        : "OpenRouter";

      const keyAnswers = await inquirer.prompt([{
        type: "password",
        name: "apiKey",
        message: "Enter your " + providerLabel + " API key:",
        validate: (v: string) => v.trim().length > 10 || "API key looks too short",
      }]);
      aiApiKey = keyAnswers.apiKey as string;

      if (aiProvider === "openrouter") {
        const modelAnswer = await inquirer.prompt([{
          type: "input",
          name: "model",
          message: "OpenRouter model (e.g. openai/gpt-4o-mini, anthropic/claude-3-haiku):",
          default: "openai/gpt-4o-mini",
        }]);
        aiModel = modelAnswer.model as string;
      }
    }
  }

  const aiSpinner = ora("  Validating AI connection...").start();
  try {
    const testAi = await createProvider(aiProvider, { apiKey: aiApiKey, authToken: aiAuthToken, model: aiModel, baseURL: aiBaseURL });
    await testAi.generate("Reply with the single word: ok", { maxTokens: 5 });
    aiSpinner.succeed("  AI connection validated");
  } catch (err) {
    aiSpinner.fail("  AI connection failed");
    console.error(chalk.red("\n  Error: " + (err as Error).message + "\n"));
    process.exit(1);
  }

  // -- Step 5: Company Goals ------------------------------------------------
  section("Step 5 - Company Goals");
  info("This is the most important step. What are your top priorities?");

  const { selectedGoals } = await inquirer.prompt([{
    type: "checkbox",
    name: "selectedGoals",
    message: "Select up to 5 goals:",
    choices: Object.entries(GOALS).map(([value, name]) => ({ name, value })),
    validate: (v: string[]) => v.length > 0 ? true : "Select at least one goal"
  }]);

  const goals: GoalKind[] = (selectedGoals as GoalKind[]).slice(0, 5);
  ok("Goals: " + goals.map(g => GOALS[g]).join(", "));

  // -- Step 6: Connect Systems ----------------------------------------------
  section("Step 6 - Connect Systems (Optional)");
  info("Select integrations to connect now. You can add more later.");

  const { selectedIntegrations } = await inquirer.prompt([{
    type: "checkbox",
    name: "selectedIntegrations",
    message: "Which systems do you want to connect?",
    choices: Object.entries(INTEGRATIONS).map(([value, name]) => ({ name, value }))
  }]);

  const integrations: IntegrationType[] = selectedIntegrations as IntegrationType[];
  if (integrations.length > 0) {
    ok("Integrations: " + integrations.map(i => INTEGRATIONS[i]).join(", "));
  } else {
    info("No integrations selected. You can add them later.");
  }

  // -- Step 7: Company Documents --------------------------------------------
  section("Step 7 - Company Knowledge (Optional)");
  info("Give the brain files to read: business plans, reports, strategy docs, FAQs.");
  info("Supported formats: PDF, TXT, MD, JSON");

  const { docsPath } = await inquirer.prompt([{
    type: "input",
    name: "docsPath",
    message: "Path to folder or file (leave blank to skip):",
    default: ""
  }]);

  // -- Step 8: Hire Employees -----------------------------------------------
  section("Step 8 - Hire AI Employees");
  info("AI employees monitor different areas of your company.");

  const { selectedEmployees } = await inquirer.prompt([{
    type: "checkbox",
    name: "selectedEmployees",
    message: "Which roles to hire?",
    choices: [
      { name: "CEO Assistant - Your strategic right hand", value: "ceo-assistant", checked: true },
      { name: "Marketing Manager - Tracks campaigns and brand", value: "marketing-manager" },
      { name: "Sales Manager - Monitors pipeline and revenue", value: "sales-manager" },
      { name: "Support Manager - Watches customer health", value: "support-manager" },
      { name: "Finance Manager - Tracks costs and margins", value: "finance-manager" },
      { name: "HR Manager - Monitors team and culture", value: "hr-manager" }
    ]
  }]);

  const employees: EmployeeRole[] = selectedEmployees as EmployeeRole[];
  ok("Hired: " + employees.join(", "));

  // -- Step 9: Autonomy Level -----------------------------------------------
  section("Step 9 - Autonomy Level");
  info("How much should EmployeeOS act on its own?");

  const { autonomyLevel } = await inquirer.prompt([{
    type: "list",
    name: "autonomyLevel",
    message: "Choose autonomy level:",
    choices: [
      { name: "Observe only - Watch and report, never act", value: "observe" },
      { name: "Recommend - Suggest actions for your approval", value: "recommend", checked: true },
      { name: "Execute - Carry out approved action types automatically", value: "execute" },
      { name: "Autonomous - Full autonomy (advanced users)", value: "autonomous" }
    ]
  }]);
  ok("Autonomy: " + autonomyLevel);

  // -- Building Company Brain -----------------------------------------------
  section("Building Your Company Brain");

  ensureConfigDir();
  const dbSpinner = ora("  Initializing database...").start();
  const db = await DatabaseService.open(DB_FILE);
  dbSpinner.succeed("  Database ready");

  const companySpinner = ora("  Creating company profile...").start();
  const companyId = await db.createCompany({
    name: step1.companyName,
    industry: step1.industry as Industry,
    description: step1.description,
    ceoName: step3.ceoName,
    ceoEmail: step3.ceoEmail
  });
  companySpinner.succeed("  Company profile created");

  const brandsSpinner = ora("  Setting up brands...").start();
  for (const brandName of brands) {
    await db.createBrand(companyId, brandName, "");
  }
  brandsSpinner.succeed("  Brands: " + brands.join(", "));

  const goalsSpinner = ora("  Saving goals...").start();
  for (const goal of goals) {
    await db.createGoal(companyId, goal, GOALS[goal]);
  }
  goalsSpinner.succeed("  " + goals.length + " goals saved");

  if (integrations.length > 0) {
    const intSpinner = ora("  Saving integrations...").start();
    for (const integration of integrations) {
      await db.createIntegration(companyId, integration);
    }
    intSpinner.succeed("  " + integrations.length + " integrations saved");
  }

  const empSpinner = ora("  Hiring employees...").start();
  for (const role of employees) {
    await db.createEmployee(companyId, role, role.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
  }
  empSpinner.succeed("  " + employees.length + " employees hired");

  await db.setSetting("autonomyLevel", autonomyLevel);
  await db.setSetting("companyName", step1.companyName);
  await db.setSetting("ceoName", step3.ceoName);

  if (docsPath && docsPath.trim()) {
    section("Indexing Documents");
    const indexed = await indexDocuments(db, companyId, docsPath.trim());
    ok("Indexed " + indexed + " documents");
  }

  const knowledgeSpinner = ora("  Building initial knowledge base...").start();
  await db.createKnowledge(
    companyId,
    "company",
    "Company goals",
    "Primary objectives: " + goals.map(g => GOALS[g]).join(", "),
    1.0
  );
  knowledgeSpinner.succeed("  Knowledge base ready");

  const insightsSpinner = ora("  Generating first AI intelligence report...").start();
  const ai = await createProvider(aiProvider, { apiKey: aiApiKey, authToken: aiAuthToken, model: aiModel, baseURL: aiBaseURL });
  let firstReport: { body: string; score: number };

  try {
    firstReport = await generateFirstReport(db, ai, companyId);
    const firstReportTitle = "First Intelligence Brief - " + step1.companyName;
    await db.createReport(companyId, firstReportTitle, firstReport.body, "first_brief", firstReport.score);
    await db.createEvent(companyId, "report.generated", { title: firstReportTitle, kind: "first_brief" });
    await db.createHealthScore(companyId, firstReport.score, {});
    insightsSpinner.succeed("  First intelligence report generated");
  } catch {
    insightsSpinner.fail("  Could not generate report (check AI key)");
    firstReport = {
      body: "EmployeeOS has been initialized for " + step1.companyName + ". Run `employeeos brief` to generate your first report.",
      score: 55
    };
  }

  const config: AppConfig = {
    version: 1,
    companyId,
    dbPath: DB_FILE,
    aiProvider,
    aiApiKey,
    aiAuthToken,
    aiModel,
    aiBaseURL,
    autonomyLevel,
    initialized: true,
  };
  saveConfig(config);
  db.close();

  // -- First Report Display -------------------------------------------------
  console.log("");
  divider();
  console.log("");
  console.log(chalk.bold.white("  Good Morning, " + step3.ceoName.split(" ")[0] + "!"));
  console.log("");
  console.log(firstReport.body.split("\n").map(l => "  " + l).join("\n"));
  console.log("");
  divider();
  console.log("");
  console.log(chalk.bold.cyan("  What Happens Next:"));
  console.log("");
  info("Run `employeeos` to see your dashboard");
  info("Run `employeeos brief` for today's morning brief");
  info("Run `employeeos think \"why are leads down?\"` to ask the brain");
  info("Run `employeeos start` to start the background brain loop");
  console.log("");
  ok("EmployeeOS is ready. Your company brain is online.");
  console.log("");
}

// -- Dashboard (default command) ------------------------------------------

async function showDashboard(config: AppConfig) {
  const db = await openDB(config);
  const company = await db.getCompany();
  const goals = await db.getGoals(config.companyId);
  const report = await db.getLatestReport(config.companyId);
  const brands = await db.getBrands(config.companyId);

  banner();
  divider();
  console.log("");

  if (company) {
    console.log(chalk.bold.white("  " + company.name));
    console.log(chalk.gray("  " + company.industry + " | " + company.description));
  }

  if (brands.length > 1) {
    console.log(chalk.gray("  Brands: " + brands.map(b => b.name).join(", ")));
  }

  console.log("");

  if (goals.length > 0) {
    console.log(chalk.bold("  Active Goals:"));
    for (const g of goals) {
      const bar = "[" + "#".repeat(Math.floor(g.progress / 10)) + "-".repeat(10 - Math.floor(g.progress / 10)) + "]";
      console.log(chalk.cyan("  " + bar + " " + g.title + " (" + g.progress + "%)"));
    }
    console.log("");
  }

  if (report) {
    console.log(chalk.bold("  Latest Intelligence:"));
    const preview = report.body.split("\n").slice(0, 5).map(l => "  " + l).join("\n");
    console.log(chalk.gray(preview));
    console.log("");
  }

  divider();
  console.log("");
  info("Commands: brief | think \"question\" | status | plans | employees | start");
  console.log("");
  db.close();
}

// -- Morning Brief --------------------------------------------------------

async function showBrief(config: AppConfig) {
  const db = await openDB(config);
  const ai = await createProvider(config.aiProvider, { apiKey: config.aiApiKey, authToken: config.aiAuthToken, model: config.aiModel, baseURL: config.aiBaseURL });
  const spinner = ora("  Generating morning brief...").start();

  try {
    const report = await getOrGenerateBrief(db, ai, config.companyId);
    spinner.succeed("  Morning brief ready");
    banner();
    divider();
    console.log("");
    console.log(report.body.split("\n").map(l => "  " + l).join("\n"));
    console.log("");
    divider();
  } catch (err) {
    spinner.fail("  Could not generate brief");
    console.error(chalk.red("  " + (err as Error).message));
  }
  db.close();
}

// -- Think (Q&A) ----------------------------------------------------------

async function thinkAbout(question: string, config: AppConfig) {
  const db = await openDB(config);
  const ai = await createProvider(config.aiProvider, { apiKey: config.aiApiKey, authToken: config.aiAuthToken, model: config.aiModel, baseURL: config.aiBaseURL });
  const spinner = ora("  Thinking...").start();

  try {
    const answer = await answerQuestion(db, ai, config.companyId, question);
    spinner.succeed("  Done");
    console.log("");
    console.log(chalk.bold.cyan("  Q: " + question));
    console.log("");
    console.log(answer.split("\n").map(l => "  " + l).join("\n"));
    console.log("");
  } catch (err) {
    spinner.fail("  Failed to answer");
    console.error(chalk.red("  " + (err as Error).message));
  }
  db.close();
}

// -- Status ---------------------------------------------------------------

async function showStatus(config: AppConfig) {
  const db = await openDB(config);
  const company = await db.getCompany();
  const goals = await db.getGoals(config.companyId);
  const plans = await db.getPendingPlans(config.companyId);

  banner();
  section("Company Status");

  if (company) {
    console.log(chalk.gray("  " + company.name + " | " + company.industry));
    console.log("");
  }

  console.log(chalk.bold("  Active Goals (" + goals.length + "):"));
  for (const g of goals) {
    console.log(chalk.cyan("  - " + g.title + " (" + g.progress + "%)"));
  }
  console.log("");

  console.log(chalk.bold("  Pending Plans (" + plans.length + "):"));
  for (const p of plans) {
    console.log(chalk.yellow("  - " + p.title + " [" + p.employeeRole + "]"));
  }
  console.log("");

  info("AI Provider: " + config.aiProvider);
  info("Autonomy: " + config.autonomyLevel);
  info("DB: " + config.dbPath);
  console.log("");
  db.close();
}

// -- Plans ----------------------------------------------------------------

async function showPlans(config: AppConfig) {
  const db = await openDB(config);
  const plans = await db.getAllPlans(config.companyId);

  banner();
  section("AI-Generated Plans");

  if (plans.length === 0) {
    info("No plans yet. Run `employeeos start` to let the brain generate plans.");
    db.close();
    return;
  }

  const statusGroups: Array<{ label: string; color: (s: string) => string; filter: string[] }> = [
    { label: "Pending Approval", color: chalk.yellow, filter: ["pending"] },
    { label: "Approved",         color: chalk.green,  filter: ["approved"] },
    { label: "Executing",        color: chalk.cyan,   filter: ["executing"] },
    { label: "Done",             color: chalk.gray,   filter: ["done"] },
    { label: "Failed",           color: chalk.red,    filter: ["failed"] },
    { label: "Rejected",         color: chalk.red,    filter: ["rejected"] },
  ];

  for (const { label, color, filter } of statusGroups) {
    const group = plans.filter(p => filter.includes(p.status));
    if (group.length === 0) continue;
    console.log(color("  " + label + " (" + group.length + "):"));
    for (const p of group) {
      console.log(chalk.bold("    " + p.title));
      console.log(chalk.gray("    Role: " + p.employeeRole + " | Autonomy: " + p.autonomyRequired));
      console.log("");
    }
  }
  db.close();
}

// -- Employees ------------------------------------------------------------

async function showEmployees(config: AppConfig) {
  const db = await openDB(config);

  banner();
  section("Your AI Employees");

  const rows = await db.getEmployees(config.companyId);
  if (rows.length === 0) {
    info("No employees found.");
  } else {
    for (const e of rows) {
      console.log(chalk.bold.white("  " + e.name));
      console.log(chalk.gray("  Role: " + e.role));
      console.log("");
    }
  }
  db.close();
}

// -- Start Brain Loop -----------------------------------------------------

// -- Discord setup --------------------------------------------------------

async function runDiscordSetup(config: AppConfig) {
  banner();
  section("Connect Discord");

  console.log("  You need a Discord bot token and a channel ID.");
  console.log("");
  console.log(chalk.gray("  Steps:"));
  console.log(chalk.gray("  1. Go to https://discord.com/developers/applications"));
  console.log(chalk.gray("  2. Create a new Application → Bot → copy the token"));
  console.log(chalk.gray("  3. Enable: Server Members, Message Content intents"));
  console.log(chalk.gray("  4. Invite the bot with: applications.commands + bot scopes"));
  console.log(chalk.gray("  5. Right-click your channel → Copy Channel ID"));
  console.log("");

  const { botToken, channelId, guildId } = await inquirer.prompt([
    { type: "input", name: "botToken", message: "Bot token:", default: config.discordBotToken },
    { type: "input", name: "channelId", message: "Channel ID to post in:", default: config.discordChannelId },
    { type: "input", name: "guildId", message: "Guild (server) ID (leave blank for global commands):", default: config.discordGuildId ?? "" },
  ]);

  if (!botToken || !channelId) { warn("Skipped."); return; }

  const spinner = ora("  Registering slash commands...").start();
  try {
    const { Client, GatewayIntentBits } = await import("discord.js");
    const c = new Client({ intents: [GatewayIntentBits.Guilds] });
    await c.login(botToken);
    const clientId = c.application?.id ?? c.user?.id ?? "";
    await c.destroy();

    const { registerSlashCommands } = await import("@employeeos/discord");
    await registerSlashCommands(botToken, clientId, guildId || undefined);
    spinner.succeed("  Slash commands registered");
  } catch (e: unknown) {
    spinner.fail("  Failed: " + (e as Error).message);
    return;
  }

  saveConfig({ ...config, discordBotToken: botToken, discordChannelId: channelId, discordGuildId: guildId || undefined });
  ok("  Discord connected. Restart `employeeos start` to activate the bot.");
  console.log("");
  info("Commands: /brief  /status  /plans  /ask <question>");
}

// -- WhatsApp setup -------------------------------------------------------

async function runWhatsAppSetup(config: AppConfig) {
  banner();
  section("Connect WhatsApp");

  console.log("  WhatsApp uses unofficial web automation (whatsapp-web.js).");
  console.log(chalk.yellow("  Warning: Use a dedicated number — not your personal WhatsApp."));
  console.log("");

  const { targetNumber } = await inquirer.prompt([
    { type: "input", name: "targetNumber", message: "Your WhatsApp number (include country code, e.g. 919876543210):", default: config.whatsappPhoneNumber },
  ]);

  if (!targetNumber) { warn("Skipped."); return; }

  console.log("");
  info("Opening WhatsApp — scan the QR code in a few seconds...");
  console.log("");

  try {
    const qrTerminal = await import("qrcode-terminal");
    const { setupWhatsApp } = await import("@employeeos/whatsapp");

    const result = await setupWhatsApp(targetNumber, (qr) => {
      qrTerminal.default.generate(qr, { small: true });
      info("Scan the QR code above with WhatsApp on your phone.");
    });

    if (result.success) {
      saveConfig({ ...config, whatsappEnabled: true, whatsappPhoneNumber: targetNumber });
      ok(`  Connected! WhatsApp account: ${result.phone}`);
      info("Commands: !brief  !status  !plans  !ask <question>");
    } else {
      warn("  Connection failed or timed out. Try again.");
    }
  } catch (e: unknown) {
    warn("  WhatsApp setup failed: " + (e as Error).message);
    info("  Make sure Chrome/Chromium is installed and puppeteer can launch it.");
  }
}

// -- Cron config ----------------------------------------------------------

async function runCronConfig(config: AppConfig, minutesArg?: string) {
  if (minutesArg) {
    const mins = parseInt(minutesArg, 10);
    if (isNaN(mins) || mins < 5 || mins > 1440) {
      warn("Interval must be between 5 and 1440 minutes.");
      return;
    }
    saveConfig({ ...config, brainLoopIntervalMinutes: mins });
    const label = mins < 60 ? `${mins} minutes` : `${mins / 60} hour${mins > 60 ? "s" : ""}`;
    ok(`Brain loop interval set to every ${label}.`);
    info("Restart `employeeos start` for the change to take effect.");
    return;
  }

  // Interactive picker
  banner();
  section("Brain Loop Schedule");

  const current = config.brainLoopIntervalMinutes ?? 60;
  info(`Current interval: ${current} minutes`);
  console.log("");

  const { choice } = await inquirer.prompt([{
    type: "list",
    name: "choice",
    message: "How often should the brain tick?",
    choices: [
      { name: "Every 15 minutes  (aggressive monitoring)", value: 15 },
      { name: "Every 30 minutes", value: 30 },
      { name: "Every 60 minutes  (default)", value: 60 },
      { name: "Every 2 hours", value: 120 },
      { name: "Every 4 hours     (low usage)", value: 240 },
      { name: "Every 8 hours     (minimal)", value: 480 },
    ],
    default: current,
  }]);

  saveConfig({ ...config, brainLoopIntervalMinutes: choice });
  const label = choice < 60 ? `${choice} minutes` : `${choice / 60} hour${choice > 60 ? "s" : ""}`;
  ok(`Interval set to every ${label}. Restart \`employeeos start\` to apply.`);
}

// -- Usage dashboard ------------------------------------------------------

const ROLE_EMOJI: Record<string, string> = {
  "ceo-assistant": "Brain",
  "marketing-manager": "Mktg",
  "sales-manager": "Sales",
  "support-manager": "Supp",
  "finance-manager": "Fin",
  "hr-manager": "HR",
};

async function showUsage(config: AppConfig) {
  const db = await openDB(config);
  const rows = await db.getUsageStats(config.companyId, 30);
  db.close();

  banner();
  section("Token Usage (last 30 days)");

  if (rows.length === 0) {
    info("No usage data yet. Start the brain loop to generate activity.");
    return;
  }

  const byRole: Record<string, { inputTokens: number; outputTokens: number; calls: number }> = {};
  let totalIn = 0, totalOut = 0;

  for (const row of rows) {
    const r = row.employeeRole;
    if (!byRole[r]) byRole[r] = { inputTokens: 0, outputTokens: 0, calls: 0 };
    byRole[r]!.inputTokens += row.inputTokens;
    byRole[r]!.outputTokens += row.outputTokens;
    byRole[r]!.calls += 1;
    totalIn += row.inputTokens;
    totalOut += row.outputTokens;
  }

  const costUsd = (totalIn * 3 + totalOut * 15) / 1_000_000;

  console.log(chalk.bold("  Total:"));
  console.log(chalk.gray(`    Input tokens:  ${fmtNum(totalIn)}`));
  console.log(chalk.gray(`    Output tokens: ${fmtNum(totalOut)}`));
  console.log(chalk.cyan(`    Est. cost:     $${costUsd.toFixed(4)} USD`));
  console.log(chalk.gray("    (Claude Sonnet pricing: $3/M input · $15/M output, ~4 chars/token)"));
  console.log("");
  console.log(chalk.bold("  By employee:"));

  const sorted = Object.entries(byRole).sort((a, b) =>
    (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens)
  );

  for (const [role, stats] of sorted) {
    const cost = (stats.inputTokens * 3 + stats.outputTokens * 15) / 1_000_000;
    const label = ROLE_EMOJI[role] ?? role;
    console.log(
      chalk.cyan(`  ${label.padEnd(8)}`),
      chalk.gray(`in: ${fmtNum(stats.inputTokens).padStart(7)}  out: ${fmtNum(stats.outputTokens).padStart(7)}  calls: ${stats.calls}`),
      chalk.bold(`  $${cost.toFixed(4)}`)
    );
  }
  console.log("");
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

async function openBrowser(url: string) {
  const { exec } = await import("node:child_process");
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` :
    process.platform === "darwin" ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, (err) => { if (err) warn("Could not auto-open browser. Visit: " + url); });
}

async function startLoop(config: AppConfig) {
  const db = await openDB(config);
  const ai = await createProvider(config.aiProvider, { apiKey: config.aiApiKey, authToken: config.aiAuthToken, model: config.aiModel, baseURL: config.aiBaseURL });

  const intervalMins = config.brainLoopIntervalMinutes ?? 60;
  const intervalLabel = intervalMins < 60 ? `${intervalMins}m` : `${intervalMins / 60}h`;

  banner();
  section("Starting Brain Loop");
  info(`Tick interval: every ${intervalLabel} (observe + plan)`);
  info("Daily:  morning brief");
  info("Weekly: executive review");
  console.log("");

  // Start the web gateway
  const gatewaySpinner = ora("  Starting web interface...").start();
  let broadcast: ((msg: string) => void) | undefined;
  let closeGateway: (() => Promise<void>) | undefined;

  try {
    const { startGateway } = await import("@employeeos/gateway");
    const gw = await startGateway(3001);
    broadcast = gw.broadcast;
    closeGateway = gw.close;
    gatewaySpinner.succeed("  Web UI ready at http://localhost:3001");
    await openBrowser("http://localhost:3001");
  } catch {
    gatewaySpinner.warn("  Web UI not available (build `apps/web` first)");
  }

  // Wire Telegram notifier if configured
  let telegramNotify: ((msg: string) => void) | undefined;
  if (config.telegramBotToken && config.telegramChatId) {
    try {
      const { createTelegramNotifier, startTelegramBot } = await import("@employeeos/telegram");
      telegramNotify = createTelegramNotifier(config.telegramBotToken, config.telegramChatId);
      await startTelegramBot(config.telegramBotToken, db, ai, config.companyId);
      ok("  Telegram bot connected");
    } catch {
      warn("  Telegram bot failed to start");
    }
  }

  // Wire Discord notifier if configured
  let discordNotify: ((msg: string) => void) | undefined;
  if (config.discordBotToken && config.discordChannelId) {
    try {
      const { createDiscordNotifier, startDiscordBot } = await import("@employeeos/discord");
      discordNotify = createDiscordNotifier(config.discordBotToken, config.discordChannelId);
      await startDiscordBot(config.discordBotToken, db, ai, config.companyId, config.discordChannelId);
      ok("  Discord bot connected");
    } catch {
      warn("  Discord bot failed to start");
    }
  }

  // Wire WhatsApp notifier if configured
  let whatsappNotify: ((msg: string) => void) | undefined;
  if (config.whatsappEnabled && config.whatsappPhoneNumber) {
    try {
      const { createWhatsAppNotifier } = await import("@employeeos/whatsapp");
      whatsappNotify = createWhatsAppNotifier(config.whatsappPhoneNumber);
      ok("  WhatsApp notifications active → " + config.whatsappPhoneNumber);
    } catch {
      warn("  WhatsApp notifier failed to start");
    }
  }

  // Wire email notifier if configured
  let emailNotify: ((msg: string) => void) | undefined;
  if (config.emailTo && config.emailSmtp && config.emailUser && config.emailPass) {
    try {
      const { createEmailNotifier } = await import("@employeeos/email");
      emailNotify = createEmailNotifier({
        to: config.emailTo,
        smtp: config.emailSmtp,
        user: config.emailUser,
        pass: config.emailPass,
      });
      ok("  Email notifications active → " + config.emailTo);
    } catch {
      warn("  Email notifier failed to start");
    }
  }

  // Load skills from ~/.employeeos/skills/
  let skillContext = "";
  try {
    const { loadSkills, getSkillContext, installSampleSkills } = await import("@employeeos/skills");
    installSampleSkills(SKILLS_DIR);
    const skills = loadSkills(SKILLS_DIR);
    if (skills.length > 0) {
      skillContext = getSkillContext(skills, "*");
      ok(`  ${skills.length} skills loaded from ${SKILLS_DIR}`);
    }
  } catch {
    // skills package optional
  }

  info("Press Ctrl+C to stop.");
  console.log("");

  const loop = startBrainLoop(db, ai, config.companyId, {
    onLog: (msg: string) => {
      console.log(chalk.gray("  [brain] " + msg));
      broadcast?.(msg);
    },
    onNotify: (msg: string) => {
      console.log(chalk.cyan("  [notify] " + msg));
      broadcast?.(msg);
      telegramNotify?.(msg);
      emailNotify?.(msg);
      discordNotify?.(msg);
      whatsappNotify?.(msg);
    },
    intervalMinutes: config.brainLoopIntervalMinutes ?? 60,
    extraContext: skillContext || undefined,
    imapConfig: (config.imapHost && config.imapUser && config.imapPass)
      ? { host: config.imapHost, port: config.imapPort ?? 993, user: config.imapUser, pass: config.imapPass, tls: config.imapTls !== false }
      : undefined,
    toolConfig: (config.githubToken || config.composioApiKey)
      ? {
          githubToken: config.githubToken,
          githubOwner: config.githubOwner,
          githubRepo: config.githubRepo,
          composioApiKey: config.composioApiKey,
        }
      : undefined,
  });

  process.on("SIGINT", () => {
    loop.stop();
    db.close();
    console.log("\n");
    ok("Brain loop stopped.");
    closeGateway?.().finally(() => process.exit(0));
  });
}

// -- CLI ------------------------------------------------------------------

const program = new Command();

program
  .name("employeeos")
  .description("The Open Source Company Brain")
  .version("1.0.0");

program
  .command("init")
  .alias("onboard")
  .description("Set up EmployeeOS for your company")
  .action(async () => {
    const existing = loadConfig();
    if (existing) {
      const { overwrite } = await inquirer.prompt([{
        type: "confirm",
        name: "overwrite",
        message: "EmployeeOS is already set up. Re-run onboarding?",
        default: false
      }]);
      if (!overwrite) {
        info("Keeping existing setup. Run `employeeos` to see your dashboard.");
        process.exit(0);
      }
    }
    await runOnboarding();
  });

program
  .command("brief")
  .description("Generate today's morning brief")
  .action(async () => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await showBrief(config);
  });

program
  .command("think <question>")
  .description("Ask the brain a question")
  .action(async (question: string) => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await thinkAbout(question, config);
  });

program
  .command("status")
  .description("Show company health and status")
  .action(async () => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await showStatus(config);
  });

program
  .command("plans")
  .description("List AI-generated plans")
  .action(async () => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await showPlans(config);
  });

program
  .command("employees")
  .description("List your AI employees")
  .action(async () => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await showEmployees(config);
  });

program
  .command("start")
  .description("Start the background brain loop")
  .action(async () => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await startLoop(config);
  });

program
  .command("import [file]")
  .description("Import business metrics from CSV or JSON file")
  .action(async (file?: string) => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await runImport(config, file);
  });

program
  .command("mcp")
  .description("Start the MCP server (for Claude Desktop integration)")
  .action(async () => {
    await runMcpServer();
  });

program
  .command("browse <url> [task]")
  .description("Open URL in browser and extract metrics using AI")
  .action(async (url: string, task = "Extract all visible business metrics and KPIs from this page") => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await runBrowse(url, task, config);
  });

program
  .command("telegram")
  .description("Connect Telegram for notifications and remote brain access")
  .action(async () => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await runTelegramSetup(config);
  });

program
  .command("discord")
  .description("Connect Discord bot for notifications and slash commands")
  .action(async () => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await runDiscordSetup(config);
  });

program
  .command("whatsapp")
  .description("Connect WhatsApp for notifications and !commands")
  .action(async () => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await runWhatsAppSetup(config);
  });

program
  .command("cron [minutes]")
  .description("View or set the brain loop tick interval (minutes)")
  .action(async (minutes?: string) => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await runCronConfig(config, minutes);
  });

program
  .command("usage")
  .description("Show token usage and estimated cost by AI employee")
  .action(async () => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await showUsage(config);
  });

// -- Import (CSV / JSON) --------------------------------------------------

const SAMPLE_CSV_PATH = path.join(os.homedir(), ".employeeos", "sample-metrics.csv");
const SAMPLE_CSV_URL = "https://raw.githubusercontent.com/yourusername/employeeos/main/samples/metrics.csv";

const SAMPLE_CSV_HEADER = "date,category,metric,value,unit,brand,notes";
const SAMPLE_CSV_ROWS = [
  "2024-01-01,revenue,monthly_revenue,125000,USD,,Total revenue for the month",
  "2024-01-01,marketing,website_visitors,8500,count,,Unique visitors",
  "2024-01-01,marketing,leads_generated,320,count,,All channels combined",
  "2024-01-01,marketing,ad_spend,8500,USD,,Meta Ads + Google Ads",
  "2024-01-01,marketing,cost_per_lead,26.56,USD,,",
  "2024-01-01,sales,deals_closed,28,count,,Won deals",
  "2024-01-01,sales,win_rate,70,percent,,",
  "2024-01-01,sales,pipeline_value,450000,USD,,Total open pipeline",
  "2024-01-01,support,tickets_open,145,count,,Open at end of month",
  "2024-01-01,support,csat_score,4.2,score,,Out of 5",
  "2024-01-01,hr,headcount,42,count,,Full-time employees",
  "2024-01-01,finance,burn_rate,85000,USD,,Monthly cash burn",
  "2024-01-01,finance,gross_margin,68,percent,,",
  "2024-01-01,finance,ltv_cac_ratio,8.4,ratio,,",
  "2024-01-01,operations,nps_score,52,score,,Net Promoter Score",
  "2024-01-01,operations,uptime_percent,99.8,percent,,"
];

function generateSampleCSV(): string {
  return [SAMPLE_CSV_HEADER, ...SAMPLE_CSV_ROWS].join("\n") + "\n";
}

interface CSVRow {
  date?: string;
  category?: string;
  metric?: string;
  value?: string;
  unit?: string;
  brand?: string;
  notes?: string;
}

function parseCSV(content: string): CSVRow[] {
  const lines = content.split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  if (lines.length < 2) return [];

  const headers = lines[0]!.split(",").map(h => h.trim().toLowerCase());
  const rows: CSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const cols = line.split(",");
    const row: CSVRow = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j] as keyof CSVRow;
      if (key) row[key] = (cols[j] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

async function runImport(config: AppConfig, filePath?: string) {
  banner();
  section("Import Metrics");

  let csvPath = filePath;

  if (!csvPath) {
    info("CSV format: date,category,metric,value,unit,brand,notes");
    info("Categories: revenue, marketing, sales, support, hr, finance, operations");
    console.log("");

    const { choice } = await inquirer.prompt([{
      type: "list",
      name: "choice",
      message: "What do you want to do?",
      choices: [
        { name: "Generate sample CSV template to fill in", value: "sample" },
        { name: "Import an existing CSV file", value: "import" },
        { name: "Import existing JSON data", value: "json" }
      ]
    }]);

    if (choice === "sample") {
      ensureConfigDir();
      fs.writeFileSync(SAMPLE_CSV_PATH, generateSampleCSV(), "utf-8");
      ok("Sample CSV created: " + SAMPLE_CSV_PATH);
      info("Fill it in with your real numbers, then run:");
      info("  employeeos import " + SAMPLE_CSV_PATH);
      console.log("");
      return;
    }

    const { inputPath } = await inquirer.prompt([{
      type: "input",
      name: "inputPath",
      message: choice === "json" ? "Path to JSON file:" : "Path to CSV file:",
      validate: (v: string) => fs.existsSync(v.trim()) || "File not found: " + v
    }]);
    csvPath = inputPath.trim();
  }

  const resolvedPath = csvPath ?? "";
  if (!fs.existsSync(resolvedPath)) {
    console.error(chalk.red("File not found: " + resolvedPath));
    process.exit(1);
  }
  const ext = path.extname(resolvedPath).toLowerCase();

  // -- PDF import path -------------------------------------------------------
  if (ext === ".pdf") {
    const pdfSpinner = ora("  Reading PDF...").start();
    let pdfText = "";
    try {
      const buffer = fs.readFileSync(resolvedPath);
      const { default: pdfParse } = await import("pdf-parse");
      const data = await pdfParse(buffer);
      pdfText = data.text;
      pdfSpinner.succeed(`  PDF read (${data.numpages} page${data.numpages !== 1 ? "s" : ""}, ${pdfText.length} chars)`);
    } catch (err) {
      pdfSpinner.fail("  PDF read failed: " + (err as Error).message);
      process.exit(1);
    }

    const ai = await createProvider(config.aiProvider, { apiKey: config.aiApiKey, authToken: config.aiAuthToken, model: config.aiModel, baseURL: config.aiBaseURL });
    const extractSpinner = ora("  Extracting business signals with AI...").start();

    const prompt = `Extract business signals from this document. Write one line per signal:
SIGNAL|category|one-sentence description
Categories: revenue, marketing, sales, support, hr, finance, operations, strategy
Only extract concrete, actionable business information. Skip boilerplate.

Document (first 6000 chars):
${pdfText.slice(0, 6000)}`;

    const result = await ai.generate(prompt, {
      system: "Extract only meaningful business signals. Be specific and concise.",
      maxTokens: 800,
    });

    const signals: Array<{ category: string; description: string }> = [];
    for (const line of result.split("\n")) {
      if (!line.startsWith("SIGNAL|")) continue;
      const [, category, description] = line.split("|");
      if (category && description) signals.push({ category: category.trim(), description: description.trim() });
    }

    extractSpinner.succeed(`  Extracted ${signals.length} business signal${signals.length !== 1 ? "s" : ""}`);
    console.log("");

    if (signals.length === 0) { warn("No business signals found in PDF."); return; }

    for (const s of signals.slice(0, 8)) {
      console.log(chalk.gray(`  [${s.category}] ${s.description}`));
    }
    if (signals.length > 8) info(`  ... and ${signals.length - 8} more`);
    console.log("");

    const { confirmed } = await inquirer.prompt([{
      type: "confirm",
      name: "confirmed",
      message: `Import ${signals.length} signals from PDF into the brain?`,
      default: true
    }]);
    if (!confirmed) { info("Import cancelled."); return; }

    const db = await openDB(config);
    const saveSpinner = ora(`  Saving ${signals.length} signals...`).start();
    const cats: Record<string, number> = {};
    const date = new Date().toISOString().slice(0, 10);
    const fileName = path.basename(resolvedPath);
    for (const s of signals) {
      const obsId = await db.createObservation(config.companyId, "pdf_import", s.category, `${date}: ${s.description}`);
      await db.createEvent(config.companyId, "observation.created", {
        source: "pdf_import",
        observationId: obsId,
        summary: s.description,
        category: s.category,
        file: fileName,
      });
      cats[s.category] = (cats[s.category] ?? 0) + 1;
    }
    db.close();
    saveSpinner.succeed(`  Imported ${signals.length} signals`);
    console.log("");
    for (const [cat, count] of Object.entries(cats)) ok(`${count} ${cat} signal${count > 1 ? "s" : ""}`);
    console.log("");
    info("Run `employeeos brief` to see these signals reflected in your morning report.");
    console.log("");
    return;
  }

  // -- CSV / JSON import path ------------------------------------------------
  const content = fs.readFileSync(resolvedPath, "utf-8");
  let rows: CSVRow[] = [];

  if (ext === ".json") {
    try {
      const data = JSON.parse(content);
      rows = Array.isArray(data) ? data : [data];
    } catch {
      console.error(chalk.red("Invalid JSON file"));
      process.exit(1);
    }
  } else {
    // Use papaparse for robust CSV handling (quoted fields, varied delimiters)
    const { default: Papa } = await import("papaparse");
    const parsed = Papa.parse<CSVRow>(content, { header: true, skipEmptyLines: true, dynamicTyping: false });
    rows = parsed.data.map(r => {
      const lower: CSVRow = {};
      for (const [k, v] of Object.entries(r)) lower[k.toLowerCase() as keyof CSVRow] = v as string;
      return lower;
    });
  }

  if (rows.length === 0) {
    warn("No data rows found in file.");
    return;
  }

  // Validate
  const valid = rows.filter(r => r.category && r.metric && r.value && !isNaN(parseFloat(r.value)));
  const skipped = rows.length - valid.length;

  console.log("");
  info("Found " + valid.length + " valid rows" + (skipped > 0 ? " (" + skipped + " skipped - missing required fields)" : ""));
  console.log("");

  // Preview first 5
  const preview = valid.slice(0, 5);
  for (const r of preview) {
    console.log(chalk.gray("  " + (r.date ?? "today") + " | " + r.category + " | " + r.metric + " = " + r.value + " " + (r.unit ?? "")));
  }
  if (valid.length > 5) info("... and " + (valid.length - 5) + " more rows");
  console.log("");

  const { confirmed } = await inquirer.prompt([{
    type: "confirm",
    name: "confirmed",
    message: "Import " + valid.length + " metric rows into the brain?",
    default: true
  }]);

  if (!confirmed) {
    info("Import cancelled.");
    return;
  }

  const db = await openDB(config);
  const spinner = ora("  Importing " + valid.length + " rows...").start();

  const categories: Record<string, number> = {};
  for (const r of valid) {
    const date = r.date ?? new Date().toISOString().slice(0, 10);
    const brand = r.brand ? " [" + r.brand + "]" : "";
    const notes = r.notes ? " - " + r.notes : "";
    const obsContent = date + brand + ": " + r.metric + " = " + r.value + " " + (r.unit ?? "count") + notes;
    await db.createObservation(config.companyId, "csv_import", r.category ?? "general", obsContent);
    categories[r.category ?? "general"] = (categories[r.category ?? "general"] ?? 0) + 1;
  }

  // Single summary event so the timeline stays reconstructable
  await db.createEvent(config.companyId, "observation.created", {
    source: "csv_import",
    count: valid.length,
    categories: Object.keys(categories),
  });

  db.close();
  spinner.succeed("  Imported " + valid.length + " metrics");
  console.log("");

  for (const [cat, count] of Object.entries(categories)) {
    ok(count + " " + cat + " metrics");
  }

  console.log("");
  info("Run `employeeos brief` to see these metrics reflected in your morning report.");
  info("Run `employeeos think \"what do my metrics say?\"` to analyze them.");
  console.log("");
}

// -- Email Setup ----------------------------------------------------------

async function runEmailSetup(config: AppConfig) {
  banner();
  section("Connect Email Notifications");

  info("Email sends morning briefs, anomaly alerts, and plan notifications.");
  info("Works with Gmail (app password), Outlook SMTP, or any SMTP server.");
  console.log("");

  if (config.emailTo) {
    info("Currently configured: " + config.emailTo);
    const { reconfigure } = await inquirer.prompt([{
      type: "confirm",
      name: "reconfigure",
      message: "Reconfigure email?",
      default: false
    }]);
    if (!reconfigure) return;
  }

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "emailTo",
      message: "Send notifications to (your email):",
      validate: (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Enter a valid email"
    },
    {
      type: "list",
      name: "smtpPreset",
      message: "Email provider:",
      choices: [
        { name: "Gmail (recommended)", value: "gmail" },
        { name: "Outlook / Hotmail", value: "outlook" },
        { name: "Custom SMTP", value: "custom" }
      ]
    }
  ]);

  let smtp = "";
  if (answers.smtpPreset === "gmail") {
    smtp = "smtp.gmail.com:587";
    console.log("");
    info("For Gmail, use an App Password (not your regular password).");
    info("Create one at: https://myaccount.google.com/apppasswords");
    info('  Steps: Google Account → Security → 2-Step Verification → App passwords');
    console.log("");
  } else if (answers.smtpPreset === "outlook") {
    smtp = "smtp-mail.outlook.com:587";
  } else {
    const { customSmtp } = await inquirer.prompt([{
      type: "input",
      name: "customSmtp",
      message: "SMTP host:port (e.g. smtp.example.com:587):",
      validate: (v: string) => v.includes(":") || "Format: host:port"
    }]);
    smtp = customSmtp;
  }

  const credentials = await inquirer.prompt([
    {
      type: "input",
      name: "emailUser",
      message: "Email address (sender / login):",
      default: answers.smtpPreset === "gmail" ? answers.emailTo : undefined,
      validate: (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Enter a valid email"
    },
    {
      type: "password",
      name: "emailPass",
      message: answers.smtpPreset === "gmail" ? "Gmail App Password (16-char):" : "Password:",
      validate: (v: string) => v.trim().length > 6 || "Password too short"
    }
  ]);

  // Test connection
  const testSpinner = ora("  Testing SMTP connection...").start();
  try {
    const { testEmailConnection, sendTestEmail } = await import("@employeeos/email");
    const testCfg = {
      to: answers.emailTo as string,
      smtp,
      user: credentials.emailUser as string,
      pass: credentials.emailPass as string
    };
    await testEmailConnection(testCfg);
    testSpinner.succeed("  SMTP connection verified");

    const sendSpinner = ora("  Sending test email...").start();
    await sendTestEmail(testCfg);
    sendSpinner.succeed("  Test email sent to " + answers.emailTo);
  } catch (err) {
    testSpinner.fail("  Connection failed: " + (err as Error).message);
    if (answers.smtpPreset === "gmail") {
      console.log("");
      warn("Gmail tip: Make sure you used an App Password, not your regular password.");
      warn("Also check that 2FA is enabled on your Google account.");
    }
    process.exit(1);
  }

  // Save SMTP config
  config.emailTo = answers.emailTo as string;
  config.emailSmtp = smtp;
  config.emailUser = credentials.emailUser as string;
  config.emailPass = credentials.emailPass as string;
  saveConfig(config);

  console.log("");
  ok("Email connected! You'll receive:");
  info("  - Morning briefs daily");
  info("  - Anomaly alerts");
  info("  - Plan approval requests");
  info("  - Weekly executive reviews");
  console.log("");

  // Offer IMAP inbox reading
  const { enableImap } = await inquirer.prompt([{
    type: "confirm",
    name: "enableImap",
    message: "Also read your inbox to auto-detect business signals? (IMAP)",
    default: true
  }]);

  if (enableImap) {
    console.log("");
    info("IMAP lets EmployeeOS read incoming emails and surface business signals.");
    info("Gmail: use imap.gmail.com:993 with the same App Password.");
    console.log("");

    const imapAnswers = await inquirer.prompt([
      {
        type: "input",
        name: "imapHost",
        message: "IMAP host:",
        default: answers.smtpPreset === "gmail" ? "imap.gmail.com"
               : answers.smtpPreset === "outlook" ? "outlook.office365.com"
               : "",
        validate: (v: string) => v.trim().length > 0 || "Required"
      },
      {
        type: "input",
        name: "imapPort",
        message: "IMAP port:",
        default: "993",
        validate: (v: string) => !isNaN(parseInt(v)) || "Must be a number"
      },
      {
        type: "input",
        name: "imapUser",
        message: "IMAP login (usually your email):",
        default: credentials.emailUser as string,
        validate: (v: string) => v.trim().length > 0 || "Required"
      },
      {
        type: "password",
        name: "imapPass",
        message: "IMAP password (same App Password for Gmail):",
        validate: (v: string) => v.trim().length > 4 || "Too short"
      }
    ]);

    const imapSpinner = ora("  Testing IMAP connection...").start();
    try {
      const { testImapConnection } = await import("@employeeos/email");
      await testImapConnection({
        host: imapAnswers.imapHost as string,
        port: parseInt(imapAnswers.imapPort as string),
        user: imapAnswers.imapUser as string,
        pass: imapAnswers.imapPass as string,
        tls: true,
      });
      imapSpinner.succeed("  IMAP connected");

      config.imapHost = imapAnswers.imapHost as string;
      config.imapPort = parseInt(imapAnswers.imapPort as string);
      config.imapUser = imapAnswers.imapUser as string;
      config.imapPass = imapAnswers.imapPass as string;
      config.imapTls = true;
      saveConfig(config);

      ok("Inbox reading enabled — brain will scan emails every hour");
    } catch (err) {
      imapSpinner.fail("  IMAP failed: " + (err as Error).message);
      warn("Continuing without inbox reading. Run `employeeos email` to retry.");
    }
  }

  console.log("");
  info("Restart `employeeos start` to activate email notifications.");
  console.log("");
}

// -- GitHub Setup ---------------------------------------------------------

async function runGitHubSetup(config: AppConfig) {
  banner();
  section("Connect GitHub");

  info("GitHub lets EmployeeOS create issues, comment on PRs, and track repo health.");
  info("You need a Personal Access Token with repo permissions.");
  info("Create one at: https://github.com/settings/tokens/new");
  info("Scopes needed: repo (full), read:user");
  console.log("");

  if (config.githubToken) {
    info("GitHub is already connected. Reconfigure?");
    const { reconfigure } = await inquirer.prompt([{
      type: "confirm", name: "reconfigure", message: "Reconfigure GitHub?", default: false
    }]);
    if (!reconfigure) return;
  }

  const answers = await inquirer.prompt([
    {
      type: "password", name: "token",
      message: "GitHub Personal Access Token:",
      validate: (v: string) => v.trim().length > 10 || "Token too short"
    },
    {
      type: "input", name: "owner",
      message: "Default GitHub owner (username or org):",
      validate: (v: string) => v.trim().length > 0 || "Required"
    },
    {
      type: "input", name: "repo",
      message: "Default repository name (optional, press enter to skip):",
      default: ""
    },
  ]);

  const spinner = ora("  Verifying GitHub token...").start();
  try {
    const { testConnection } = await import("@employeeos/github");
    const user = await testConnection({ token: answers.token as string });
    spinner.succeed(`  Connected as @${user.login} (${user.name})`);

    config.githubToken = answers.token as string;
    config.githubOwner = (answers.owner as string).trim();
    config.githubRepo = (answers.repo as string).trim() || undefined;
    saveConfig(config);

    const db = await openDB(config);
    await db.upsertToolConnection(config.companyId, "github", "connected", {
      owner: config.githubOwner,
      repo: config.githubRepo ?? null,
    });
    db.close();

    console.log("");
    ok("GitHub connected! EmployeeOS can now:");
    info("  - Create issues from anomaly observations");
    info("  - Comment on PRs with execution summaries");
    info("  - Open PRs as plan actions");
    info("  - Track repo health as business signals");
    console.log("");
    info("Restart `employeeos start` to activate GitHub actions in the brain loop.");
  } catch (err) {
    spinner.fail("  GitHub connection failed: " + (err as Error).message);
    process.exit(1);
  }
  console.log("");
}

// -- Composio Setup -------------------------------------------------------

async function runComposioSetup(config: AppConfig, targetApp?: string) {
  banner();
  section("Connect Apps via Composio");

  info("Composio gives EmployeeOS 250+ SaaS integrations: Slack, Gmail, Notion, HubSpot, Stripe...");
  info("Get a free API key at: https://composio.dev");
  console.log("");

  if (!config.composioApiKey) {
    const { apiKey } = await inquirer.prompt([{
      type: "password", name: "apiKey",
      message: "Composio API key:",
      validate: (v: string) => v.trim().length > 10 || "Key too short"
    }]);

    const verifySpinner = ora("  Verifying Composio API key...").start();
    try {
      const { testApiKey } = await import("@employeeos/composio");
      const result = await testApiKey(apiKey as string);
      if (!result.valid) { verifySpinner.fail("  Invalid API key"); process.exit(1); }
      verifySpinner.succeed("  Composio connected" + (result.email ? ` (${result.email})` : ""));

      config.composioApiKey = (apiKey as string).trim();
      saveConfig(config);
    } catch (err) {
      verifySpinner.fail("  Failed: " + (err as Error).message);
      process.exit(1);
    }
    console.log("");
  } else {
    ok("Composio API key already configured.");
    console.log("");
  }

  const { listConnections } = await import("@employeeos/composio");
  const listSpinner = ora("  Loading connected apps...").start();
  let liveConnections: Array<{ appName: string; status: string; id: string }> = [];
  try {
    liveConnections = (await listConnections(config.composioApiKey!)) as Array<{ appName: string; status: string; id: string }>;
    listSpinner.succeed(`  ${liveConnections.length} app${liveConnections.length !== 1 ? "s" : ""} authorized in Composio`);
  } catch {
    listSpinner.warn("  Could not reach Composio API (will use local state)");
  }

  // Sync authoritative Composio connection state into local DB
  if (liveConnections.length > 0) {
    const dbSync = await openDB(config);
    for (const lc of liveConnections) {
      await dbSync.upsertToolConnection(
        config.companyId,
        `composio:${lc.appName.toLowerCase()}`,
        "connected",
        { connectionId: lc.id }
      );
    }
    dbSync.close();
    console.log("");
    info("Connected apps:");
    for (const lc of liveConnections) {
      ok(`  ${lc.appName} — ${lc.status}`);
    }
    console.log("");
  }

  const appToConnect = targetApp ?? await (async () => {
    const { app } = await inquirer.prompt([{
      type: "list", name: "app",
      message: "Which app do you want to connect?",
      choices: [
        { name: "Slack — send messages to channels", value: "slack" },
        { name: "Gmail — send and read emails", value: "gmail" },
        { name: "Notion — create pages and search", value: "notion" },
        { name: "HubSpot — CRM: deals, contacts", value: "hubspot" },
        { name: "Stripe — read balance, customers", value: "stripe" },
        { name: "Done — exit", value: "done" },
      ]
    }]);
    return app as string;
  })();

  if (appToConnect === "done") return;

  const { initiateOAuthConnection } = await import("@employeeos/composio");
  const oauthSpinner = ora(`  Initiating ${appToConnect} OAuth connection...`).start();
  try {
    const result = await initiateOAuthConnection(config.composioApiKey!, appToConnect);
    oauthSpinner.succeed(`  ${appToConnect} OAuth URL generated`);
    console.log("");
    info(`Open this URL in your browser to authorize ${appToConnect}:`);
    if (result.redirectUrl) {
      console.log(chalk.cyan("  " + result.redirectUrl));
    } else {
      warn("  No redirect URL returned — check Composio dashboard");
    }
    console.log("");
    info("After authorizing, return here and run `employeeos connect` again to verify.");

    // Store a per-app row (composio:<app>) — status "pending_auth" until confirmed
    const db = await openDB(config);
    await db.upsertToolConnection(
      config.companyId,
      `composio:${appToConnect}`,
      "pending_auth",
      { connectionId: result.connectionId ?? null }
    );
    db.close();
  } catch (err) {
    oauthSpinner.fail("  Failed: " + (err as Error).message);
  }
  console.log("");
}

// -- Skills Command -------------------------------------------------------

async function runSkillsCommand(opts: { list?: boolean; open?: boolean; installSamples?: boolean }) {
  const { loadSkills, listSkills, installSampleSkills } = await import("@employeeos/skills");

  banner();
  section("Custom Skills");

  info("Skills are Markdown files in: " + SKILLS_DIR);
  info("Each file teaches your AI employees a specific behavior.");
  console.log("");

  if (opts.installSamples) {
    const count = installSampleSkills(SKILLS_DIR);
    if (count > 0) ok("Installed " + count + " sample skills to " + SKILLS_DIR);
    else info("Sample skills already installed. Edit them in " + SKILLS_DIR);
    console.log("");
  }

  if (opts.open) {
    if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
    const { exec } = await import("node:child_process");
    const cmd = process.platform === "win32" ? `explorer "${SKILLS_DIR}"` :
                process.platform === "darwin" ? `open "${SKILLS_DIR}"` :
                `xdg-open "${SKILLS_DIR}"`;
    exec(cmd);
    ok("Opened: " + SKILLS_DIR);
    return;
  }

  const skills = loadSkills(SKILLS_DIR);

  if (skills.length === 0) {
    info("No skills found. Run with --install-samples to get started.");
    console.log("");
    info("To create your own skill, add a .md file to:");
    info("  " + SKILLS_DIR);
    console.log("");
    info("Skill file format:");
    console.log(chalk.gray("  ---"));
    console.log(chalk.gray("  name: my-skill"));
    console.log(chalk.gray("  description: What this skill does"));
    console.log(chalk.gray("  roles: [marketing-manager, sales-manager]  # or [*] for all"));
    console.log(chalk.gray("  ---"));
    console.log(chalk.gray("  Instructions for the AI employee go here."));
    console.log(chalk.gray("  Be specific. Use plain English. No code needed."));
    console.log("");
  } else {
    console.log(chalk.bold("  " + skills.length + " skill" + (skills.length !== 1 ? "s" : "") + " loaded:\n"));
    listSkills(skills);
    console.log("");
    info("Edit skills at: " + SKILLS_DIR);
    info("Changes take effect on the next `employeeos start`");
    console.log("");
  }
}

// -- MCP Server -----------------------------------------------------------

async function runMcpServer() {
  const { startMcpServer } = await import("@employeeos/mcp");
  await startMcpServer();
}

// -- Browser Automation ---------------------------------------------------

async function runBrowse(url: string, task: string, config: AppConfig) {
  const { browseAndExtractMetrics, getCDPLaunchInstructions } = await import("@employeeos/browser");
  const db = await openDB(config);
  const ai = await createProvider(config.aiProvider, {
    apiKey: config.aiApiKey,
    authToken: config.aiAuthToken,
    model: config.aiModel,
    baseURL: config.aiBaseURL,
  });

  banner();
  section("Browser Automation");
  info("URL: " + url);
  info("Task: " + task);
  console.log("");
  info(getCDPLaunchInstructions());
  console.log("");

  const spinner = ora("  Opening browser...").start();

  try {
    const { metrics, summary } = await browseAndExtractMetrics(
      url, task, ai, db, config.companyId,
      (msg: string) => { spinner.text = "  " + msg; }
    );

    spinner.succeed("  Done - " + metrics.length + " metrics extracted");
    console.log("");

    if (metrics.length > 0) {
      console.log(chalk.bold("  Extracted Metrics:"));
      for (const m of metrics) {
        console.log(chalk.cyan("  - " + m.category + "." + m.metric + " = " + m.value + " " + m.unit));
      }
      console.log("");
    }

    if (summary) {
      console.log(chalk.bold("  Summary:"));
      console.log(summary.split("\n").map(l => "  " + l).join("\n"));
      console.log("");
    }

    ok(metrics.length + " metrics saved to brain");
  } catch (err) {
    spinner.fail("  Browser automation failed");
    console.error(chalk.red("  " + (err as Error).message));
    console.log("");
    info("Tip: Install playwright browsers with: npx playwright install chromium");
  }

  db.close();
}

// -- Telegram Setup -----------------------------------------------------------

async function runTelegramSetup(config: AppConfig) {
  banner();
  section("Connect Telegram");

  info("Telegram gives you a bot that delivers morning briefs, alerts you when");
  info("AI plans need approval, and lets you ask the brain from your phone.");
  console.log("");

  info("Step 1: Create a bot at https://t.me/BotFather");
  info("  Send: /newbot  |  Choose a name  |  Copy the token it gives you");
  console.log("");

  const { botToken } = await inquirer.prompt([{
    type: "password",
    name: "botToken",
    message: "Paste your bot token:",
    validate: (v: string) => v.trim().length > 20 || "Token looks too short"
  }]);

  const token = botToken.trim();

  // Validate token
  const validateSpinner = ora("  Validating token...").start();
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json() as { ok: boolean; result?: { first_name: string; username: string } };
    if (!data.ok) throw new Error("Invalid token");
    validateSpinner.succeed("  Bot validated: @" + data.result?.username + " (" + data.result?.first_name + ")");
  } catch {
    validateSpinner.fail("  Invalid bot token");
    process.exit(1);
  }

  console.log("");
  info("Step 2: Open Telegram and message your bot /start");
  info("  Waiting up to 60 seconds for you to send /start...");
  console.log("");

  const waitSpinner = ora("  Waiting for /start message...").start();
  const { detectChatId } = await import("@employeeos/telegram");
  const chatId = await detectChatId(token, 60000);

  if (!chatId) {
    waitSpinner.fail("  Timed out. Run `employeeos telegram` again after messaging /start to your bot.");
    process.exit(1);
  }

  waitSpinner.succeed("  Got your chat ID: " + chatId);

  // Save to config
  config.telegramBotToken = token;
  config.telegramChatId = chatId;
  saveConfig(config);

  ok("Telegram connected!");
  console.log("");
  info("Your brain will now:");
  info("  - Deliver morning briefs automatically");
  info("  - Notify you when AI plans need approval (with Approve/Reject buttons)");
  info("  - Notify on anomalies and weekly reviews");
  info("  - Respond to /ask, /brief, /status, /plans in Telegram");
  console.log("");
  info("Test it: message your bot /brief");
  console.log("");

  // Send a welcome message
  const { createTelegramNotifier } = await import("@employeeos/telegram");
  const notify = createTelegramNotifier(token, chatId);
  notify("EmployeeOS connected! Your Company Brain is now online. Try /brief or /status.");
  ok("Welcome message sent to Telegram.");
  console.log("");
}

program
  .command("email")
  .description("Set up email notifications for briefs and alerts")
  .action(async () => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await runEmailSetup(config);
  });

program
  .command("github")
  .description("Connect GitHub for issue creation and PR management")
  .action(async () => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await runGitHubSetup(config);
  });

program
  .command("connect [app]")
  .description("Connect SaaS apps via Composio (Slack, Gmail, Notion, HubSpot, Stripe...)")
  .action(async (app?: string) => {
    const config = loadConfig();
    if (!config) { info("Run `employeeos init` first."); process.exit(1); }
    await runComposioSetup(config, app);
  });

program
  .command("skills")
  .description("Manage custom skills that guide your AI employees")
  .option("--list", "List loaded skills")
  .option("--open", "Open skills directory in file explorer")
  .option("--install-samples", "Install sample skill files")
  .action(async (opts) => {
    await runSkillsCommand(opts as { list?: boolean; open?: boolean; installSamples?: boolean });
  });

// -- Default action: show dashboard if config exists, else prompt init
program.action(async () => {
  const config = loadConfig();
  if (!config) {
    banner();
    info("EmployeeOS is not set up yet.");
    info("Run `employeeos init` to get started.");
    console.log("");
  } else {
    await showDashboard(config);
  }
});

program.parseAsync(process.argv).catch(err => {
  console.error(chalk.red("Error: " + err.message));
  process.exit(1);
});
