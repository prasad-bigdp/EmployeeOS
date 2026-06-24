import { useState, useEffect } from "react";
import { getHealthScore, getGoals, getEmployees, getObservations } from "./api";
import type { GoalRow, EmployeeRow, ObsRow } from "./api";

export default function Dashboard() {
  const [score, setScore] = useState<{ score: number; label: string } | null>(null);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [obs, setObs] = useState<ObsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getHealthScore(), getGoals(), getEmployees(), getObservations()])
      .then(([s, g, e, o]) => {
        setScore(s);
        setGoals(g);
        setEmployees(e);
        setObs(o.slice(0, 6));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading dashboard...</div>;
  if (error) return <div className="error-box">{error}</div>;

  const goalsDone = goals.filter((g) => g.status === "done").length;

  return (
    <div>
      {/* KPI row */}
      <div className="grid4 section">
        <div className="card">
          <div className="card-title">Health Score</div>
          <div className="card-value" style={{ color: scoreColor(score?.score ?? 0) }}>
            {score?.score ?? "—"}<span style={{ fontSize: 14, color: "var(--text-muted)" }}>/100</span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{score?.label}</div>
        </div>

        <div className="card">
          <div className="card-title">Active Goals</div>
          <div className="card-value">{goals.length}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{goalsDone} completed</div>
        </div>

        <div className="card">
          <div className="card-title">AI Employees</div>
          <div className="card-value">{employees.length}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>agents deployed</div>
        </div>

        <div className="card">
          <div className="card-title">Observations</div>
          <div className="card-value">{obs.length > 0 ? obs.length + "+" : "0"}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>data points logged</div>
        </div>
      </div>

      <div className="grid2">
        {/* Goals */}
        <div className="card">
          <div className="card-title">Company Goals</div>
          {goals.length === 0 ? (
            <div className="empty">No goals defined yet</div>
          ) : (
            goals.map((g) => (
              <div key={g.id} className="row">
                <div className="row-main">
                  <div className="row-title">{g.title}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <div className="progress-bar" style={{ flex: 1 }}>
                      <div className="progress-fill" style={{ width: g.progress + "%" }} />
                    </div>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", width: 32 }}>{g.progress}%</span>
                  </div>
                </div>
                <span className={`badge ${statusBadge(g.status)}`}>{g.status}</span>
              </div>
            ))
          )}
        </div>

        {/* AI Employees */}
        <div className="card">
          <div className="card-title">AI Employees</div>
          {employees.length === 0 ? (
            <div className="empty">No employees yet</div>
          ) : (
            employees.map((e) => (
              <div key={e.id} className="row">
                <span style={{ fontSize: 20 }}>{e.emoji}</span>
                <div className="row-main">
                  <div className="row-title">{e.name}</div>
                  <div className="row-sub">{e.role}</div>
                </div>
                <span className="badge badge-green">active</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Recent observations */}
      {obs.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-title">Recent Activity</div>
          {obs.map((o) => (
            <div key={o.id} className="row">
              <span className={`badge ${catBadge(o.signalType)}`}>{o.signalType}</span>
              <div className="row-main">
                <div className="row-title" style={{ fontSize: 12 }}>{o.content.slice(0, 100)}</div>
              </div>
              <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                {timeAgo(o.occurredAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function scoreColor(n: number) {
  if (n >= 80) return "var(--green)";
  if (n >= 50) return "var(--yellow)";
  return "var(--red)";
}

function statusBadge(s: string) {
  if (s === "done") return "badge-green";
  if (s === "active") return "badge-purple";
  return "badge-gray";
}

function catBadge(c: string) {
  const map: Record<string, string> = {
    revenue: "badge-green", finance: "badge-green",
    marketing: "badge-purple", sales: "badge-purple",
    hr: "badge-yellow", support: "badge-yellow",
    operations: "badge-gray",
  };
  return map[c] ?? "badge-gray";
}

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return secs + "s ago";
  if (secs < 3600) return Math.floor(secs / 60) + "m ago";
  if (secs < 86400) return Math.floor(secs / 3600) + "h ago";
  return Math.floor(secs / 86400) + "d ago";
}
