import { useState, useEffect, useCallback } from "react";
import { getHealth, getCompany } from "./api";
import type { CompanyRow } from "./api";
import Dashboard from "./Dashboard";
import Brief from "./Brief";
import Ask from "./Ask";
import Plans from "./Plans";
import BrainTerminal from "./Terminal";
import Settings from "./Settings";
import Usage from "./Usage";
import "./App.css";

type Page = "dashboard" | "brief" | "ask" | "plans" | "terminal" | "settings" | "usage";

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [connected, setConnected] = useState(false);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [company, setCompany] = useState<CompanyRow | null>(null);

  useEffect(() => {
    getHealth()
      .then((h) => setInitialized(h.initialized))
      .catch(() => setInitialized(false));
    getCompany()
      .then((d) => setCompany(d.company))
      .catch(() => {});
  }, []);

  const handleConnect = useCallback((ok: boolean) => setConnected(ok), []);

  if (initialized === null) {
    return (
      <div className="splash">
        <div className="splash-icon">&#129504;</div>
        <div className="splash-text">Connecting to Company Brain...</div>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="splash">
        <div className="splash-icon">&#129504;</div>
        <div className="splash-title">EmployeeOS</div>
        <div className="splash-text">Not configured yet. Run <code>employeeos init</code> in your terminal to get started.</div>
      </div>
    );
  }

  const nav: { id: Page; label: string; icon: string }[] = [
    { id: "dashboard", label: "Dashboard", icon: "⬡" },
    { id: "brief", label: "Morning Brief", icon: "☀" },
    { id: "ask", label: "Ask Brain", icon: "◎" },
    { id: "plans", label: "AI Plans", icon: "⟳" },
    { id: "terminal", label: "Live Terminal", icon: "⌗" },
    { id: "settings", label: "Integrations", icon: "⚙" },
    { id: "usage", label: "Usage & Cron", icon: "◈" },
  ];

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">&#129504;</span>
          <span className="brand-name">EmployeeOS</span>
        </div>

        <nav className="sidebar-nav">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-row">
            <span className={`status-dot ${connected ? "green" : "red"}`} />
            <span className="muted">{connected ? "Brain active" : "Disconnected"}</span>
          </div>
          {company && <div className="company-name muted">{company.name}</div>}
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-title">
            {nav.find((n) => n.id === page)?.label}
          </div>
          {company && (
            <div className="topbar-company">
              <span className="muted">{company.name}</span>
              <span className="separator">·</span>
              <span className="dim">{company.industry}</span>
            </div>
          )}
        </header>

        <div className="page-content">
          {page === "dashboard" && <Dashboard />}
          {page === "brief" && <Brief />}
          {page === "ask" && <Ask />}
          {page === "plans" && <Plans />}
          {page === "terminal" && <BrainTerminal onConnectionChange={handleConnect} />}
          {page === "settings" && <Settings />}
          {page === "usage" && <Usage />}
        </div>
      </main>
    </div>
  );
}
