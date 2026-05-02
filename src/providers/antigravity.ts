/**
 * Antigravity (Google Gemini) session log adapter.
 * Reads conversation data from ~/.gemini/antigravity/brain/
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseProvider } from './base';
import { Session, Interaction } from '../types';
import { calculateCost } from '../core/costEstimation';

export class AntigravityProvider extends BaseProvider {
  readonly id = 'antigravity' as const;
  readonly displayName = 'Antigravity';
  private readonly brainDir: string;

  constructor() {
    super();
    this.brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
  }

  getSessionDirectories(): string[] { return [this.brainDir]; }

  async discoverSessionFiles(): Promise<string[]> {
    const files: string[] = [];
    try {
      if (!fs.existsSync(this.brainDir)) { return files; }
      const dirs = fs.readdirSync(this.brainDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) { continue; }
        const p = path.join(this.brainDir, dir.name, '.system_generated', 'logs', 'overview.txt');
        if (fs.existsSync(p)) { files.push(p); }
      }
    } catch { /* skip */ }
    return files;
  }

  async parseSessionFile(filePath: string): Promise<Session | null> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.trim()) { return null; }
      const convDir = path.resolve(filePath, '..', '..', '..');
      const convId = path.basename(convDir);
      const { interactions, startTime, endTime, title } = this.parseOverview(content, filePath);
      if (interactions.length === 0) { return null; }
      const totalTokens = interactions.reduce((s, i) => s + i.totalTokens, 0);
      const totalInputTokens = interactions.reduce((s, i) => s + i.inputTokens, 0);
      const totalOutputTokens = interactions.reduce((s, i) => s + i.outputTokens, 0);
      const primaryModel = interactions[interactions.length - 1]?.model || 'gemini-3.1-pro';
      const estimatedCostUsd = calculateCost(primaryModel, totalInputTokens, totalOutputTokens, 0, 0);

      return {
        id: convId, provider: 'antigravity', providerName: 'Antigravity',
        startTime, endTime,
        interactions, totalTokens,
        totalInputTokens,
        totalOutputTokens,
        totalThinkingTokens: interactions.reduce((s, i) => s + i.thinkingTokens, 0),
        totalCacheReadTokens: 0, totalCacheWriteTokens: 0,
        models: [...new Set(interactions.map(i => i.model))],
        workspace: this.extractWorkspaceFromOverview(content) || convId.substring(0, 8) + '...',
        sourceFile: filePath,
        title,
        estimatedCostUsd,
      };
    } catch { return null; }
  }

  private extractWorkspaceFromOverview(content: string): string | null {
    for (const line of content.split('\n')) {
      if (!line.trim()) { continue; }
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'USER_INPUT' && typeof entry.content === 'string') {
          const match = entry.content.match(/Active Document:\s*(\/[^\s(]+)/);
          if (!match) { continue; }
          let dir = path.dirname(match[1]);
          // Walk up to find project root (git repo or known manifest)
          const markers = ['.git', 'package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml'];
          while (dir !== '/' && dir !== os.homedir()) {
            if (markers.some(m => { try { return fs.existsSync(path.join(dir, m)); } catch { return false; } })) {
              return dir;
            }
            dir = path.dirname(dir);
          }
          return path.dirname(match[1]);
        }
      } catch { /* skip malformed lines */ }
    }
    return null;
  }

  private parseOverview(content: string, filePath: string): {
    interactions: Interaction[];
    startTime: Date;
    endTime: Date;
    title: string | undefined;
  } {
    const interactions: Interaction[] = [];
    let startTime: Date | null = null;
    let endTime: Date | null = null;
    let title: string | undefined;
    let totalTokensEstimate = 0;

    // Parse JSON-line entries to extract real timestamps and token data
    for (const line of content.split('\n')) {
      if (!line.trim()) { continue; }
      try {
        const entry = JSON.parse(line);
        const ts = entry.created_at ? new Date(entry.created_at) : null;
        if (ts && !isNaN(ts.getTime())) {
          if (!startTime) { startTime = ts; }
          endTime = ts;
        }
        // Extract title from first user message
        if (!title && entry.type === 'USER_INPUT' && typeof entry.content === 'string') {
          // Strip metadata wrapper, take first meaningful line
          const raw = entry.content.replace(/<[^>]+>/g, '').trim();
          const firstLine = raw.split('\n').find((l: string) => l.trim().length > 5);
          if (firstLine) { title = firstLine.trim().substring(0, 80); }
        }
        // Use actual token counts if present
        if (typeof entry.input_tokens === 'number' || typeof entry.output_tokens === 'number') {
          const inputTokens = entry.input_tokens || 0;
          const outputTokens = entry.output_tokens || 0;
          interactions.push({
            timestamp: ts || new Date(),
            model: entry.model || 'gemini',
            inputTokens, outputTokens,
            thinkingTokens: entry.thinking_tokens || 0,
            cacheReadTokens: 0, cacheWriteTokens: 0,
            totalTokens: inputTokens + outputTokens,
            mode: 'chat', toolCalls: [],
          });
        } else {
          totalTokensEstimate += this.estimateTokens(JSON.stringify(entry), 0.24);
        }
      } catch { /* skip malformed lines */ }
    }

    // Fallback: if no interactions from real data, estimate from content size
    if (interactions.length === 0) {
      const fileStat = (() => { try { return fs.statSync(filePath); } catch { return null; } })();
      const fallbackEnd = fileStat?.mtime || new Date();
      const totalEst = totalTokensEstimate || this.estimateTokens(content, 0.24);
      if (totalEst >= 10) {
        const turnCount = Math.max(1, (content.match(/(?:^|\n)(?:USER|User|user|MODEL|model|Assistant)[:>]/gim) || []).length / 2);
        const tokensPerTurn = Math.round(totalEst / turnCount);
        for (let i = 0; i < turnCount; i++) {
          interactions.push({
            timestamp: fallbackEnd, model: 'gemini',
            inputTokens: Math.round(tokensPerTurn * 0.3),
            outputTokens: Math.round(tokensPerTurn * 0.7),
            thinkingTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
            totalTokens: tokensPerTurn, mode: 'chat', toolCalls: [],
          });
        }
      }
    }

    // Use file mtime as fallback for timestamps
    const fileStat = (() => { try { return fs.statSync(filePath); } catch { return null; } })();
    const fallbackTime = fileStat?.mtime || new Date();
    return {
      interactions,
      startTime: startTime || fallbackTime,
      endTime: endTime || fallbackTime,
      title,
    };
  }
}
