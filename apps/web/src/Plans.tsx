import { useState, useEffect } from "react";
import { getPlans } from "./api";
import type { PlanRow } from "./api";

export default function Plans() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getPlans()
      .then(setPlans)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading plans...</div>;
  if (error) return <div className="error-box">{error}</div>;

  const pending = plans.filter((p) => p.status === "pending");
  const approved = plans.filter((p) => p.status === "approved");
  const executed = plans.filter((p) => p.status === "executed");

  return (
    <div>
      {plans.length === 0 ? (
        <div className="card">
          <div className="empty">
            No AI plans yet. Start the brain loop with{" "}
            <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>employeeos start</code> to generate plans.
          </div>
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="section">
              <div className="section-title">Pending Approval ({pending.length})</div>
              {pending.map((p) => <PlanCard key={p.id} plan={p} />)}
            </div>
          )}
          {approved.length > 0 && (
            <div className="section">
              <div className="section-title">Approved ({approved.length})</div>
              {approved.map((p) => <PlanCard key={p.id} plan={p} />)}
            </div>
          )}
          {executed.length > 0 && (
            <div className="section">
              <div className="section-title">Executed ({executed.length})</div>
              {executed.map((p) => <PlanCard key={p.id} plan={p} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PlanCard({ plan }: { plan: PlanRow }) {
  const autonomyColor: Record<string, string> = {
    supervised: "badge-yellow",
    semi: "badge-purple",
    autonomous: "badge-red",
  };

  const statusBadge: Record<string, string> = {
    pending: "badge-yellow",
    approved: "badge-green",
    executed: "badge-gray",
  };

  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
            {plan.title}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className="badge badge-gray">{plan.employeeRole}</span>
            <span className={`badge ${autonomyColor[plan.autonomyRequired] ?? "badge-gray"}`}>
              {plan.autonomyRequired}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span className={`badge ${statusBadge[plan.status] ?? "badge-gray"}`}>{plan.status}</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {new Date(plan.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  );
}
