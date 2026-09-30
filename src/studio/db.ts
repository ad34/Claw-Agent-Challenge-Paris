import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { STUDIO_DIR } from "./paths.ts";

mkdirSync(STUDIO_DIR, { recursive: true });
export const db = new DatabaseSync(join(STUDIO_DIR, "studio.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

db.exec(`
-- Un job = un produit à shooter, avec son brief. Il est retravaillé nuit après nuit.
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  brief TEXT NOT NULL,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS renders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  ts TEXT NOT NULL,
  recipe TEXT NOT NULL,
  hypothesis TEXT,
  path TEXT,
  seconds REAL,
  score INTEGER,
  critique TEXT,
  error TEXT,
  champion INTEGER NOT NULL DEFAULT 0 -- 1 = est devenu champion à ce moment-là
);
CREATE INDEX IF NOT EXISTS renders_job ON renders(job_id, id);

-- Envois du matin et réponses de la marque.
CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  render_id INTEGER NOT NULL,
  ts TEXT NOT NULL,
  telegram_message_id INTEGER,
  label TEXT,
  answered_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  job_id INTEGER,
  render_id INTEGER,
  message TEXT NOT NULL,
  payload TEXT
);

-- Produits en cours d'arrivée : photo → brief → modèle 3D Meshy → job.
CREATE TABLE IF NOT EXISTS intakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  source TEXT NOT NULL,
  photo TEXT NOT NULL,
  caption TEXT,
  name TEXT,
  brief TEXT,
  status TEXT NOT NULL, -- reading | modeling | done | failed
  progress INTEGER NOT NULL DEFAULT 0,
  job_id INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// Migrations légères (colonnes ajoutées après coup).
for (const sql of ["ALTER TABLE intakes ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo'"]) {
  try {
    db.exec(sql);
  } catch {
    // colonne déjà présente
  }
}

export const now = () => new Date().toISOString();

export function logEvent(type: string, message: string, opts: { jobId?: number; renderId?: number; payload?: unknown } = {}) {
  db.prepare("INSERT INTO events(ts, type, job_id, render_id, message, payload) VALUES(?, ?, ?, ?, ?, ?)").run(
    now(),
    type,
    opts.jobId ?? null,
    opts.renderId ?? null,
    message,
    opts.payload === undefined ? null : JSON.stringify(opts.payload),
  );
  console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ${type.padEnd(10)} ${message}`);
}

export function getKv(key: string): string | undefined {
  return (db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

export function setKv(key: string, value: string) {
  db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export interface Job {
  id: number;
  name: string;
  model: string;
  brief: string;
}

export interface RenderRow {
  id: number;
  job_id: number;
  generation: number;
  recipe: string;
  hypothesis: string | null;
  path: string | null;
  score: number | null;
  critique: string | null;
}

export function champion(jobId: number): RenderRow | undefined {
  return db.prepare("SELECT * FROM renders WHERE job_id = ? AND champion = 1 ORDER BY id DESC LIMIT 1").get(jobId) as RenderRow | undefined;
}
