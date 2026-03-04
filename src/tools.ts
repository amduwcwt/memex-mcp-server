import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryStorage } from "./storage/interface.js";
import type { ExportData } from "./types.js";

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function registerTools(server: McpServer, storage: MemoryStorage): void {
  // memory_append
  server.tool(
    "memory_append",
    "Add a new memory. L1=short-term events (auto-expires 72h), L2=session summaries (90d), L3=permanent knowledge. Deduplicates identical content.",
    {
      content: z.string().describe("The memory content to store"),
      tier: z
        .enum(["L1", "L2", "L3"])
        .optional()
        .describe("Memory tier: L1 (events, 72h), L2 (sessions, 90d), L3 (permanent). Default: L1"),
      project: z.string().optional().describe("Project name. Default: MEMEX_DEFAULT_PROJECT env var or '_global'"),
      tags: z.array(z.string()).optional().describe("Tags for categorization and filtering"),
      source: z.string().optional().describe("Source identifier (session_id, user, agent, etc.)"),
      ttl_hours: z.number().optional().describe("Custom TTL in hours. Overrides tier default."),
    },
    async (params) => {
      try {
        const { record, deduplicated } = await storage.append({
          content: params.content,
          tier: params.tier,
          project: params.project,
          tags: params.tags,
          source: params.source,
          ttl_hours: params.ttl_hours,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { id: record.id, tier: record.tier, created_at: record.created_at, deduplicated },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // memory_search
  server.tool(
    "memory_search",
    "Full-text search across all memories. Returns ranked results with highlighted snippets. Supports prefix matching with trailing *. Special characters are safely handled.",
    {
      query: z.string().describe("Search query (full-text search). Use trailing * for prefix matching (e.g. 'node*')"),
      tier: z.enum(["L1", "L2", "L3"]).optional().describe("Filter by tier"),
      project: z.string().optional().describe("Filter by project"),
      tags: z.array(z.string()).optional().describe("Filter by tags (exact match, all must match)"),
      limit: z.number().optional().describe("Max results to return. Default: 20"),
    },
    async (params) => {
      try {
        const results = await storage.search({
          query: params.query,
          tier: params.tier,
          project: params.project,
          tags: params.tags,
          limit: params.limit,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ results, count: results.length }, null, 2),
            },
          ],
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // memory_read
  server.tool(
    "memory_read",
    "Read a specific memory by ID.",
    {
      id: z.number().describe("Memory ID"),
    },
    async (params) => {
      try {
        const record = await storage.get(params.id);
        if (!record) {
          return errorResult("Memory not found");
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }],
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // memory_list
  server.tool(
    "memory_list",
    "List memories with optional filters. Returns paginated results.",
    {
      tier: z.enum(["L1", "L2", "L3"]).optional().describe("Filter by tier"),
      project: z.string().optional().describe("Filter by project"),
      since: z.string().optional().describe("Only memories created after this datetime (ISO 8601)"),
      until: z.string().optional().describe("Only memories created before this datetime (ISO 8601)"),
      limit: z.number().optional().describe("Max results per page. Default: 50"),
      offset: z.number().optional().describe("Pagination offset. Default: 0"),
    },
    async (params) => {
      try {
        const result = await storage.list({
          tier: params.tier,
          project: params.project,
          since: params.since,
          until: params.until,
          limit: params.limit,
          offset: params.offset,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // memory_update
  server.tool(
    "memory_update",
    "Update an existing memory's content, tier, or tags.",
    {
      id: z.number().describe("Memory ID to update"),
      content: z.string().optional().describe("New content"),
      tier: z.enum(["L1", "L2", "L3"]).optional().describe("New tier"),
      tags: z.array(z.string()).optional().describe("New tags (replaces existing)"),
    },
    async (params) => {
      try {
        const existing = await storage.get(params.id);
        if (!existing) {
          return errorResult("Memory not found");
        }

        await storage.update(params.id, {
          content: params.content,
          tier: params.tier,
          tags: params.tags,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ updated: true, id: params.id }) }],
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // memory_delete
  server.tool(
    "memory_delete",
    "Delete a memory by ID.",
    {
      id: z.number().describe("Memory ID to delete"),
    },
    async (params) => {
      try {
        const existing = await storage.get(params.id);
        if (!existing) {
          return errorResult("Memory not found");
        }

        await storage.delete(params.id);

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, id: params.id }) }],
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // memory_stats
  server.tool(
    "memory_stats",
    "Get overview statistics: count per tier, per project, database size.",
    {},
    async () => {
      try {
        const stats = await storage.stats();

        return {
          content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }],
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // memory_purge
  server.tool(
    "memory_purge",
    "Batch delete memories by filter. Requires at least one condition. Use to clean up polluted or outdated data.",
    {
      tier: z.enum(["L1", "L2", "L3"]).optional().describe("Delete only this tier"),
      project: z.string().optional().describe("Delete only this project"),
      source: z.string().optional().describe("Delete only from this source (session/agent ID)"),
      tags: z.array(z.string()).optional().describe("Delete only with these tags"),
      before: z.string().optional().describe("Delete only created before this datetime (ISO 8601)"),
    },
    async (params) => {
      try {
        if (!params.tier && !params.project && !params.source && !params.tags?.length && !params.before) {
          return errorResult("Purge requires at least one filter condition");
        }

        const deleted = await storage.purge({
          tier: params.tier,
          project: params.project,
          source: params.source,
          tags: params.tags,
          before: params.before,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ deleted, filters: params }, null, 2),
            },
          ],
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // memory_export
  server.tool(
    "memory_export",
    "Export memories as JSON for backup. Optionally filter by tier, project, or tags.",
    {
      tier: z.enum(["L1", "L2", "L3"]).optional().describe("Filter export by tier"),
      project: z.string().optional().describe("Filter export by project"),
      tags: z.array(z.string()).optional().describe("Filter export by tags"),
    },
    async (params) => {
      try {
        const data = await storage.exportMemories({
          tier: params.tier,
          project: params.project,
          tags: params.tags,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // memory_recall
  server.tool(
    "memory_recall",
    "Progressive disclosure search: queries L3 first (permanent knowledge), expands to L2 (session summaries) if needed, then L1 (recent events). Stops as soon as enough results are found. Use this instead of memory_search when you want context-aware recall that respects memory importance.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Total results wanted. Default: 10"),
      project: z.string().optional().describe("Filter by project"),
    },
    async (params) => {
      try {
        const limit = params.limit ?? 10;
        const results: ReturnType<typeof Array.prototype.concat> = [];
        const seenIds = new Set<number>();

        for (const tier of ["L3", "L2", "L1"] as const) {
          if (results.length >= limit) break;

          const tierResults = await storage.search({
            query: params.query,
            tier,
            project: params.project,
            limit: limit - results.length,
          });

          for (const r of tierResults) {
            if (!seenIds.has(r.id)) {
              seenIds.add(r.id);
              results.push(r);
            }
          }
        }

        const tiers_queried = results.length === 0
          ? ["L3", "L2", "L1"]
          : [...new Set(results.map((r: { tier: string }) => r.tier))];

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ results, count: results.length, tiers_queried }, null, 2),
            },
          ],
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // memory_import
  server.tool(
    "memory_import",
    "Import memories from a JSON export. Skips duplicates by content hash.",
    {
      data: z.string().describe("JSON string from memory_export output"),
    },
    async (params) => {
      try {
        let parsed: ExportData;
        try {
          parsed = JSON.parse(params.data) as ExportData;
        } catch {
          return errorResult("Invalid JSON input");
        }

        if (parsed.version !== 1) {
          return errorResult(`Unsupported export version: ${parsed.version}`);
        }

        if (!Array.isArray(parsed.memories)) {
          return errorResult("Invalid export format: missing memories array");
        }

        const result = await storage.importMemories(parsed);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
