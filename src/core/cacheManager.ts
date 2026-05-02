/**
 * File cache manager - tracks file modifications to avoid re-parsing.
 */
import * as fs from 'fs';
import { CacheEntry, Session } from '../types';

const MAX_CACHE_SIZE = 1000;

export class CacheManager {
  private cache = new Map<string, CacheEntry>();

  /** Check if a file needs re-parsing based on modification time. */
  needsUpdate(filePath: string): boolean {
    const entry = this.cache.get(filePath);
    if (!entry) { return true; }
    try {
      const stat = fs.statSync(filePath);
      return stat.mtimeMs > entry.lastModified;
    } catch { return true; }
  }

  /** Store parsed session data for a file. */
  set(filePath: string, session: Session | null): void {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entries
      const entries = [...this.cache.entries()];
      entries.sort((a, b) => a[1].lastProcessed - b[1].lastProcessed);
      for (let i = 0; i < entries.length / 4; i++) {
        this.cache.delete(entries[i][0]);
      }
    }
    try {
      const stat = fs.statSync(filePath);
      this.cache.set(filePath, {
        filePath, lastModified: stat.mtimeMs,
        lastProcessed: Date.now(), sessionData: session,
      });
    } catch { /* skip */ }
  }

  /** Get cached session data. */
  get(filePath: string): Session | null | undefined {
    const entry = this.cache.get(filePath);
    return entry?.sessionData;
  }

  /** Get cache statistics. */
  getStats(): { entries: number; hitRate: number } {
    return { entries: this.cache.size, hitRate: 0 };
  }

  /** Clear all cached data. */
  clear(): void { this.cache.clear(); }
}
