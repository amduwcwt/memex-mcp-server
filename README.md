# memex-mcp-server

Tiered memory MCP server for Claude Code and AI agents.

Stores memories in three tiers with full-text search, automatic deduplication, export/import, and daily snapshots.

## Tiers

| Tier | Retention | Use for |
|------|-----------|---------|
| L1   | 72h       | Session events, debug logs |
| L2   | 90d       | Session summaries, decisions |
| L3   | Permanent | Core knowledge, architecture |

## Install (Claude Code)

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "memex": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "memex-mcp-server"],
      "env": {
        "MEMEX_DB_PATH": "/Users/yourname/.claude/memex.db",
        "MEMEX_DEFAULT_PROJECT": "my-project"
      }
    }
  }
}
```

Restart Claude Code. Tools appear automatically.

## Tools

| Tool | Description |
|------|-------------|
| `memory_append` | Add a memory (deduplicates identical content) |
| `memory_search` | Full-text search with FTS5, prefix matching (`node*`), snippets |
| `memory_list` | Paginated list with tier/project/date filters |
| `memory_read` | Read one memory by ID |
| `memory_update` | Update content, tier, or tags |
| `memory_delete` | Delete by ID |
| `memory_purge` | Batch delete by source/tier/project/tags/date |
| `memory_export` | Export as JSON (for backup or migration) |
| `memory_import` | Import from JSON, skips duplicates |
| `memory_stats` | Count by tier/project, DB size |

## CLAUDE.md — Teaching Claude to use memex

Add this to `~/.claude/CLAUDE.md` so Claude automatically uses memex without being asked:

```markdown
## Memory
Use the memex MCP to manage memory. Act proactively — no need for the user to ask.

**Before every write, search first:**
1. `memory_search` for related content
2. Duplicate → skip; Contradicts existing → `memory_update` the old record; Genuinely new → `memory_append`
3. Always set the `source` field to the current session or agent identifier

**When to save:**
- Session start: `memory_search` for relevant background to restore context
- During session: save immediately when you encounter architecture decisions, debug conclusions, project config, environment info
- Session end: save a summary, open TODOs, and next steps to L2

**Tier guidelines:**
- L1 (72h): temporary events, debug logs
- L2 (90d): session summaries, decisions
- L3 (permanent): core knowledge, architecture conventions
```

## Writing Protocol

To keep memory clean, follow this before every `memory_append`:

1. `memory_search` for related content
2. Duplicate → skip
3. Contradicts existing → `memory_update` the old record
4. Genuinely new → `memory_append`

Always set `source` so pollution can be traced and purged:

```
memory_append(content="...", source="session-abc123")
# later, if that session wrote garbage:
memory_purge(source="session-abc123")
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMEX_DB_PATH` | `~/.claude/memex.db` | SQLite database path |
| `MEMEX_DEFAULT_PROJECT` | `_global` | Default project name |

## Snapshots

Daily snapshots are saved automatically to the same directory as the DB (`memex-snapshots/`). Last 7 are kept.

To restore from snapshot:

```
memory_import(data="<contents of snapshot JSON>")
```

## Requirements

Node.js ≥ 22 (uses built-in `node:sqlite`)
