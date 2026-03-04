import fs from "node:fs";
import path from "node:path";
import type { MemoryStorage } from "./storage/interface.js";

const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SNAPSHOTS = 7;

export class LifecycleManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private storage: MemoryStorage;
  private snapshotDir: string;

  constructor(storage: MemoryStorage) {
    this.storage = storage;
    const dbPath = process.env.MEMEX_DB_PATH || "";
    this.snapshotDir = path.join(path.dirname(dbPath) || path.join(process.env.HOME || "~", ".claude"), "memex-snapshots");
  }

  async start(): Promise<void> {
    // Run prune immediately on startup
    await this.runPrune();

    // Snapshot on startup if stale (>24h since last)
    await this.runSnapshotIfStale();

    // Schedule periodic pruning + snapshots
    this.timer = setInterval(() => {
      this.runPrune().catch((err) => {
        process.stderr.write(`[memex] Prune error: ${err}\n`);
      });
      this.runSnapshotIfStale().catch((err) => {
        process.stderr.write(`[memex] Snapshot error: ${err}\n`);
      });
    }, PRUNE_INTERVAL_MS);

    // Allow the process to exit even if the timer is still running
    this.timer.unref();
  }

  private async runPrune(): Promise<void> {
    const pruned = await this.storage.prune();
    if (pruned > 0) {
      process.stderr.write(`[memex] Pruned ${pruned} expired memories\n`);
    }
  }

  private async runSnapshotIfStale(): Promise<void> {
    try {
      if (!fs.existsSync(this.snapshotDir)) {
        fs.mkdirSync(this.snapshotDir, { recursive: true });
      }

      // Check if latest snapshot is recent enough
      const files = this.getSnapshotFiles();
      if (files.length > 0) {
        const latest = fs.statSync(files[files.length - 1]);
        if (Date.now() - latest.mtimeMs < SNAPSHOT_INTERVAL_MS) {
          return; // Still fresh
        }
      }

      await this.createSnapshot();
    } catch (err) {
      process.stderr.write(`[memex] Snapshot check failed: ${err}\n`);
    }
  }

  private async createSnapshot(): Promise<void> {
    const data = await this.storage.exportMemories();
    if (data.memories.length === 0) return; // Nothing to snapshot

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filePath = path.join(this.snapshotDir, `memex-${ts}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data));

    process.stderr.write(`[memex] Snapshot saved: ${filePath} (${data.memories.length} memories)\n`);

    // Rotate: keep only MAX_SNAPSHOTS
    const files = this.getSnapshotFiles();
    while (files.length > MAX_SNAPSHOTS) {
      const old = files.shift()!;
      fs.unlinkSync(old);
    }
  }

  private getSnapshotFiles(): string[] {
    if (!fs.existsSync(this.snapshotDir)) return [];
    return fs.readdirSync(this.snapshotDir)
      .filter((f) => f.startsWith("memex-") && f.endsWith(".json"))
      .sort()
      .map((f) => path.join(this.snapshotDir, f));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
