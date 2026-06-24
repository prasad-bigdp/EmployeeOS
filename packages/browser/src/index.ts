import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { AIProvider } from "@employeeos/ai";
import type { DatabaseService } from "@employeeos/database";

// -- Browser connection helpers -------------------------------------------

function getChromePaths(): string[] {
  if (process.platform === "win32") {
    return [
      path.join(process.env["LOCALAPPDATA"] ?? "", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env["PROGRAMFILES"] ?? "", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env["LOCALAPPDATA"] ?? "", "Microsoft/Edge/Application/msedge.exe")
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
}

export function findChrome(): string | undefined {
  return getChromePaths().find(p => fs.existsSync(p));
}

export function getChromeProfileDir(): string {
  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData/Local/Google/Chrome/User Data");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library/Application Support/Google/Chrome");
  }
  return path.join(os.homedir(), ".config/google-chrome");
}

// -- Browser session -------------------------------------------------------

export interface BrowseResult {
  url: string;
  title: string;
  text: string;
  screenshot?: Buffer;
}

export interface ExtractedMetric {
  category: string;
  metric: string;
  value: number;
  unit: string;
  notes?: string;
}

/**
 * Connect to a running Chrome via CDP, or launch Chrome with existing profile.
 * Returns a page that is already inside the user's logged-in session.
 */
export async function openBrowserPage(url: string): Promise<BrowseResult> {
  const { chromium } = await import("playwright-core");

  // Method 1: Connect to Chrome via CDP (user must run Chrome with --remote-debugging-port=9222)
  try {
    const browser = await chromium.connectOverCDP("http://localhost:9222", { timeout: 3000 });
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const title = await page.title();
    const text = await page.evaluate(() => (document.body as HTMLElement).innerText);
    const screenshot = await page.screenshot({ type: "png" });
    await page.close();
    return { url, title, text: text.slice(0, 10000), screenshot };
  } catch {
    // CDP not available, fall through to persistent context
  }

  // Method 2: Launch with existing Chrome profile (inherits logged-in sessions)
  const executablePath = findChrome();
  const userDataDir = getChromeProfileDir();

  if (!executablePath) {
    throw new Error(
      "Chrome not found. Install Google Chrome, then either:\n" +
      "  Option A: Start Chrome with `chrome --remote-debugging-port=9222`\n" +
      "  Option B: Install Chrome at a standard path and retry."
    );
  }

  if (!fs.existsSync(userDataDir)) {
    throw new Error(
      "Chrome profile not found at: " + userDataDir + "\n" +
      "Log into your services in Chrome first, then retry."
    );
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions-except="]
  });

  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  const title = await page.title();
  const text = await page.evaluate(() => (document.body as HTMLElement).innerText);
  const screenshot = await page.screenshot({ type: "png" });
  await page.close();
  await context.close();

  return { url, title, text: text.slice(0, 10000), screenshot };
}

// -- AI-powered metric extraction ------------------------------------------

/**
 * Open a URL in the user's browser, extract all visible text,
 * and use AI to identify and return business metrics.
 */
export async function browseAndExtractMetrics(
  url: string,
  task: string,
  ai: AIProvider,
  db: DatabaseService,
  companyId: string,
  onLog?: (msg: string) => void
): Promise<{ metrics: ExtractedMetric[]; summary: string }> {
  onLog?.("Opening browser: " + url);
  const result = await openBrowserPage(url);
  onLog?.("Page loaded: " + result.title);

  const prompt = [
    "You are a business intelligence analyst. A company uses you to extract metrics from web pages.",
    "",
    "Page URL: " + result.url,
    "Page Title: " + result.title,
    "",
    "Page Content (first 8000 chars):",
    result.text.slice(0, 8000),
    "",
    "Task: " + task,
    "",
    "Extract all business metrics visible on this page.",
    "Output each metric on its own line in EXACTLY this format:",
    "METRIC|category|metric_name|numeric_value|unit|notes",
    "",
    "Categories: revenue, marketing, sales, support, hr, finance, operations",
    "Units: USD, count, percent, score, days, hours, ms, ratio",
    "",
    "Example:",
    "METRIC|marketing|website_visitors|8500|count|last 30 days",
    "METRIC|revenue|monthly_revenue|125000|USD|",
    "",
    "After the METRIC lines, write a 2-3 sentence summary of what you found.",
    "If no numeric metrics are visible, say so clearly."
  ].join("\n");

  const response = await ai.generate(prompt, { maxTokens: 1500 });

  const metrics: ExtractedMetric[] = [];
  const lines = response.split("\n");
  const summaryLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("METRIC|")) {
      const parts = line.split("|");
      if (parts.length >= 5) {
        const value = parseFloat(parts[3] ?? "0");
        if (!isNaN(value)) {
          const metric: ExtractedMetric = {
            category: parts[1] ?? "general",
            metric: parts[2] ?? "unknown",
            value,
            unit: parts[4] ?? "count",
            notes: parts[5] ?? undefined
          };
          metrics.push(metric);

          const content = new Date().toISOString().slice(0, 10) + ": " +
            metric.metric + " = " + metric.value + " " + metric.unit +
            (metric.notes ? " - " + metric.notes : "") +
            " [source: " + result.url + "]";
          await db.createObservation(companyId, "browser_import", metric.category, content);
        }
      }
    } else if (!line.trim().startsWith("METRIC") && line.trim()) {
      summaryLines.push(line);
    }
  }

  const summary = summaryLines.join("\n").trim();
  onLog?.(metrics.length + " metrics extracted and saved");

  return { metrics, summary };
}

// -- CDP launch helper (tells the user how to enable remote debugging) -----

export function getCDPLaunchInstructions(): string {
  const chromePath = findChrome() ?? "chrome";
  if (process.platform === "win32") {
    return [
      "To let EmployeeOS connect to your logged-in Chrome session:",
      "",
      "1. Close Chrome completely",
      '2. Run this in PowerShell:',
      '   & "' + chromePath + '" --remote-debugging-port=9222',
      "3. Log into your services normally",
      '4. Then run: employeeos browse <url> "<task>"',
      "",
      "Or just let EmployeeOS launch Chrome with your profile (no setup needed)."
    ].join("\n");
  }
  return [
    "To let EmployeeOS connect to your logged-in Chrome session:",
    "",
    "1. Close Chrome completely",
    '2. Run: "' + chromePath + '" --remote-debugging-port=9222',
    "3. Log into your services normally",
    '4. Then run: employeeos browse <url> "<task>"'
  ].join("\n");
}
