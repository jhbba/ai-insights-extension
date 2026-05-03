/**
 * Codex session log adapter.
 * Reads JSONL rollout files from ~/.codex/sessions/.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseProvider } from './base';
import { Session, Interaction } from '../types';
import { calculateCost } from '../core/costEstimation';

type TokenUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
};

export class CodexProvider extends BaseProvider {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex';
  private readonly sessionsDir: string;
  private readonly indexFile: string;

  constructor() {
    super();
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    this.sessionsDir = path.join(codexHome, 'sessions');
    this.indexFile = path.join(codexHome, 'session_index.jsonl');
  }

  getSessionDirectories(): string[] { return [this.sessionsDir, this.indexFile]; }

  async discoverSessionFiles(): Promise<string[]> {
    const files: string[] = [];
    try {
      if (fs.existsSync(this.sessionsDir)) {
        this.walkDir(this.sessionsDir, files);
      }
    } catch { /* skip */ }
    return files;
  }

  private walkDir(dir: string, files: string[], depth: number = 0): void {
    if (depth > 5) { return; }
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.walkDir(full, files, depth + 1);
        } else if (entry.name.endsWith('.jsonl') && entry.name.startsWith('rollout-')) {
          files.push(full);
        }
      }
    } catch { /* skip */ }
  }

  async parseSessionFile(filePath: string): Promise<Session | null> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length === 0) { return null; }

      const interactions: Interaction[] = [];
      const fallbackTimestamp = this.getFileFallbackDate(filePath);
      let startTime = fallbackTimestamp;
      let endTime = fallbackTimestamp;
      let id = path.basename(filePath, '.jsonl');
      let workspace = 'unknown';
      let model = 'codex';
      let title: string | undefined;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const timestamp = this.parseTimestamp(entry.timestamp, fallbackTimestamp);
          if (timestamp < startTime) { startTime = timestamp; }
          if (timestamp > endTime) { endTime = timestamp; }

          if (entry.type === 'session_meta') {
            id = entry.payload?.id || id;
            workspace = entry.payload?.cwd || workspace;
            model = entry.payload?.model || entry.payload?.model_slug || model;
            // Extract title from common session meta fields
            title = entry.payload?.task || entry.payload?.title || entry.payload?.name || entry.payload?.prompt || title;
            continue;
          }

          // Capture title from first user message if not already found
          if (!title) {
            const role = entry.payload?.role ?? entry.role;
            const content = entry.payload?.content ?? entry.payload?.text ?? entry.content ?? entry.text;
            if (role === 'user' && typeof content === 'string' && content.trim().length > 0) {
              title = content.trim().slice(0, 80).replace(/[\n\r]+/g, ' ');
            }
          }

          if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count') {
            continue;
          }

          const usage = entry.payload?.info?.last_token_usage as TokenUsage | undefined;
          if (!usage) { continue; }

          const inputTokens = this.toTokenCount(usage.input_tokens);
          const outputTokens = this.toTokenCount(usage.output_tokens);
          const thinkingTokens = this.toTokenCount(usage.reasoning_output_tokens);
          const cacheReadTokens = this.toTokenCount(usage.cached_input_tokens);
          const totalTokens = this.toTokenCount(usage.total_tokens) || inputTokens + outputTokens + thinkingTokens;
          if (totalTokens === 0) { continue; }

          interactions.push({
            timestamp,
            model,
            inputTokens,
            outputTokens,
            thinkingTokens,
            cacheReadTokens,
            cacheWriteTokens: 0,
            totalTokens,
            mode: 'agent',
            toolCalls: [],
          });
        } catch { /* skip malformed lines */ }
      }

      if (interactions.length === 0) { return null; }
      interactions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const totalTokens = interactions.reduce((s, i) => s + i.totalTokens, 0);

      const totalInputTokens = interactions.reduce((s, i) => s + i.inputTokens, 0);
      const totalOutputTokens = interactions.reduce((s, i) => s + i.outputTokens, 0);
      const totalCacheReadTokens = interactions.reduce((s, i) => s + i.cacheReadTokens, 0);
      const primaryModel = interactions[interactions.length - 1]?.model || 'gpt-5.3-codex';
      const estimatedCostUsd = calculateCost(primaryModel, totalInputTokens, totalOutputTokens, totalCacheReadTokens, 0);

      return {
        id,
        provider: 'codex',
        providerName: 'Codex',
        startTime: interactions[0].timestamp,
        endTime: interactions[interactions.length - 1].timestamp,
        interactions,
        totalTokens,
        totalInputTokens,
        totalOutputTokens,
        totalThinkingTokens: interactions.reduce((s, i) => s + i.thinkingTokens, 0),
        totalCacheReadTokens,
        totalCacheWriteTokens: 0,
        models: [...new Set(interactions.map(i => i.model))],
        workspace,
        sourceFile: filePath,
        title,
        estimatedCostUsd,
      };
    } catch { return null; }
  }

  private toTokenCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  private parseTimestamp(value: unknown, fallback: Date): Date {
    if (typeof value === 'number' || typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) { return parsed; }
    }
    return fallback;
  }

  private getFileFallbackDate(filePath: string): Date {
    try {
      return fs.statSync(filePath).mtime;
    } catch {
      return new Date(0);
    }
  }
}
