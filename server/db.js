'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'geo.db');
const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : DEFAULT_DB_PATH;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = `
CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT UNIQUE NOT NULL,
  name TEXT,
  category TEXT,
  category_id TEXT,
  category_sub TEXT,
  category_source TEXT,
  confidence REAL,
  signals TEXT,
  runner_up TEXT,
  schema_types TEXT,
  title TEXT,
  meta_description TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  intent TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'tracking',
  notes TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  name TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  overlap_score REAL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (domain_id, domain),
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tracking_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  trigger TEXT NOT NULL DEFAULT 'manual',
  engines TEXT,
  prompts_total INTEGER,
  prompts_done INTEGER,
  error TEXT,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tracking_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  prompt_id INTEGER NOT NULL,
  engine TEXT NOT NULL,
  status TEXT NOT NULL,
  position INTEGER,
  cited INTEGER,
  citation_url TEXT,
  sources TEXT,
  raw_response TEXT,
  response_excerpt TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES tracking_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER NOT NULL,
  prompt_id INTEGER,
  type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  action_items TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompts_domain ON prompts(domain_id);
CREATE INDEX IF NOT EXISTS idx_competitors_domain ON competitors(domain_id);
CREATE INDEX IF NOT EXISTS idx_runs_domain ON tracking_runs(domain_id);
CREATE INDEX IF NOT EXISTS idx_results_run ON tracking_results(run_id);
CREATE INDEX IF NOT EXISTS idx_results_prompt_engine ON tracking_results(prompt_id, engine);
CREATE INDEX IF NOT EXISTS idx_recs_domain ON recommendations(domain_id);
`;

db.exec(schema);

function now() {
  return Date.now();
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function setSetting(key, value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, serialized, now());
}

module.exports = {
  db,
  now,
  getSetting,
  setSetting,
  dbPath,
};

if (require.main === module && process.argv.includes('--migrate')) {
  console.log('Schema applied at', dbPath);
}
