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
} from "../types.js";

export interface AppendResult {
  record: MemoryRecord;
  deduplicated: boolean;
}

export interface MemoryStorage {
  append(memory: MemoryInput): Promise<AppendResult>;
  search(query: SearchQuery): Promise<SearchResult[]>;
  list(filter: ListFilter): Promise<{ memories: MemoryRecord[]; total: number }>;
  get(id: number): Promise<MemoryRecord | null>;
  update(id: number, patch: MemoryPatch): Promise<void>;
  delete(id: number): Promise<void>;
  stats(): Promise<MemoryStats>;
  prune(): Promise<number>;
  purge(filter: PurgeFilter): Promise<number>;
  exportMemories(filter?: ExportFilter): Promise<ExportData>;
  importMemories(data: ExportData): Promise<{ imported: number; skipped: number }>;
  close(): void;
}
