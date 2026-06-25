import type { Database } from "sql.js";

export function runMigrations(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      industry TEXT NOT NULL DEFAULT 'other',
      description TEXT NOT NULL DEFAULT '',
      ceo_name TEXT NOT NULL DEFAULT '',
      ceo_email TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS brands (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      progress INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.8,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      source TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      content TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      processed_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS learnings (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      pattern TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      evidence_count INTEGER NOT NULL DEFAULT 1,
      last_seen TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      employee_role TEXT NOT NULL,
      title TEXT NOT NULL,
      actions TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      autonomy_required TEXT NOT NULL DEFAULT 'recommend',
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS health_scores (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      breakdown TEXT NOT NULL DEFAULT '{}',
      scored_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      brand_id TEXT,
      filename TEXT NOT NULL,
      kind TEXT NOT NULL,
      content_summary TEXT NOT NULL DEFAULT '',
      word_count INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
      content,
      document_id UNINDEXED,
      chunk_id UNINDEXED
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      outcome TEXT,
      error TEXT,
      learning_id TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'daily_brief',
      score INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS execution_steps (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      operation TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '{}',
      expected_outcome TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      error TEXT,
      started_at TEXT,
      completed_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tool_connections (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'disconnected',
      config TEXT NOT NULL DEFAULT '{}',
      connected_at TEXT
    )
  `);
}
