import { useState, useEffect } from "react";
import { getBrief, apiFetch } from "./api";

interface BriefData { title: string; body: string; createdAt: string; }

export default function Brief() {
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    const fetcher = showRefresh
      ? apiFetch<BriefData>("/brief/refresh", { method: "POST" })
      : getBrief();
    fetcher
      .then((d) => setBrief(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="loading">Loading morning brief...</div>;
  if (error) return <div className="error-box">{error}</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {brief ? new Date(brief.createdAt).toLocaleString() : "No brief yet"}
          </div>
        </div>
        <button
          className="btn-secondary"
          onClick={() => load(true)}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh Brief"}
        </button>
      </div>

      {!brief ? (
        <div className="card">
          <div className="empty">
            No morning brief yet. Run <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>employeeos brief</code> or wait for the brain loop to generate one.
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
            {brief.title}
          </div>
          <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {brief.body}
          </div>
        </div>
      )}
    </div>
  );
}
