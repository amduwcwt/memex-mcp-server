import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import type { MemoryStorage, AppendResult } from "./interface.js";
import type {
  MemoryInput,
  MemoryRecord,
  SearchQuery,
  SearchResult,
  ListFilter,
  MemoryPatch,
  MemoryStats,
  PurgeFilter,
  ExportFilter,
  ExportData,
  Tier,
} from "../types.js";
import { createDatabase } from "../db.js";
import { sanitizeFTS5Query, contentHash } from "../utils.js";

export class LocalStorage implements MemoryStorage {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = createDatabase(dbPath);
  }

  async append(input: MemoryInput): Promise<AppendResult> {
    try {
      const tier = input.tier ?? "L1";
      const project = input.project ?? (process.env.MEMEX_DEFAULT_PROJECT || "_global");
      const tags = input.tags?.join(",") ?? null;
      const source = input.source ?? null;
      const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

      const hash = contentHash(input.content, project, tier);

      // Check for duplicate
      const existing = this.db
        .prepare("SELECT * FROM memories WHERE content_hash = ?")
        .get(hash) as unknown as MemoryRecord | undefined;

      if (existing) {
        return { record: existing, deduplicated: true };
      }

      let expires_at: string | null = null;
      if (input.ttl_hours) {
        const exp = new Date(Date.now() + input.ttl_hours * 3600 * 1000);
        expires_at = exp.toISOString().replace("T", " ").slice(0, 19);
      } else if (tier === "L1") {
        const exp = new Date(Date.now() + 72 * 3600 * 1000);
        expires_at = exp.toISOString().replace("T", " ").slice(0, 19);
      } else if (tier === "L2") {
        const exp = new Date(Date.now() + 90 * 24 * 3600 * 1000);
        expires_at = exp.toISOString().replace("T", " ").slice(0, 19);
      }
      // L3 = permanent, no expiry

      const stmt = this.db.prepare(`
        INSERT INTO memories (tier, project, tags, content, source, expires_at, metadata, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(tier, project, tags, input.content, source, expires_at, metadata, hash);

      const last = this.db.prepare("SELECT last_insert_rowid() as id").get() as unknown as { id: number };
      const record = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(last.id) as unknown as MemoryRecord;
      return { record, deduplicated: false };
    } catch (err) {
      throw new Error(`Failed to append memory: ${err instanceof Error ? err.message : err}`);
    }
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    try {
      const limit = query.limit ?? 20;
      const sanitized = sanitizeFTS5Query(query.query);

      // If sanitized query is null, fall back to non-FTS filter query
      if (sanitized === null) {
        return this.filterSearch(query, limit);
      }

      const conditions: string[] = [];
      const params: (string | number)[] = [];

      conditions.push("memories_fts MATCH ?");
      params.push(sanitized);

      if (query.tier) {
        conditions.push("m.tier = ?");
        params.push(query.tier);
      }

      if (query.project) {
        conditions.push("m.project = ?");
        params.push(query.project);
      }

      if (query.tags?.length) {
        for (const tag of query.tags) {
          conditions.push("(m.tags = ? OR m.tags LIKE ? || ',%' OR m.tags LIKE '%,' || ? OR m.tags LIKE '%,' || ? || ',%')");
          params.push(tag, tag, tag, tag);
        }
      }

      params.push(limit);

      const where = conditions.join(" AND ");

      const sql = `
        SELECT m.id, m.tier, m.content, m.tags, m.project, m.created_at,
               rank,
               snippet(memories_fts, 0, '>>>', '<<<', '...', 24) as snippet
        FROM memories_fts
        JOIN memories m ON m.id = memories_fts.rowid
        WHERE ${where}
        ORDER BY rank
        LIMIT ?
      `;

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as unknown as SearchResult[];
      return rows;
    } catch (err) {
      throw new Error(`Search failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private filterSearch(query: SearchQuery, limit: number): SearchResult[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.tier) {
      conditions.push("tier = ?");
      params.push(query.tier);
    }

    if (query.project) {
      conditions.push("project = ?");
      params.push(query.project);
    }

    if (query.tags?.length) {
      for (const tag of query.tags) {
        conditions.push("(tags = ? OR tags LIKE ? || ',%' OR tags LIKE '%,' || ? OR tags LIKE '%,' || ? || ',%')");
        params.push(tag, tag, tag, tag);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const sql = `
      SELECT id, tier, content, tags, project, created_at, 0 as rank, NULL as snippet
      FROM memories
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `;

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as unknown as SearchResult[];
  }

  async list(filter: ListFilter): Promise<{ memories: MemoryRecord[]; total: number }> {
    try {
      const limit = filter.limit ?? 50;
      const offset = filter.offset ?? 0;
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (filter.tier) {
        conditions.push("tier = ?");
        params.push(filter.tier);
      }

      if (filter.project) {
        conditions.push("project = ?");
        params.push(filter.project);
      }

      if (filter.since) {
        conditions.push("created_at >= ?");
        params.push(filter.since);
      }

      if (filter.until) {
        conditions.push("created_at <= ?");
        params.push(filter.until);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM memories ${where}`);
      const countRow = countStmt.get(...params) as unknown as { count: number };

      const listStmt = this.db.prepare(
        `SELECT * FROM memories ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      );
      const rows = listStmt.all(...params, limit, offset) as unknown as MemoryRecord[];

      return { memories: rows, total: countRow.count };
    } catch (err) {
      throw new Error(`Failed to list memories: ${err instanceof Error ? err.message : err}`);
    }
  }

  async get(id: number): Promise<MemoryRecord | null> {
    try {
      const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as unknown as
        | MemoryRecord
        | undefined;
      return row ?? null;
    } catch (err) {
      throw new Error(`Failed to get memory ${id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async update(id: number, patch: MemoryPatch): Promise<void> {
    try {
      const sets: string[] = [];
      const params: (string | number)[] = [];

      if (patch.content !== undefined) {
        sets.push("content = ?");
        params.push(patch.content);
      }

      if (patch.tier !== undefined) {
        sets.push("tier = ?");
        params.push(patch.tier);
      }

      if (patch.tags !== undefined) {
        sets.push("tags = ?");
        params.push(patch.tags.join(","));
      }

      if (sets.length === 0) return;

      // Recompute content_hash if content or tier changed
      if (patch.content !== undefined || patch.tier !== undefined) {
        const existing = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as unknown as
          | MemoryRecord
          | undefined;
        if (existing) {
          const newContent = patch.content ?? existing.content;
          const newTier = patch.tier ?? existing.tier;
          const hash = contentHash(newContent, existing.project, newTier);
          sets.push("content_hash = ?");
          params.push(hash);
        }
      }

      params.push(id);
      this.db.prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    } catch (err) {
      throw new Error(`Failed to update memory ${id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async delete(id: number): Promise<void> {
    try {
      this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    } catch (err) {
      throw new Error(`Failed to delete memory ${id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async stats(): Promise<MemoryStats> {
    try {
      const total = (
        this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as unknown as { count: number }
      ).count;

      const tierRows = this.db
        .prepare("SELECT tier, COUNT(*) as count FROM memories GROUP BY tier")
        .all() as unknown as { tier: Tier; count: number }[];

      const by_tier: Record<Tier, number> = { L1: 0, L2: 0, L3: 0 };
      for (const row of tierRows) {
        by_tier[row.tier] = row.count;
      }

      const projectRows = this.db
        .prepare("SELECT project, COUNT(*) as count FROM memories GROUP BY project")
        .all() as unknown as { project: string; count: number }[];

      const by_project: Record<string, number> = {};
      for (const row of projectRows) {
        by_project[row.project] = row.count;
      }

      let db_size_bytes = 0;
      try {
        const stat = fs.statSync(this.dbPath);
        db_size_bytes = stat.size;
      } catch {
        // DB file might not exist yet
      }

      return { total, by_tier, by_project, db_size_bytes };
    } catch (err) {
      throw new Error(`Failed to get stats: ${err instanceof Error ? err.message : err}`);
    }
  }

  async prune(): Promise<number> {
    try {
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      const result = this.db
        .prepare("DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?")
        .run(now);
      return Number(result.changes);
    } catch (err) {
      throw new Error(`Failed to prune: ${err instanceof Error ? err.message : err}`);
    }
  }

  async purge(filter: PurgeFilter): Promise<number> {
    try {
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (filter.tier) {
        conditions.push("tier = ?");
        params.push(filter.tier);
      }

      if (filter.project) {
        conditions.push("project = ?");
        params.push(filter.project);
      }

      if (filter.source) {
        conditions.push("source = ?");
        params.push(filter.source);
      }

      if (filter.tags?.length) {
        for (const tag of filter.tags) {
          conditions.push("(tags = ? OR tags LIKE ? || ',%' OR tags LIKE '%,' || ? OR tags LIKE '%,' || ? || ',%')");
          params.push(tag, tag, tag, tag);
        }
      }

      if (filter.before) {
        conditions.push("created_at < ?");
        params.push(filter.before);
      }

      if (conditions.length === 0) {
        throw new Error("Purge requires at least one filter condition");
      }

      const where = conditions.join(" AND ");
      const result = this.db.prepare(`DELETE FROM memories WHERE ${where}`).run(...params);
      return Number(result.changes);
    } catch (err) {
      throw new Error(`Purge failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async exportMemories(filter?: ExportFilter): Promise<ExportData> {
    try {
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (filter?.tier) {
        conditions.push("tier = ?");
        params.push(filter.tier);
      }

      if (filter?.project) {
        conditions.push("project = ?");
        params.push(filter.project);
      }

      if (filter?.tags?.length) {
        for (const tag of filter.tags) {
          conditions.push("(tags = ? OR tags LIKE ? || ',%' OR tags LIKE '%,' || ? OR tags LIKE '%,' || ? || ',%')");
          params.push(tag, tag, tag, tag);
        }
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `SELECT * FROM memories ${where} ORDER BY id`;
      const rows = this.db.prepare(sql).all(...params) as unknown as MemoryRecord[];

      return {
        version: 1,
        exported_at: new Date().toISOString(),
        memories: rows,
      };
    } catch (err) {
      throw new Error(`Export failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async importMemories(data: ExportData): Promise<{ imported: number; skipped: number }> {
    try {
      let imported = 0;
      let skipped = 0;

      const insertStmt = this.db.prepare(`
        INSERT INTO memories (tier, project, tags, content, source, created_at, expires_at, metadata, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const mem of data.memories) {
        const hash = mem.content_hash ?? contentHash(mem.content, mem.project, mem.tier);

        // Check for existing record with same hash
        const existing = this.db
          .prepare("SELECT id FROM memories WHERE content_hash = ?")
          .get(hash) as unknown as { id: number } | undefined;

        if (existing) {
          skipped++;
          continue;
        }

        insertStmt.run(
          mem.tier,
          mem.project,
          mem.tags,
          mem.content,
          mem.source,
          mem.created_at,
          mem.expires_at,
          mem.metadata,
          hash
        );
        imported++;
      }

      return { imported, skipped };
    } catch (err) {
      throw new Error(`Import failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  close(): void {
    this.db.close();
  }
}
