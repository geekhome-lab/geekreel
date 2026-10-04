import { Database } from "bun:sqlite";
import { dbPath } from "./config";

/**
 * SQLite（bun:sqlite 直用，schema 稳定前不引入 ORM）。
 * 原则：媒体与文档在文件系统，库只存索引与状态。
 */
export const db = new Database(dbPath, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");

db.run(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  directory TEXT NOT NULL,
  coverAssetId TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'import',
  projectId TEXT,
  durationMs INTEGER,
  width INTEGER,
  height INTEGER,
  sizeBytes INTEGER NOT NULL,
  thumbPath TEXT,
  proxyPath TEXT,
  metaJson TEXT NOT NULL DEFAULT '{}',
  createdAt INTEGER NOT NULL
)`);
db.run("CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type)");
db.run("CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(createdAt DESC)");

db.run(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  projectId TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  message TEXT,
  payloadJson TEXT NOT NULL DEFAULT '{}',
  resultJson TEXT,
  error TEXT,
  createdAt INTEGER NOT NULL,
  startedAt INTEGER,
  finishedAt INTEGER
)`);
db.run("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, createdAt DESC)");

db.run(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  valueJson TEXT NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS model_endpoints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adapterType TEXT NOT NULL,
  capability TEXT NOT NULL,
  configJson TEXT NOT NULL DEFAULT '{}',
  webSearch INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  isDefault INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS canvas_docs (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
)`);
db.run("CREATE INDEX IF NOT EXISTS idx_canvas_project ON canvas_docs(projectId)");

db.run(`
CREATE TABLE IF NOT EXISTS radar_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'ai-query',
  platform TEXT NOT NULL,
  queryTemplate TEXT NOT NULL,
  intervalMinutes INTEGER NOT NULL DEFAULT 360,
  endpointId TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  lastRunAt INTEGER,
  lastError TEXT,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS radar_items (
  id TEXT PRIMARY KEY,
  sourceId TEXT NOT NULL,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,
  url TEXT,
  heat INTEGER NOT NULL,
  heatText TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL,
  fetchedAt INTEGER NOT NULL
)`);
db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_items_hash ON radar_items(hash)");
db.run("CREATE INDEX IF NOT EXISTS idx_radar_items_fetched ON radar_items(fetchedAt DESC)");

db.run(`
CREATE TABLE IF NOT EXISTS radar_subs (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  platformsJson TEXT NOT NULL DEFAULT '[]',
  heatThreshold INTEGER NOT NULL DEFAULT 60,
  quietStart INTEGER,
  quietEnd INTEGER,
  channelsJson TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS push_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  configJson TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS push_logs (
  id TEXT PRIMARY KEY,
  subId TEXT,
  channelId TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS analysis_reports (
  id TEXT PRIMARY KEY,
  sourceUrl TEXT,
  videoAssetId TEXT,
  title TEXT NOT NULL,
  reportJson TEXT NOT NULL,
  framesJson TEXT NOT NULL DEFAULT '[]',
  transcript TEXT,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS remake_templates (
  id TEXT PRIMARY KEY,
  analysisId TEXT,
  name TEXT NOT NULL,
  slotsJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS remake_runs (
  id TEXT PRIMARY KEY,
  templateId TEXT NOT NULL,
  projectId TEXT,
  variablesJson TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL
)`);

// ---------------------------------------------------------------------------
// 设置读写
// ---------------------------------------------------------------------------

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.query("SELECT valueJson FROM settings WHERE key = ?").get(key) as { valueJson: string } | null;
  if (!row) return fallback;
  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.run(
    "INSERT INTO settings (key, valueJson) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson",
    [key, JSON.stringify(value)],
  );
}
