export type Tier = "L1" | "L2" | "L3";

export interface MemoryRecord {
  id: number;
  tier: Tier;
  project: string;
  tags: string | null;
  content: string;
  source: string | null;
  created_at: string;
  expires_at: string | null;
  metadata: string | null;
  content_hash: string | null;
}

export interface MemoryInput {
  content: string;
  tier?: Tier;
  project?: string;
  tags?: string[];
  source?: string;
  ttl_hours?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchQuery {
  query: string;
  tier?: Tier;
  project?: string;
  tags?: string[];
  limit?: number;
}

export interface SearchResult {
  id: number;
  tier: Tier;
  content: string;
  tags: string | null;
  project: string;
  rank: number;
  created_at: string;
  snippet: string | null;
}

export interface ListFilter {
  tier?: Tier;
  project?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryPatch {
  content?: string;
  tier?: Tier;
  tags?: string[];
}

export interface MemoryStats {
  total: number;
  by_tier: Record<Tier, number>;
  by_project: Record<string, number>;
  db_size_bytes: number;
}

export interface PurgeFilter {
  tier?: Tier;
  project?: string;
  source?: string;
  tags?: string[];
  before?: string;
}

export interface ExportFilter {
  tier?: Tier;
  project?: string;
  tags?: string[];
}

export interface ExportData {
  version: 1;
  exported_at: string;
  memories: MemoryRecord[];
}
