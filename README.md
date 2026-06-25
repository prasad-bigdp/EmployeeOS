# EmployeeOS

An open source "Company Brain" that runs in your terminal. You tell it about your company once, hire some AI employees, and it keeps watching, learning, and planning — every hour, every day, every week — without you having to ask.

Not a chatbot. Not a task runner. Something between a Chief of Staff and an always-on analyst.

---

## What actually happens

When you run `employeeos start`, three things happen in a loop:

**Every hour** — each AI employee you hired (Marketing, Sales, Support, Finance, HR) analyzes their domain using two parallel sub-agents: one that scans for problems, one that recommends the next action. If anything is worth doing, a plan is created and queued for your approval. Approved plans get executed, and the outcome gets recorded as a learning that feeds future decisions. New emails in your inbox (if IMAP is configured) are scanned and turned into business signals automatically.

**Every day** — a Morning Brief lands in your web dashboard and Telegram (and email, if configured). Health score gets updated. The brief is cached — you always see today's, and every surface (terminal, Telegram, MCP, gateway) shows the same one.

**Every week** — an executive review summarizes what happened, what the patterns are, and what to focus on next.

Everything is stored locally in a SQLite database at `~/.employeeos/brain.db`. Nothing goes to any server except the AI provider you choose.

---

## The decision loop

Plans follow a full lifecycle you can trace:

```
observation → plan (pending) → approved → executed → learning
                                       ↘ failed    → logged
```

Every step is written to an events table. The web dashboard, Telegram, and MCP server all read from the same event history — nothing is synthesized from current state.

---

## Install

Three ways to run it — pick whichever works for you.

### Option 1: npm (easiest)

```bash
npm install -g employeeos
employeeos init
```

Node.js 20+ required. That's it.

### Option 2: Docker

No Node.js needed. Your data persists in `~/.employeeos` on your host machine.

```bash
docker run -it \
  -p 3001:3001 \
  -v ~/.employeeos:/root/.employeeos \
  -e ANTHROPIC_API_KEY=your_key_here \
  ghcr.io/prasad-bigdp/employeeos:latest \
  init
```

Or use docker-compose (recommended):

```bash
git clone https://github.com/prasad-bigdp/EmployeeOS
cd employeeos
echo "ANTHROPIC_API_KEY=your_key_here" > .env

# First-time setup (interactive)
docker compose run --rm employeeos init

# Start the brain
docker compose up -d
# Open http://localhost:3001
```

Interactive commands (`init`, `telegram`, `email`) need `-it`. The `start` command runs fine detached (`-d`).

### Option 3: Clone and build

```bash
npm install -g pnpm
git clone https://github.com/prasad-bigdp/EmployeeOS
cd employeeos
pnpm install
pnpm build
```

After building:

```bash
node apps/terminal/dist/index.js init
# or link globally:
npm link apps/terminal
employeeos init
```

---

## Setup

Run `employeeos init` — it asks you nine questions and takes about five minutes:

1. Company name, industry, one-sentence description
2. Whether you have multiple brands
3. Your name and email (for personalized briefs)
4. AI provider (see below)
5. Your top business goals
6. Which systems to connect (optional)
7. Documents to read — strategy docs, business plans, anything (optional)
8. Which AI employees to hire
9. How autonomous the brain should be

At the end it generates your first intelligence report and saves everything.

---

## Choosing an AI provider

**Anthropic (Claude)** — best quality, what we build and test with. Get a key at console.anthropic.com. About $2–5/month at normal usage.

**OpenAI (GPT-4o)** — works great, widely available. Get a key at platform.openai.com.

**OpenRouter** — one key, 400+ models. Great if you want to try different models. Get a key at openrouter.ai. Recommended starting model: `openai/gpt-4o-mini`.

**Ollama** — completely free and local. No API key. Runs on your machine. Install from ollama.com, pull a model (`ollama pull llama3.2`), then select Ollama during setup. Quality is lower than cloud models but costs nothing.

If you have `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` set in your environment, setup will detect it automatically.

---

## Daily use

```
employeeos                      Dashboard: goals, health score, latest brief
employeeos start                Start the brain loop + open web UI at :3001
employeeos brief                Generate today's morning brief right now
employeeos think "question"     Ask the brain anything about your company
employeeos status               Health, goals, pending plans
employeeos plans                List AI-generated plans waiting for review
employeeos employees            See who you've hired and their roles
employeeos import <file>        Import metrics from CSV, JSON, or PDF
employeeos browse <url>         Extract metrics from a live dashboard URL
employeeos github               Connect GitHub (PAT) for issue/PR actions
employeeos connect [app]        Connect SaaS apps via Composio (Slack, Gmail, Notion...)
employeeos email                Set up email notifications + inbox reading
employeeos telegram             Connect Telegram for alerts and plan approval
employeeos skills               Manage custom employee skills
employeeos mcp                  Start the MCP server for Claude Desktop
```

`employeeos start` opens `http://localhost:3001` with a full web dashboard — real-time terminal showing what the brain is doing, your morning brief, a chat interface, active plans, and your full event history.

---

## Getting data in

The brain is more useful the sooner it has real data. There are four ways to feed it:

### CSV import

```bash
employeeos import
# Choose "Generate sample CSV template"
# Fill it in, then:
employeeos import ~/.employeeos/sample-metrics.csv
```

The CSV has seven columns: `date, category, metric, value, unit, brand, notes`

Categories: `revenue`, `marketing`, `sales`, `support`, `hr`, `finance`, `operations`

### PDF import

Drop in any business document — reports, audits, strategy decks, contracts — and the brain extracts business signals with AI:

```bash
employeeos import quarterly-review.pdf
employeeos import ~/Downloads/market-research.pdf
```

The AI reads the document and pulls out concrete signals (revenue figures, headcount changes, market shifts, competitive mentions) and saves each one as a separate observation. Every signal shows up in your event history.

### Browser automation

Have the brain open a live dashboard URL and extract the numbers automatically (requires Chrome running with `--remote-debugging-port=9222`):

```bash
employeeos browse https://analytics.example.com/dashboard
employeeos browse https://app.hubspot.com/contacts/deals "extract pipeline metrics"
```

### Webhook receiver

Any external tool can POST directly to your running gateway and the payload becomes an observation immediately — no polling needed:

```
POST http://localhost:3001/webhook/stripe
POST http://localhost:3001/webhook/hubspot
POST http://localhost:3001/webhook/github
POST http://localhost:3001/webhook/shopify
```

The source name (`stripe`, `hubspot`, etc.) is auto-mapped to a signal category. Any JSON body is accepted. Use this from Zapier, n8n, GitHub Actions, or any platform that supports webhooks.

```bash
# Example: Stripe payment failure becomes a finance observation
curl -X POST http://localhost:3001/webhook/stripe \
  -H "Content-Type: application/json" \
  -d '{"type":"payment_intent.payment_failed","amount":4900,"customer":"cus_abc"}'
```

---

## Notifications

### Telegram

```bash
employeeos telegram
```

1. Go to [@BotFather](https://t.me/BotFather) and create a bot (`/newbot`)
2. Copy the token it gives you
3. Paste it when prompted — setup detects your chat ID automatically

Your bot will send morning briefs, anomaly alerts, and plan notifications. When a plan needs approval you get inline **Approve / Reject** buttons right in Telegram. Approvals and rejections are written to the event history immediately.

Bot commands:
- `/brief` — today's morning brief (cached, instant)
- `/status` — health score, goals, active employees
- `/plans` — pending plans with approve/reject buttons
- `/ask your question here` — ask the brain from your phone

### Email (send + inbox reading)

```bash
employeeos email
```

**Outbound (SMTP):** morning briefs, anomaly alerts, and plan notifications. Works with Gmail (App Password), Outlook, or any SMTP server.

For Gmail App Passwords: Google Account → Security → 2-Step Verification → App passwords.

**Inbound (IMAP):** after setting up SMTP, you're asked if you also want to read your inbox. If you say yes, the brain connects to your mailbox every hour and extracts business signals from incoming emails — customer inquiries, deal updates, support escalations, partner messages. Only genuine human communication is extracted; newsletters and automated alerts are skipped.

The brain remembers which emails it has already processed (checkpoint stored in the database) so the same email is never imported twice.

---

## How plans work

The brain creates plans when employees identify opportunities. Each plan has:

- **Employee role** — which AI employee created it
- **Autonomy level** — `observe` / `recommend` / `execute` / `autonomous`
- **Status** — `pending` → `approved` → `done` or `failed`

Plans that require approval wait in the queue. You can approve or reject from:
- The web dashboard
- Telegram inline buttons
- The terminal (`employeeos plans`)

When a plan is executed, the brain:
1. Creates an **execution record** (stored in the database even on failure)
2. **Dispatches each step to the correct tool runner** — GitHub native, Composio SaaS, or AI text fallback
3. Tracks every step separately (`execution_steps` table: started → done/failed)
4. Extracts a **learning** from the outcome (subject + pattern + confidence)
5. Links the learning back to the execution record so every pattern is traceable
6. Writes step-level events to the history: `step.started`, `step.completed`, `step.failed`

Failed plans show with a red badge in the dashboard and appear in the event feed — nothing is silently dropped.

---

## Real integrations

EmployeeOS v1.1 can execute real actions, not just generate text. Plans with structured steps call live APIs:

### GitHub (native)

```bash
employeeos github
```

Connect a Personal Access Token and EmployeeOS can:
- Create issues automatically from anomaly observations
- Comment on PRs with execution summaries
- Open pull requests as plan steps
- Add labels and close issues
- Read open issue/PR counts as business signals

Operations: `create_issue`, `comment_on_issue`, `create_pr`, `label_issue`, `close_issue`, `get_repo_health`

### Composio (250+ SaaS apps)

```bash
employeeos connect
employeeos connect slack
employeeos connect gmail
```

Composio is the connector layer for non-core SaaS. One API key, OAuth-managed connections, 250+ apps:

| App | What EmployeeOS can do |
|-----|------------------------|
| Slack | Send messages to channels |
| Gmail | Send emails, read inbox |
| Notion | Create pages, search |
| HubSpot | Create deals, add contacts |
| Stripe | Read balance, list customers |

Get a free Composio API key at composio.dev. Run `employeeos connect <app>` for each app you want to authorize.

### How structured plans work

When the planner creates a plan with tool steps, each step looks like:

```json
{
  "tool": "github",
  "operation": "create_issue",
  "input": { "title": "Anomaly: revenue dropped 23%", "labels": ["urgent"] },
  "expectedOutcome": "Issue opened for team review"
}
```

The executor routes it to the right runner (native GitHub or Composio), executes the call, and records the result in `execution_steps`. If a step fails, the plan is marked `failed` and the error is logged — other steps in the same plan continue.

### Permission levels

The `autonomyRequired` field on each plan controls what the executor will run automatically:
- `observe` — never execute write actions automatically (read-only safe)
- `recommend` — execute safe reads; write actions need approval
- `execute` — run all steps for approved plans
- `autonomous` — run all steps without per-plan approval

---

## Custom Skills

Skills are Markdown files that teach your AI employees specific behaviors. Put them in `~/.employeeos/skills/` and they get loaded automatically.

```bash
employeeos skills --install-samples   # install 5 example skills
employeeos skills --list              # see what's loaded
employeeos skills --open              # open the skills folder
```

A skill file looks like this:

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

The `roles` field controls which employees see the skill. Use `roles: [*]` to apply to everyone. Skills are plain English — no code, no configuration syntax to learn.

Five sample skills are included:
- `okr-weekly-format` — structures reviews as OKR snapshots
- `competitor-watch` — surfaces competitor signals in analysis
- `anomaly-escalation` — adds urgency markers for critical anomalies
- `standup-format` — formats daily briefs as async standups
- `finance-burn-alert` — flags runway and burn rate red lines

---

## Claude Desktop (MCP)

EmployeeOS has a built-in MCP server so you can talk to your company brain from inside Claude Desktop.

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

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

Or if installed via npm:

```json
{
  "mcpServers": {
    "employeeos": {
      "command": "employeeos",
      "args": ["mcp"]
    }
  }
}
```

Available tools from inside Claude: `think`, `get_brief`, `get_status`, `import_metric`, `search_knowledge`, `get_plans`

---

## Web Dashboard

`employeeos start` serves a dashboard at `http://localhost:3001`:

- **Dashboard** — health score (0–100), active goals with progress bars, AI employees
- **Morning Brief** — today's cached report, force-refresh button
- **Ask Brain** — chat interface with full company context
- **AI Plans** — all plans with status badges (`pending`, `approved`, `done`, `failed`, `rejected`)
- **Event History** — full audit trail read directly from the events table: every plan created, approved, rejected, executed, or failed; every learning extracted; every report generated; every webhook or email signal ingested
- **Live Terminal** — real-time stream of what the brain is doing this tick

---

## Architecture

pnpm monorepo with turborepo. Packages are loosely coupled — use just the brain loop, just the database layer, or everything together.

```
apps/
  terminal/   CLI and main entry point (employeeos binary)
  gateway/    Fastify server — REST API + WebSocket + webhook receiver + web UI
  web/        React + Vite dashboard

packages/
  ai/         Provider abstraction: Anthropic, OpenAI, OpenRouter, Ollama
  brain/      Main loop: hourly/daily/weekly ticks, parallel employee agents
  database/   SQLite via sql.js (pure WASM, no native deps), Drizzle ORM
  observer/   Signal detection and anomaly analysis
  learner/    Pattern extraction, knowledge promotion, learning-to-execution links
  executor/   Tool runner dispatch: GitHub native, Composio, AI fallback
  planner/    Opportunity ranking and plan composition
  reporter/   Brief service (getOrGenerateBrief), weekly reviews, health scoring
  github/     Native GitHub integration via @octokit/rest (PAT auth)
  composio/   Composio HTTP adapter — 250+ SaaS apps via one API key
  plugins/    Tool capability registry with provider metadata
  employees/  AI employee role definitions
  skills/     Markdown-based skill system
  email/      SMTP notifications + IMAP inbox reading (imapflow)
  telegram/   grammy bot, plan approval buttons, event emission on approve/reject
  mcp/        MCP server for Claude Desktop
  browser/    Playwright browser automation and metric extraction
  events/     Shared event type definitions
  shared/     Types and constants (PlanStep, ToolName, AppConfig)
```

**Database tables:** `companies`, `brands`, `goals`, `employees`, `integrations`, `observations`, `learnings`, `plans`, `executions`, `execution_steps`, `reports`, `health_scores`, `knowledge`, `documents`, `events`, `settings`, `tool_connections`

The `executions` table links every plan to its outcome. The `execution_steps` table tracks each tool call within an execution: `executionId → tool → operation → status → result → error`. Every step emits `step.started`, `step.completed`, or `step.failed` events. Every learning can be traced back to a step, execution, and plan.

---

## Your data

Everything lives in `~/.employeeos/`:

```
~/.employeeos/
  config.json          AI keys, company ID, SMTP/IMAP/Telegram settings
  brain.db             SQLite — all company data, plans, learnings, events
  docs/                Indexed documents you've uploaded
  skills/              Your custom skill Markdown files
  sample-metrics.csv   CSV template (generated on first import)
```

The only outbound connections are to your AI provider's API and Telegram's API if you've connected a bot. Nothing else.

---

## Roadmap

- GitHub App installation tokens (currently PAT only)
- Slack reading — scan team channels for business signals (Composio)
- Google Calendar — read upcoming meetings, add context to morning brief
- Google Analytics import
- Skills marketplace — community skill files
- Desktop app (Tauri)
- Team / multi-user support
- Plan step retry and partial re-execution
- Audit log UI with step-level drill-down

---

## Contributing

PRs welcome. TypeScript throughout. Each package has its own `build` and `typecheck` scripts.

```bash
pnpm turbo build        # build everything
pnpm turbo typecheck    # type-check everything
```

The packages are designed to be independent — if you want to build on just the brain loop or just the database layer, you can without pulling in the full CLI.

---

## Publishing (maintainers)

```bash
pnpm publish:npm:dry    # dry run — checks what would be published
pnpm publish:npm        # actual publish
```

The publish script (`scripts/prepare-publish.mjs`):
1. Builds everything with `pnpm turbo build`
2. Copies the web UI into `apps/terminal/dist/web/`
3. Swaps `package.json` to use real npm dep versions (not `workspace:*`)
4. Runs `npm publish`
5. Restores the original `package.json`

All internal `@employeeos/*` packages get bundled into a single `dist/index.js`. Users install one package and get everything.

---

## License

MIT
