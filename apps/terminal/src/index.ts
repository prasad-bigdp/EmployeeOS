import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import ora from "ora";
import { DatabaseService } from "@employeeos/database";
import { createProvider } from "@employeeos/ai";
import { generateFirstReport, generateMorningBrief, answerQuestion } from "@employeeos/reporter";
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

function banner() {
  console.log("");
  console.log(chalk.bold.white("  EmployeeOS"));
  console.log(chalk.gray("  The Open Source Company Brain"));
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
  let aiModel: string | undefined;
  let aiBaseURL: string | undefined;

  const envAnthropic = process.env["ANTHROPIC_API_KEY"];
  const envOpenAI = process.env["OPENAI_API_KEY"];
  const envOpenRouter = process.env["OPENROUTER_API_KEY"];

  if (envAnthropic) {
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
        { name: "Anthropic (Claude) - Best quality, Recommended", value: "anthropic" },
        { name: "OpenAI (GPT-4o / o3-mini)", value: "openai" },
        { name: "OpenRouter - Access 400+ models with one key", value: "openrouter" },
        { name: "Ollama - Run locally, free, fully private", value: "ollama" }
      ]
    }]);

    aiProvider = chosenProvider as AIProviderName;

    if (aiProvider === "ollama") {
      const ollamaAnswers = await inquirer.prompt([
        {
          type: "input",
          name: "ollamaURL",
          message: "Ollama base URL:",
          default: "http://localhost:11434"
        },
        {
          type: "input",
          name: "ollamaModel",
          message: "Model name (must be pulled in Ollama):",
          default: "llama3.2"
        }
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
        validate: (v: string) => v.trim().length > 10 || "API key looks too short"
      }]);
      aiApiKey = keyAnswers.apiKey as string;

      if (aiProvider === "openrouter") {
        const modelAnswer = await inquirer.prompt([{
          type: "input",
          name: "model",
          message: "OpenRouter model (e.g. openai/gpt-4o-mini, anthropic/claude-3-haiku):",
          default: "openai/gpt-4o-mini"
        }]);
        aiModel = modelAnswer.model as string;
      }
    }
  }

  const aiSpinner = ora("  Validating AI connection...").start();
  try {
    const testAi = await createProvider(aiProvider, { apiKey: aiApiKey, model: aiModel, baseURL: aiBaseURL });
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
  const ai = await createProvider(aiProvider, { apiKey: aiApiKey, model: aiModel, baseURL: aiBaseURL });
  let firstReport: { body: string; score: number };

  try {
    firstReport = await generateFirstReport(db, ai, companyId);
    await db.createReport(
      companyId,
      "First Intelligence Brief - " + step1.companyName,
      firstReport.body,
      "first_brief",
      firstReport.score
    );
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
    aiModel,
    aiBaseURL,
    autonomyLevel,
    initialized: true
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
  const ai = await createProvider(config.aiProvider, { apiKey: config.aiApiKey, model: config.aiModel, baseURL: config.aiBaseURL });
  const spinner = ora("  Generating morning brief...").start();

  try {
    // Reuse today's saved brief if it exists; otherwise generate and save one
    let report = await db.getTodayReport(config.companyId, "morning_brief");
    if (!report) {
      const generated = await generateMorningBrief(db, ai, config.companyId);
      const id = await db.createReport(config.companyId, generated.title, generated.body, "morning_brief", generated.score);
      report = await db.getLatestReport(config.companyId, "morning_brief") ?? { ...generated, id, createdAt: new Date().toISOString(), kind: "morning_brief", companyId: config.companyId };
    }
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
  const ai = await createProvider(config.aiProvider, { apiKey: config.aiApiKey, model: config.aiModel, baseURL: config.aiBaseURL });
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
  const plans = await db.getPendingPlans(config.companyId);

  banner();
  section("AI-Generated Plans");

  if (plans.length === 0) {
    info("No pending plans. Run `employeeos start` to let the brain generate plans.");
  } else {
    for (const p of plans) {
      console.log(chalk.bold.cyan("  " + p.title));
      console.log(chalk.gray("  Role: " + p.employeeRole + " | Autonomy required: " + p.autonomyRequired));
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
  const ai = await createProvider(config.aiProvider, { apiKey: config.aiApiKey, model: config.aiModel, baseURL: config.aiBaseURL });

  banner();
  section("Starting Brain Loop");
  info("Hourly: observe + plan");
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
    },
    extraContext: skillContext || undefined,
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
  const content = fs.readFileSync(resolvedPath, "utf-8");
  const ext = path.extname(resolvedPath).toLowerCase();

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
    rows = parseCSV(content);
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
    const content = date + brand + ": " + r.metric + " = " + r.value + " " + (r.unit ?? "count") + notes;
    await db.createObservation(config.companyId, "csv_import", r.category ?? "general", content);
    categories[r.category ?? "general"] = (categories[r.category ?? "general"] ?? 0) + 1;
  }

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

  // Save config
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
  info("Restart `employeeos start` to activate email notifications.");
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
    model: config.aiModel,
    baseURL: config.aiBaseURL
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
