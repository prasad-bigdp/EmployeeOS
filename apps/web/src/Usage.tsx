import { useState, useEffect } from "react";
import { apiFetch } from "./api";

interface RoleUsage {
  role: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  estimatedCostUsd: number;
}

interface UsageData {
  days: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  byRole: RoleUsage[];
}

const ROLE_EMOJI: Record<string, string> = {
  "ceo-assistant": "🧠",
  "marketing-manager": "📣",
  "sales-manager": "📈",
  "support-manager": "💬",
  "finance-manager": "💰",
  "hr-manager": "👥",
};

export default function Usage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [interval, setInterval_] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<UsageData>(`/usage?days=${days}`),
      apiFetch<{ intervalMinutes: number }>("/cron"),
    ])
      .then(([u, c]) => {
        setData(u);
        setInterval_(c.intervalMinutes);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  const saveInterval = async (mins: number) => {
    setSaving(true);
    try {
      await apiFetch("/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalMinutes: mins }),
      });
      setInterval_(mins);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const maxCost = data ? Math.max(...data.byRole.map(r => r.estimatedCostUsd), 0.0001) : 1;

  if (loading) return <div className="loading">Loading usage data...</div>;
  if (error) return <div className="error-box">{error}</div>;

  return (
    <div>
      {/* Brain loop interval */}
      <div className="card section">
        <div className="card-title">Brain Loop Schedule</div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 12 }}>
          How often the brain ticks — runs all AI employees, generates plans, detects anomalies.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[15, 30, 60, 120, 240].map(mins => (
            <button
              key={mins}
              onClick={() => saveInterval(mins)}
              disabled={saving}
              className={`badge ${interval === mins ? "badge-green" : "badge-gray"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 13, padding: "4px 10px" }}
            >
              {mins < 60 ? `${mins}m` : `${mins / 60}h`}
              {interval === mins ? " ✓" : ""}
            </button>
          ))}
        </div>
        {interval && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
            Current: every {interval < 60 ? `${interval} minutes` : `${interval / 60} hour${interval > 60 ? "s" : ""}`}
            {" · "}Restart brain loop to apply changes
          </div>
        )}
      </div>

      {/* Token summary */}
      <div className="card section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Token Usage</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[7, 30, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`badge ${days === d ? "badge-blue" : "badge-gray"}`}
                style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
          <div style={{ padding: "12px 16px", background: "var(--surface2)", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>INPUT TOKENS</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(data?.totalInputTokens ?? 0)}</div>
          </div>
          <div style={{ padding: "12px 16px", background: "var(--surface2)", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>OUTPUT TOKENS</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(data?.totalOutputTokens ?? 0)}</div>
          </div>
          <div style={{ padding: "12px 16px", background: "var(--surface2)", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>EST. COST (USD)</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>${data?.estimatedCostUsd.toFixed(4) ?? "0.0000"}</div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 16 }}>
          Estimated using Claude Sonnet pricing ($3/M input · $15/M output). Token counts are approximate (4 chars ≈ 1 token).
        </div>
      </div>

      {/* Per-employee breakdown */}
      <div className="card section">
        <div className="card-title">Usage by Employee</div>
        {!data?.byRole.length ? (
          <div className="empty">No usage data yet. Start the brain loop to generate activity.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.byRole
              .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
              .map(r => (
                <div key={r.role}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>{ROLE_EMOJI[r.role] ?? "🤖"}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{r.role}</span>
                    <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{r.calls} calls</span>
                    <span style={{ fontSize: 13, fontWeight: 600, minWidth: 70, textAlign: "right" }}>
                      ${r.estimatedCostUsd.toFixed(4)}
                    </span>
                  </div>
                  <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--surface2)" }}>
                    <div
                      style={{
                        width: `${(r.estimatedCostUsd / maxCost) * 100}%`,
                        background: "var(--accent)",
                        borderRadius: 3,
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 3, fontSize: 11, color: "var(--text-muted)" }}>
                    <span>in: {fmt(r.inputTokens)}</span>
                    <span>out: {fmt(r.outputTokens)}</span>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
