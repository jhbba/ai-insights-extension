/**
 * Claude Code session log adapter.
 * Reads JSONL files from ~/.claude/projects/ containing per-message token data.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseProvider } from './base';
import { Session, Interaction } from '../types';
import { calculateCost } from '../core/costEstimation';

export class ClaudeCodeProvider extends BaseProvider {
  readonly id = 'claudeCode' as const;
  readonly displayName = 'Claude Code';
  private readonly projectsDir: string;

  constructor() {
    super();
    this.projectsDir = path.join(os.homedir(), '.claude', 'projects');
  }

  getSessionDirectories(): string[] { return [this.projectsDir]; }

  async discoverSessionFiles(): Promise<string[]> {
    const files: string[] = [];
    try {
      if (!fs.existsSync(this.projectsDir)) { return files; }
      this.walkDir(this.projectsDir, files);
    } catch { /* skip */ }
    return files;
  }

  private walkDir(dir: string, files: string[], depth: number = 0): void {
    if (depth > 4) { return; }
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.walkDir(full, files, depth + 1);
        } else if (entry.name.endsWith('.jsonl')) {
          files.push(full);
        }
      }
    } catch { /* skip */ }
  }

  async parseSessionFile(filePath: string): Promise<Session | null> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.trim());
      if (lines.length === 0) { return null; }

      const interactions: Interaction[] = [];
      let startTime: Date | null = null;
      let endTime = new Date();
      let cwd: string | null = null;
      let title: string | undefined;
      const seenMessageIds = new Set<string>();

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          // Extract ai-title before processing usage
          if (entry.type === 'ai-title' && entry.aiTitle) {
            title = entry.aiTitle;
            continue;
          }

          const ts = new Date(entry.timestamp || entry.createdAt || Date.now());
          if (!startTime) { startTime = ts; }
          endTime = ts;
          if (!cwd && entry.cwd) { cwd = entry.cwd; }

          // Claude Code provides actual token counts
          const usage = entry.usage || entry.message?.usage || entry.tokens || {};
          const inputTokens = usage.input_tokens || usage.input || usage.promptTokens || 0;
          const outputTokens = usage.output_tokens || usage.output || usage.completionTokens || 0;
          const cacheReadTokens = usage.cache_read_input_tokens || usage.cache_read || 0;
          const cacheWriteTokens = usage.cache_creation_input_tokens || usage.cache_write || 0;
          const thinkingTokens = usage.thinking_tokens || usage.thinking || 0;
          const model = entry.model || entry.message?.model || 'claude';

          if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0 && model === 'claude') { continue; }

          // Deduplicate: same message appears multiple times across conversation branches
          const msgId = entry.message?.id;
          if (msgId) {
            if (seenMessageIds.has(msgId)) { continue; }
            seenMessageIds.add(msgId);
          }

          interactions.push({
            timestamp: ts,
            model: model,
            inputTokens, outputTokens,
            thinkingTokens,
            cacheReadTokens,
            cacheWriteTokens,
            totalTokens: inputTokens + outputTokens + thinkingTokens + cacheReadTokens + cacheWriteTokens,
            mode: entry.type || entry.role || entry.message?.role || 'chat',
            toolCalls: (entry.tool_calls || entry.toolCalls || []).map((t: any) => t.name || t.function?.name || 'unknown'),
          });
        } catch { /* skip line */ }
      }

      if (interactions.length === 0) { return null; }
      const totalInputTokens = interactions.reduce((s, i) => s + i.inputTokens, 0);
      const totalOutputTokens = interactions.reduce((s, i) => s + i.outputTokens, 0);
      const totalCacheReadTokens = interactions.reduce((s, i) => s + i.cacheReadTokens, 0);
      const totalCacheWriteTokens = interactions.reduce((s, i) => s + i.cacheWriteTokens, 0);
      const primaryModel = interactions[interactions.length - 1]?.model || 'claude';
      const estimatedCostUsd = calculateCost(primaryModel, totalInputTokens, totalOutputTokens, totalCacheReadTokens, totalCacheWriteTokens);

      return {
        id: path.basename(filePath, '.jsonl'),
        provider: 'claudeCode', providerName: 'Claude Code',
        startTime: startTime || new Date(), endTime, interactions,
        totalTokens: interactions.reduce((s, i) => s + i.totalTokens, 0),
        totalInputTokens,
        totalOutputTokens,
        totalThinkingTokens: interactions.reduce((s, i) => s + i.thinkingTokens, 0),
        totalCacheReadTokens,
        totalCacheWriteTokens,
        models: [...new Set(interactions.map(i => i.model))],
        workspace: cwd || this.extractProject(filePath),
        sourceFile: filePath,
        title,
        estimatedCostUsd,
      };
    } catch { return null; }
  }

  private extractProject(filePath: string): string {
    const parts = filePath.split(path.sep);
    const projIdx = parts.indexOf('projects');
    if (projIdx >= 0 && projIdx + 1 < parts.length) {
      return parts[projIdx + 1];
    }
    return 'unknown';
  }
}
