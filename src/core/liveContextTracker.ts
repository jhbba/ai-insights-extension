import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ClaudeCodeProvider } from '../providers/claudeCode';
import { computeContextRotScore } from './contextRot';

const LIVE_THRESHOLD_MS = 3 * 60 * 1000;
const EXPIRE_AFTER_MS = 3 * 60 * 1000;
const DEBOUNCE_MS = 1500;
const CONTEXT_LIMIT_TOKENS = 200_000;

export interface LiveContextInfo {
  sessionTitle: string | undefined;
  /** inputTokens + cacheReadTokens for the most recent turn — approx context window usage */
  lastInputTokens: number;
  contextLimitTokens: number;
  contextPct: number;
  healthLabel: 'healthy' | 'warning' | 'stale';
  healthScore: number;
  turnsCount: number;
  totalSessionTokens: number;
  cacheEfficiencyPct: number;
}

/**
 * Watches ~/.claude/projects/**\/*.jsonl via VS Code's file system watcher and
 * emits live context health info within ~1.5 s of each Claude Code turn completing.
 * Fires onUpdate(null) after EXPIRE_AFTER_MS of inactivity to clear the status bar.
 */
export class LiveContextTracker implements vscode.Disposable {
  private readonly projectsDir: string;
  private readonly provider: ClaudeCodeProvider;
  private readonly onUpdate: (info: LiveContextInfo | null) => void;
  private latestInfo: LiveContextInfo | null = null;
  private expireTimer: NodeJS.Timeout | undefined;
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(onUpdate: (info: LiveContextInfo | null) => void) {
    this.projectsDir = path.join(os.homedir(), '.claude', 'projects');
    this.provider = new ClaudeCodeProvider();
    this.onUpdate = onUpdate;
  }

  start(subscriptions: vscode.Disposable[]): void {
    try {
      const base = vscode.Uri.file(this.projectsDir);
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(base, '**/*.jsonl'),
      );
      watcher.onDidCreate(uri => this.schedule(uri.fsPath), null, subscriptions);
      watcher.onDidChange(uri => this.schedule(uri.fsPath), null, subscriptions);
      subscriptions.push(watcher);
    } catch {
      // Watcher unavailable — status bar falls back to the 30s polling timer.
    }
  }

  getLatest(): LiveContextInfo | null {
    return this.latestInfo;
  }

  dispose(): void {
    if (this.expireTimer) { clearTimeout(this.expireTimer); }
    for (const t of this.debounceTimers.values()) { clearTimeout(t); }
    this.debounceTimers.clear();
  }

  private schedule(filePath: string): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) { clearTimeout(existing); }
    const t = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      void this.process(filePath);
    }, DEBOUNCE_MS);
    this.debounceTimers.set(filePath, t);
  }

  private async process(filePath: string): Promise<void> {
    try {
      const session = await this.provider.parseSessionFile(filePath);
      if (!session) { return; }

      const realInteractions = session.interactions.filter(i => !i.isCompactionEvent);
      if (realInteractions.length === 0) { return; }

      const last = realInteractions[realInteractions.length - 1];
      const lastTs = last.timestamp instanceof Date
        ? last.timestamp.getTime()
        : new Date(last.timestamp as unknown as string).getTime();

      if (Date.now() - lastTs > LIVE_THRESHOLD_MS) { return; }

      const score = computeContextRotScore(session);
      const lastInputTokens = last.inputTokens + last.cacheReadTokens;

      this.latestInfo = {
        sessionTitle: session.title,
        lastInputTokens,
        contextLimitTokens: CONTEXT_LIMIT_TOKENS,
        contextPct: Math.min(100, Math.round(lastInputTokens / CONTEXT_LIMIT_TOKENS * 100)),
        healthLabel: score.label,
        healthScore: score.score,
        turnsCount: score.turnsCount,
        totalSessionTokens: session.totalTokens,
        cacheEfficiencyPct: score.cacheEfficiencyRate,
      };
      this.onUpdate(this.latestInfo);

      if (this.expireTimer) { clearTimeout(this.expireTimer); }
      this.expireTimer = setTimeout(() => {
        this.latestInfo = null;
        this.onUpdate(null);
      }, EXPIRE_AFTER_MS);
    } catch { /* ignore parse errors */ }
  }
}
