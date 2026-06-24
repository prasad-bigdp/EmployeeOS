# EmployeeOS

An open source "Company Brain" that runs in your terminal. You tell it about your company once, hire some AI employees, and it keeps watching, learning, and planning — every hour, every day, every week — without you having to ask.

Not a chatbot. Not a task runner. Something between a Chief of Staff and an always-on analyst.

---

## What actually happens

When you run `employeeos start`, three things happen in a loop:

**Every hour** — each AI employee you hired (Marketing, Sales, Support, Finance, HR) analyzes their domain using two parallel sub-agents: one that looks for problems, one that recommends the next action. If anything is worth doing, a plan gets created and queued for your approval.

**Every day** — a Morning Brief lands in your web dashboard (and Telegram, and email if you configured them). Health score gets updated.

**Every week** — an executive review summarizes what happened, what the patterns are, and what to focus on next.

Everything is stored locally in a SQLite database at `~/.employeeos/brain.db`. Nothing goes to any server except the AI provider you choose.

---

## Install

Three ways to run it — pick whichever works for you.

---

### Option 1: npm (easiest)

```bash
npm install -g employeeos
employeeos init
```

Node.js 20+ required. That's it.

---

### Option 2: Docker

No Node.js needed. Your data persists in `~/.employeeos` on your host machine.

```bash
# Pull and run
docker run -it \
  -p 3001:3001 \
  -v ~/.employeeos:/root/.employeeos \
  -e ANTHROPIC_API_KEY=your_key_here \
  ghcr.io/your-org/employeeos:latest \
  init
```

Or use docker-compose (recommended):

```bash
git clone https://github.com/your-org/employeeos
cd employeeos

# Set your AI key
echo "ANTHROPIC_API_KEY=your_key_here" > .env

# First-time setup (interactive)
docker compose run --rm employeeos init

# Start the brain
docker compose up -d

# Open http://localhost:3001
```

Interactive commands (`init`, `telegram`, `email`) need `-it`. The `start` command runs fine detached (`-d`).

---

### Option 3: Clone and build

Gives you the full source to modify.

```bash
# You need pnpm
npm install -g pnpm

git clone https://github.com/your-org/employeeos
cd employeeos
pnpm install
pnpm build
```

After building, the CLI is at `apps/terminal/dist/index.js`:

```bash
node apps/terminal/dist/index.js init
```

Or link it globally:

```bash
npm link apps/terminal
employeeos init
```

---

## Setup

Run `employeeos init` (or `node apps/terminal/dist/index.js init` before linking).

It asks you nine questions and takes about five minutes:

1. Company name, industry, one-sentence description
2. Whether you have multiple brands
3. Your name and email (for personalized briefs)
4. AI provider (see below)
5. Your top business goals
6. Which systems to connect (optional, you can skip)
7. Documents to read — strategy docs, business plans, anything (optional)
8. Which AI employees to hire
9. How autonomous the brain should be

At the end it generates your first intelligence report and saves everything.

---

## Choosing an AI provider

This is the only thing that costs money to run. Pick one:

**Anthropic (Claude)** — best quality, what we built and test with. Get a key at console.anthropic.com. About $2–5/month at normal usage.

**OpenAI (GPT-4o)** — works great, widely available. Get a key at platform.openai.com.

**OpenRouter** — one key, 400+ models. Great if you want to try different models or use something like Gemini or Llama. Get a key at openrouter.ai. Recommended model to start: `openai/gpt-4o-mini`.

**Ollama** — completely free and local. No API key. Runs on your machine. Install it from ollama.com, pull a model (`ollama pull llama3.2`), then select Ollama during setup. Quality is lower than cloud models but it costs nothing and never sends data anywhere.

If you have an `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` environment variable set, setup will detect it automatically and skip asking.

---

## Daily use

```
employeeos                      Dashboard: goals, health score, latest brief
employeeos start                Start the brain loop + open web UI
employeeos brief                Generate today's morning brief right now
employeeos think "question"     Ask the brain anything about your company
employeeos status               Health, goals, pending plans
employeeos plans                List AI-generated plans waiting for review
employeeos employees            See who you've hired and their roles
```

`employeeos start` opens `http://localhost:3001` with a full web dashboard — real-time terminal showing what the brain is doing, your morning brief, a chat interface, and your active plans.

---

## Import your existing data

The brain is more useful the sooner it has real data. You can dump your existing metrics into it with a CSV:

```bash
employeeos import
# Choose "Generate sample CSV template"
# Opens ~/.employeeos/sample-metrics.csv
# Fill in your actual numbers
employeeos import ~/.employeeos/sample-metrics.csv
```

The CSV has seven columns: `date, category, metric, value, unit, brand, notes`

Categories: `revenue`, `marketing`, `sales`, `support`, `hr`, `finance`, `operations`

You can also point it at a folder of PDFs, strategy docs, or plain text files:

```bash
employeeos import ~/Documents/company-reports/
```

Or have it open a dashboard URL and extract the numbers automatically (requires Chrome running with `--remote-debugging-port=9222`):

```bash
employeeos browse https://analytics.example.com/dashboard
```

---

## Notifications

### Telegram

```bash
employeeos telegram
```

1. Go to [@BotFather](https://t.me/BotFather) in Telegram and create a new bot (`/newbot`)
2. Copy the token it gives you
3. Paste it when prompted
4. Send `/start` to your new bot — the setup detects your chat ID automatically

Your bot will then send morning briefs, anomaly alerts, and plan notifications. When a plan needs approval, you get inline Approve / Reject buttons right in Telegram.

Bot commands you can use anytime:
- `/brief` — latest brief
- `/status` — health score, goals, active employees
- `/plans` — pending plans (with approve/reject buttons)
- `/ask your question here` — ask the brain from your phone

### Email

```bash
employeeos email
```

Works with Gmail (you'll need an App Password), Outlook, or any SMTP server. After connecting, you get the same briefs and alerts in your inbox.

For Gmail App Passwords: Google Account → Security → 2-Step Verification → App passwords.

---

## Custom Skills

Skills are Markdown files that teach your AI employees specific behaviors. Put them in `~/.employeeos/skills/` and they get loaded automatically when you start the brain.

To get started with examples:

```bash
employeeos skills --install-samples
```

This drops five sample skills into your skills folder. Open the folder to see them:

```bash
employeeos skills --open
```

Each skill file looks like this:

```markdown
---
name: competitor-watch
description: Flag competitor signals found in observations
roles: [marketing-manager, sales-manager]
---

When analyzing signals, actively look for competitor mentions.
If you find any, lead with: ⚠️ Competitor signal: [what you found]
Don't bury this in general analysis. Make it obvious.
```

The `roles` field controls which employees see the skill. Use `roles: [*]` to apply it to everyone.

Skills are plain text — no code, no configuration format to learn. Write what you want the AI to do, in plain English. That's it.

```bash
employeeos skills         # list loaded skills
employeeos skills --open  # open skills folder in file explorer
```

---

## Claude Desktop (MCP)

EmployeeOS has a built-in MCP server, so you can talk to your company brain from inside Claude Desktop.

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "employeeos": {
      "command": "node",
      "args": ["path/to/employeeos/apps/terminal/dist/index.js", "mcp"]
    }
  }
}
```

Available tools from inside Claude: `think`, `get_brief`, `get_status`, `import_metric`, `search_knowledge`, `get_plans`

---

## Web Dashboard

`employeeos start` serves a dashboard at `http://localhost:3001`:

- **Dashboard** — health score, active goals with progress bars, AI employees
- **Morning Brief** — today's report, refresh button
- **Ask Brain** — chat interface with full company context
- **AI Plans** — list of plans created by your employees
- **Live Terminal** — real-time stream of what the brain is doing
- **Integrations** — Telegram status, employee list

---

## Architecture

It's a pnpm monorepo with turborepo. The packages are loosely coupled — you could use just the AI provider, just the database, just the observer, etc.

```
apps/
  terminal/   The CLI and main entry point (employeeos binary)
  gateway/    Fastify server: REST API + WebSocket + serves the web UI
  web/        React + Vite dashboard (xterm.js live terminal)

packages/
  ai/         Provider abstraction for Anthropic, OpenAI, OpenRouter, Ollama
  brain/      The main loop: hourly/daily/weekly ticks, parallel employees
  database/   SQLite via sql.js (pure WASM, no native deps), Drizzle ORM
  observer/   Signal detection and anomaly detection
  learner/    Pattern extraction and knowledge promotion
  planner/    Opportunity ranking and plan generation
  reporter/   Morning briefs, weekly reviews, health scoring, Q&A
  employees/  AI employee role definitions
  skills/     Markdown-based skill system
  email/      Email notifications (nodemailer)
  telegram/   grammy bot, plan approval buttons
  mcp/        MCP server for Claude Desktop
  browser/    Playwright browser automation
  shared/     Types and constants used across packages
```

---

## Your data

Everything lives in `~/.employeeos/`:

```
~/.employeeos/
  config.json       Your config — AI keys, company ID, notification settings
  brain.db          SQLite database — companies, goals, plans, learnings, reports
  docs/             Indexed documents you've uploaded
  skills/           Your custom skill Markdown files
  sample-metrics.csv  CSV template (generated on first import)
```

The only outbound connections are to your AI provider's API (Anthropic, OpenAI, etc.) and to Telegram's API if you've connected a bot. Nothing else.

---

## Roadmap

Things we're planning to add:

- WhatsApp integration
- Slack notifications
- Email digest (Gmail / Outlook) read-back, not just send
- Google Analytics direct import
- HubSpot and Zoho CRM connectors
- Skills marketplace (community skill files)
- Desktop app (Tauri)
- Team / multi-user support

---

## Contributing

PRs welcome. The codebase is TypeScript throughout. Each package has its own `build` and `typecheck` scripts. Run `pnpm turbo build` from root to build everything.

The packages are designed to be independent — if you want to build something on top of just the brain loop, or just the database layer, you can do that without pulling in the full CLI.

---

## Publishing a new version (maintainers)

```bash
# Dry run first — checks what would be published
pnpm publish:npm:dry

# Actual publish
pnpm publish:npm
```

The publish script (`scripts/prepare-publish.mjs`) does this automatically:
1. Builds everything with `pnpm turbo build`
2. Copies the web UI into `apps/terminal/dist/web/` so the dashboard is bundled
3. Swaps `package.json` to use real npm dep versions (not `workspace:*`)
4. Runs `npm publish`
5. Restores the original `package.json`

All internal `@employeeos/*` packages get bundled into a single `dist/index.js` (~4.5 MB). Users don't need to install any of them separately.

**Building the Docker image:**

```bash
docker build -t employeeos:latest .
docker tag employeeos:latest ghcr.io/your-org/employeeos:latest
docker push ghcr.io/your-org/employeeos:latest
```

---

## License

MIT
