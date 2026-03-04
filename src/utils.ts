import { createHash } from "node:crypto";

const FTS5_OPERATORS = /["()+\-:^]/g;
const FTS5_KEYWORDS = /\b(AND|OR|NOT|NEAR)\b/g;

/**
 * Sanitize a raw user query for safe use in FTS5 MATCH.
 * Strips operators, removes boolean keywords, quotes each token,
 * and preserves trailing * for prefix matching.
 * Returns null if the sanitized query is empty (caller should skip MATCH).
 */
export function sanitizeFTS5Query(raw: string): string | null {
  let cleaned = raw.replace(FTS5_OPERATORS, " ").replace(FTS5_KEYWORDS, " ");
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);

  if (tokens.length === 0) return null;

  const quoted = tokens.map((t) => {
    if (t.endsWith("*")) {
      const base = t.slice(0, -1);
      return base.length > 0 ? `"${base}" *` : null;
    }
    return `"${t}"`;
  });

  const result = quoted.filter(Boolean).join(" ");
  return result.length > 0 ? result : null;
}

/**
 * Compute a SHA-256 content hash for deduplication.
 * Same content in different projects/tiers is NOT a duplicate.
 */
export function contentHash(content: string, project: string, tier: string): string {
  return createHash("sha256")
    .update(content + "\0" + project + "\0" + tier)
    .digest("hex");
}
