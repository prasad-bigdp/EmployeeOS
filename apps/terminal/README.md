# EmployeeOS

**The Open Source Company Brain** — hire AI employees, get morning briefs, run real tool actions, and track your entire business from the terminal.

```bash
npm install -g employeeos
employeeos init
```

Full documentation: [github.com/prasad-bigdp/EmployeeOS](https://github.com/prasad-bigdp/EmployeeOS)

---

## Quick start

```bash
npm install -g employeeos

employeeos init          # 5-minute setup wizard
employeeos start         # run the hourly brain loop + open web UI at :3001
employeeos brief         # today's morning brief
employeeos think "why are conversions down?"
```

---

## AI providers

No API key required if you have a subscription:

| Provider | Auth |
|---|---|
| Anthropic Claude | API key |
| **Claude Code** (Max/Pro/Teams) | Browser OAuth — no API key |
| **OpenAI Codex** (ChatGPT Plus/Pro) | Browser OAuth — no API key |
| OpenAI | API key |
| OpenRouter | API key (400+ models) |
| Ollama | None (local, free) |

---

## Commands

```
employeeos init               Setup wizard
employeeos start              Run brain loop + web UI at http://localhost:3001
employeeos brief              Generate morning brief
employeeos think "question"   Ask the brain a strategic question
employeeos status             Health, goals, pending plans
employeeos plans              View all AI plans by status
employeeos employees          List AI employees

employeeos github             Connect GitHub (PAT)
employeeos connect [app]      Connect SaaS via Composio (Slack, Gmail, Notion, HubSpot...)
employeeos telegram           Connect Telegram alerts + plan approval
employeeos email              Configure email notifications + inbox reading
employeeos import <file.csv>  Import business metrics
employeeos browse <url>       Extract metrics from a live URL
employeeos mcp                Start MCP server for Claude Desktop
```

---

## What happens

Every hour, AI employees (CEO Assistant, Marketing, Sales, Support, Finance, HR) run in parallel and create structured action plans. Approved plans dispatch to real tools — GitHub issues, Slack messages, Gmail, Notion pages, and 250+ apps via Composio. Every execution is logged with step-level detail.

Plan statuses: `pending` → `approved` → `done` / `failed` / `blocked`

`blocked` means a step was stopped by the current autonomy level (not a crash) — raise autonomy to unlock.

---

## Web dashboard

`employeeos start` opens a React dashboard at `http://localhost:3001`:

- **Dashboard** — health score, goals, employees, recent activity
- **Morning Brief** — AI report with refresh button
- **Ask Brain** — strategic Q&A
- **AI Plans** — all plans grouped by status
- **Live Terminal** — real-time WebSocket brain log
- **Integrations** — GitHub, Composio, Telegram status

---

## Webhook receiver

```bash
POST http://localhost:3001/webhook/stripe
POST http://localhost:3001/webhook/hubspot
POST http://localhost:3001/webhook/github
```

Any JSON body. The brain processes the payload as an observation immediately. Critical events (payment failures, churn) trigger automatic high-priority plan generation.

---

## Data

Everything lives in `~/.employeeos/` — SQLite database, config, documents, skills. No external database. The only outbound connections are to your AI provider and Telegram (if configured).

---

MIT License · [github.com/prasad-bigdp/EmployeeOS](https://github.com/prasad-bigdp/EmployeeOS)
