import { useState, useEffect } from "react";
import { apiFetch } from "./api";

interface TelegramStatus { connected: boolean; chatId?: string; }
interface AgentStatus { employees: { name: string; role: string; emoji: string }[] }

export default function Settings() {
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [agents, setAgents] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<TelegramStatus>("/telegram/status").catch(() => ({ connected: false })),
      apiFetch<{ employees: AgentStatus["employees"] }>("/employees")
        .then(r => ({ employees: Array.isArray(r) ? r : [] }))
        .catch(() => ({ employees: [] }))
    ]).then(([t, a]) => {
      setTg(t);
      setAgents(a);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading settings...</div>;

  return (
    <div>
      {/* Telegram */}
      <div className="card section">
        <div className="card-title">Telegram Integration</div>
        <div className="row" style={{ paddingTop: 0 }}>
          <span style={{ fontSize: 24 }}>✈</span>
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

      {/* AI Employees / Sub-agents */}
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
        <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface2)", borderRadius: 6, fontSize: 12, color: "var(--text-muted)" }}>
          Sub-agents run in parallel using <code style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>spawnParallelAgents()</code> —
          no extra cost, just concurrent AI calls within your existing provider.
        </div>
      </div>

      {/* Multi-agent architecture explanation */}
      <div className="card">
        <div className="card-title">How Multi-Agent Works</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: "var(--text-dim)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span className="badge badge-purple">1</span>
            <span><strong style={{ color: "var(--text)" }}>Observe</strong> — Brain detects signals and anomalies across all data</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span className="badge badge-purple">2</span>
            <span><strong style={{ color: "var(--text)" }}>Parallel Employees</strong> — All hired employees run simultaneously, each in their domain</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span className="badge badge-purple">3</span>
            <span><strong style={{ color: "var(--text)" }}>Sub-agents</strong> — Each employee spawns 2 sub-agents: an analyst + a strategist</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span className="badge badge-purple">4</span>
            <span><strong style={{ color: "var(--text)" }}>Plan</strong> — Insights are synthesized into actionable plans stored in the brain</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span className="badge badge-purple">5</span>
            <span><strong style={{ color: "var(--text)" }}>Notify</strong> — You get alerts via web UI, Telegram, and the live terminal</span>
          </div>
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
