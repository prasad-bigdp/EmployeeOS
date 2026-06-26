import { useState, useEffect } from "react";
import { apiFetch, getIntegrations } from "./api";
import type { IntegrationsRow } from "./api";

interface TelegramStatus { connected: boolean; chatId?: string; }
interface DiscordStatus { connected: boolean; channelId?: string | null; guildId?: string | null; }
interface WhatsAppStatus { connected: boolean; phoneNumber?: string | null; }
interface AgentStatus { employees: { name: string; role: string; emoji: string }[] }

export default function Settings() {
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [discord, setDiscord] = useState<DiscordStatus | null>(null);
  const [whatsapp, setWhatsApp] = useState<WhatsAppStatus | null>(null);
  const [agents, setAgents] = useState<AgentStatus | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<TelegramStatus>("/telegram/status").catch(() => ({ connected: false })),
      apiFetch<DiscordStatus>("/discord/status").catch(() => ({ connected: false })),
      apiFetch<WhatsAppStatus>("/whatsapp/status").catch(() => ({ connected: false })),
      apiFetch<{ employees: AgentStatus["employees"] }>("/employees")
        .then(r => ({ employees: Array.isArray(r) ? r : [] }))
        .catch(() => ({ employees: [] })),
      getIntegrations().catch(() => null),
    ]).then(([t, d, w, a, i]) => {
      setTg(t);
      setDiscord(d);
      setWhatsApp(w);
      setAgents(a);
      setIntegrations(i);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading settings...</div>;

  const gh = integrations?.github;
  const composio = integrations?.composio;
  const connectedApps = composio?.apps.filter(a => a.status === "connected") ?? [];
  const pendingApps = composio?.apps.filter(a => a.status === "pending_auth") ?? [];

  return (
    <div>
      {/* GitHub */}
      <div className="card section">
        <div className="card-title">GitHub Integration</div>
        <div className="row" style={{ paddingTop: 0 }}>
          <span style={{ fontSize: 22 }}>⎇</span>
          <div className="row-main">
            <div className="row-title">
              {gh?.connected ? `${gh.owner ?? ""}/${gh.repo ?? ""}` : "Not connected"}
            </div>
            <div className="row-sub">
              {gh?.connected
                ? "Creates issues, PRs, labels, and comments automatically from AI plans"
                : "Connect to let the brain manage your GitHub repos from action plans"}
            </div>
          </div>
          <span className={`badge ${gh?.connected ? "badge-green" : "badge-gray"}`}>
            {gh?.status ?? "disconnected"}
          </span>
        </div>
        {!gh?.connected && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface2)", borderRadius: 6, fontSize: 13, color: "var(--text-dim)" }}>
            Run <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>employeeos github</code> in your terminal to connect GitHub.
          </div>
        )}
      </div>

      {/* Composio */}
      <div className="card section">
        <div className="card-title">SaaS Integrations via Composio</div>
        <div className="row" style={{ paddingTop: 0 }}>
          <span style={{ fontSize: 22 }}>⬡</span>
          <div className="row-main">
            <div className="row-title">
              {composio?.keyConfigured
                ? `API key configured · ${connectedApps.length} app${connectedApps.length !== 1 ? "s" : ""} connected`
                : "Not configured"}
            </div>
            <div className="row-sub">
              Slack, Gmail, Notion, HubSpot, Stripe and 250+ other apps
            </div>
          </div>
          <span className={`badge ${connectedApps.length > 0 ? "badge-green" : composio?.keyConfigured ? "badge-yellow" : "badge-gray"}`}>
            {connectedApps.length > 0 ? "active" : composio?.keyConfigured ? "key only" : "disconnected"}
          </span>
        </div>

        {(connectedApps.length > 0 || pendingApps.length > 0) && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {connectedApps.map(a => (
              <div key={a.app} className="row" style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                <span className="badge badge-green">connected</span>
                <div className="row-main">
                  <div className="row-title" style={{ fontSize: 13 }}>{a.app}</div>
                  {a.connectedAt && (
                    <div className="row-sub" style={{ fontSize: 11 }}>
                      since {new Date(a.connectedAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {pendingApps.map(a => (
              <div key={a.app} className="row" style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                <span className="badge badge-yellow">pending auth</span>
                <div className="row-main">
                  <div className="row-title" style={{ fontSize: 13 }}>{a.app}</div>
                  <div className="row-sub" style={{ fontSize: 11 }}>Complete OAuth in browser to activate</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!composio?.keyConfigured && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface2)", borderRadius: 6, fontSize: 13, color: "var(--text-dim)" }}>
            Run <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>employeeos connect</code> in your terminal to connect SaaS apps.
          </div>
        )}
      </div>

      {/* Telegram */}
      <div className="card section">
        <div className="card-title">Telegram Integration</div>
        <div className="row" style={{ paddingTop: 0 }}>
          <span style={{ fontSize: 22 }}>✈</span>
          <div className="row-main">
            <div className="row-title">
              {tg?.connected ? "Connected" : "Not connected"}
            </div>
            <div className="row-sub">
              {tg?.connected
                ? `Chat ID: ${tg.chatId} — brain sends you briefs, plan alerts, and anomaly notifications`
                : "Connect to get morning briefs, plan approvals, and brain alerts on your phone"}
            </div>
          </div>
          <span className={`badge ${tg?.connected ? "badge-green" : "badge-gray"}`}>
            {tg?.connected ? "active" : "disconnected"}
          </span>
        </div>
        {!tg?.connected && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface2)", borderRadius: 6, fontSize: 13, color: "var(--text-dim)" }}>
            Run <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>employeeos telegram</code> in your terminal to connect Telegram.
          </div>
        )}
      </div>

      {/* Discord */}
      <div className="card section">
        <div className="card-title">Discord Integration</div>
        <div className="row" style={{ paddingTop: 0 }}>
          <span style={{ fontSize: 22 }}>◈</span>
          <div className="row-main">
            <div className="row-title">{discord?.connected ? `Channel: ${discord.channelId}` : "Not connected"}</div>
            <div className="row-sub">
              {discord?.connected
                ? "Brain posts alerts and plans in your Discord channel"
                : "Get brain alerts in Discord — slash commands: /brief /status /plans /ask"}
            </div>
          </div>
          <span className={`badge ${discord?.connected ? "badge-green" : "badge-gray"}`}>
            {discord?.connected ? "active" : "disconnected"}
          </span>
        </div>
        {!discord?.connected && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface2)", borderRadius: 6, fontSize: 13, color: "var(--text-dim)" }}>
            Run <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>employeeos discord</code> to connect Discord.
          </div>
        )}
      </div>

      {/* WhatsApp */}
      <div className="card section">
        <div className="card-title">WhatsApp Integration</div>
        <div className="row" style={{ paddingTop: 0 }}>
          <span style={{ fontSize: 22 }}>✆</span>
          <div className="row-main">
            <div className="row-title">{whatsapp?.connected ? `Phone: ${whatsapp.phoneNumber}` : "Not connected"}</div>
            <div className="row-sub">
              {whatsapp?.connected
                ? "Brain sends alerts to WhatsApp — commands: !brief !status !plans !ask"
                : "Get brain alerts on WhatsApp — requires Chrome for QR scan auth"}
            </div>
          </div>
          <span className={`badge ${whatsapp?.connected ? "badge-green" : "badge-gray"}`}>
            {whatsapp?.connected ? "active" : "disconnected"}
          </span>
        </div>
        {!whatsapp?.connected && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface2)", borderRadius: 6, fontSize: 13, color: "var(--text-dim)" }}>
            Run <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>employeeos whatsapp</code> to connect WhatsApp.
          </div>
        )}
      </div>

      {/* AI Employees */}
      <div className="card section">
        <div className="card-title">AI Employees & Sub-Agents</div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 12 }}>
          Each employee runs its own parallel analysis loop, spawning 2 specialist sub-agents per tick.
          Together they cover your entire business in every hourly cycle.
        </div>
        {agents?.employees.length === 0 ? (
          <div className="empty">No employees hired yet. Run <code style={{ color: "var(--accent)" }}>employeeos init</code> to hire employees.</div>
        ) : (
          agents?.employees.map(emp => (
            <div key={emp.role} className="row">
              <span style={{ fontSize: 20, width: 28 }}>{emp.emoji || roleIcon(emp.role)}</span>
              <div className="row-main">
                <div className="row-title">{emp.name}</div>
                <div className="row-sub">{emp.role} · spawns 2 sub-agents per tick</div>
              </div>
              <span className="badge badge-green">active</span>
            </div>
          ))
        )}
      </div>

      {/* How multi-agent works */}
      <div className="card">
        <div className="card-title">How the Brain Loop Works</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: "var(--text-dim)" }}>
          {[
            ["Observe", "Brain detects signals and anomalies across all connected data sources"],
            ["Parallel Employees", "All hired employees run simultaneously, each in their domain"],
            ["Sub-agents", "Each employee spawns 2 sub-agents: an analyst + a strategist"],
            ["Plan", "Insights are synthesized into actionable PlanStep[] objects with real tool calls"],
            ["Execute", "Approved plans dispatch to GitHub, Slack, Gmail, Notion, browser, and more"],
            ["Notify", "You get alerts via web UI, Telegram, and the live terminal"],
          ].map(([title, desc], i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span className="badge badge-purple">{i + 1}</span>
              <span><strong style={{ color: "var(--text)" }}>{title}</strong> — {desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function roleIcon(role: string) {
  const icons: Record<string, string> = {
    "ceo-assistant": "🧠",
    "marketing-manager": "📣",
    "sales-manager": "📈",
    "support-manager": "💬",
    "finance-manager": "💰",
    "hr-manager": "👥",
  };
  return icons[role] ?? "🤖";
}
