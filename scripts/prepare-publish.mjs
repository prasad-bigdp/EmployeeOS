/**
 * Prepares and publishes the employeeos npm package.
 *
 * Run from repo root: node scripts/prepare-publish.mjs
 *
 * What it does:
 *   1. Builds the full monorepo (pnpm turbo build --force)
 *   2. Copies the web UI dist into apps/terminal/dist/web/
 *   3. Writes a publish-ready package.json (real npm deps, no workspace:*, no prepublishOnly)
 *   4. Runs npm publish --ignore-scripts (skips any hooks that would rebuild)
 *   5. Restores the original package.json
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TERMINAL_DIR = path.join(ROOT, "apps", "terminal");
const WEB_DIST = path.join(ROOT, "apps", "web", "dist");
const TERMINAL_DIST = path.join(TERMINAL_DIR, "dist");

function run(cmd, cwd = ROOT) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠  ${src} not found — skipping web UI copy`);
    return;
  }
  fs.cpSync(src, dest, { recursive: true });
  console.log(`  Copied ${src} → ${dest}`);
}

// All real npm deps that @employeeos/* workspace packages pull in.
// These become the published package's dependencies since all @employeeos/*
// packages are bundled inline by tsup (noExternal in tsup.config.ts).
const PUBLISH_DEPS = {
  "@anthropic-ai/sdk": "^0.39.0",
  "openai": "^6.44.0",
  "sql.js": "^1.12.0",
  "drizzle-orm": "^0.39.3",
  "fastify": "^5.3.3",
  "@fastify/cors": "^10.0.2",
  "@fastify/static": "^8.1.1",
  "@fastify/websocket": "^11.0.2",
  "grammy": "^1.36.0",
  "nodemailer": "^6.9.16",
  "imapflow": "^1.0.167",
  "playwright-core": "^1.50.0",
  "@modelcontextprotocol/sdk": "^1.12.0",
  "zod": "^3.24.1",
  "chalk": "^5.4.1",
  "commander": "^12.1.0",
  "inquirer": "^12.0.1",
  "ora": "^8.1.0",
  "papaparse": "^5.5.4",
  "pdf-parse": "^1.1.1",
  "pino": "^9.3.2",
  "@octokit/rest": "^21.0.2",
};

const PKG_PATH = path.join(TERMINAL_DIR, "package.json");
const PKG_BACKUP = path.join(TERMINAL_DIR, "package.json.bak");

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // 1. Build monorepo (produces 4.5 MB bundled dist/index.js with shebang)
  console.log("\n=== Step 1: Build ===");
  run("pnpm turbo build --force");

  // Verify the bundled binary was produced
  const distFile = path.join(TERMINAL_DIST, "index.js");
  const distSize = fs.statSync(distFile).size;
  console.log(`  dist/index.js: ${(distSize / 1024 / 1024).toFixed(1)} MB`);

  // Verify shebang is present
  const firstLine = fs.readFileSync(distFile, "utf-8").split("\n")[0];
  if (!firstLine.startsWith("#!/usr/bin/env node")) {
    throw new Error("dist/index.js is missing the shebang line! Check tsup.config.ts banner setting.");
  }
  console.log("  ✓ shebang present");

  // 2. Copy web UI into terminal dist
  console.log("\n=== Step 2: Copy web UI ===");
  const webDest = path.join(TERMINAL_DIST, "web");
  if (fs.existsSync(webDest)) fs.rmSync(webDest, { recursive: true });
  copyDir(WEB_DIST, webDest);

  // 3. Swap package.json for publish
  console.log("\n=== Step 3: Prepare package.json ===");
  const original = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"));
  fs.copyFileSync(PKG_PATH, PKG_BACKUP);

  const publishPkg = {
    ...original,
    dependencies: PUBLISH_DEPS,
    files: ["dist/**", "README.md"],
    scripts: {
      // Only keep start — no prepublishOnly so npm doesn't rebuild and overwrite
      // the 4.5 MB bundled dist/index.js with an unbundled version
      start: "node dist/index.js",
    },
  };
  delete publishPkg.devDependencies;

  fs.writeFileSync(PKG_PATH, JSON.stringify(publishPkg, null, 2) + "\n", "utf-8");
  console.log("  Wrote publish-ready package.json (prepublishOnly removed)");

  try {
    // 4. Publish — --ignore-scripts as a safety net so nothing rebuilds
    console.log("\n=== Step 4: Publish ===");
    if (dryRun) {
      console.log("  [dry run] Would run: npm publish --access public --ignore-scripts");
      run("npm publish --dry-run --access public --ignore-scripts", TERMINAL_DIR);
    } else {
      run("npm publish --access public --ignore-scripts", TERMINAL_DIR);
    }

    console.log("\n✓ Published!");
    console.log("  npm:    npm install -g employeeos");
    console.log("  GitHub: https://github.com/prasad-bigdp/EmployeeOS");
  } finally {
    // 5. Restore original package.json no matter what
    console.log("\n=== Step 5: Restore package.json ===");
    fs.copyFileSync(PKG_BACKUP, PKG_PATH);
    fs.unlinkSync(PKG_BACKUP);
    console.log("  Restored original package.json");
  }
}

main().catch(err => {
  console.error("\n✗ Publish failed:", err.message);
  if (fs.existsSync(PKG_BACKUP)) {
    fs.copyFileSync(PKG_BACKUP, PKG_PATH);
    fs.unlinkSync(PKG_BACKUP);
    console.error("  Restored original package.json");
  }
  process.exit(1);
});
