import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier TEXT NOT NULL CHECK(tier IN ('L1','L2','L3')),
  project TEXT NOT NULL DEFAULT '_global',
  tags TEXT,
  content TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  metadata TEXT,
  content_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash);
`;

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content, tags, project,
  content='memories',
  content_rowid='id'
);
`;

const TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags, project)
  VALUES (new.id, new.content, new.tags, new.project);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags, project)
  VALUES ('delete', old.id, old.content, old.tags, old.project);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags, project)
  VALUES ('delete', old.id, old.content, old.tags, old.project);
  INSERT INTO memories_fts(rowid, content, tags, project)
  VALUES (new.id, new.content, new.tags, new.project);
END;
`;

export function createDatabase(dbPath: string): DatabaseSync {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(SCHEMA);
  db.exec(FTS_SCHEMA);
  db.exec(TRIGGERS);

  // Migrate: add content_hash column if missing (upgrade from v1.0)
  const cols = db.prepare("PRAGMA table_info(memories)").all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === "content_hash")) {
    db.exec("ALTER TABLE memories ADD COLUMN content_hash TEXT");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash)");
  }

  return db;
}
