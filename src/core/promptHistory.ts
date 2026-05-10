import { Session, ProviderId } from '../types';
import { calculateCost } from './costEstimation';

/**
 * Minimum gap between consecutive interactions (ms) that signals a new user prompt.
 * Agentic tool-call chains typically fire within seconds of each other; a gap longer
 * than this threshold means the user sent a new message.
 */
const PROMPT_GAP_MS = 120_000; // 2 minutes

export interface PromptRecord {
  timestamp: Date;
  provider: ProviderId;
  sessionId: string;
  /** Most-used model (by output tokens) across all turns in this prompt */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
  /** Wall-clock time from first agent turn to last turn (total agent "thinking" time) */
  responseMs: number;
  fileContext: string;
  /** Number of agent turns (tool calls, sub-calls) that made up this prompt response */
  turnCount: number;
  /** First ~200 chars of the user message that triggered this prompt */
  promptPreview?: string;
  /** Path to the raw session log file */
  sourceFile: string;
}

export class PromptHistoryStore {
  private records: PromptRecord[] = [];

  update(sessions: Session[]): void {
    const all: PromptRecord[] = [];

    for (const session of sessions) {
      const interactions = [...(session.interactions || [])].sort(
        (a, b) => toMs(a.timestamp) - toMs(b.timestamp),
      );
      if (interactions.length === 0) { continue; }

      // Group interactions into prompt-level records by time-gap
      const groups: (typeof interactions)[] = [];
      let current: typeof interactions = [interactions[0]];

      for (let i = 1; i < interactions.length; i++) {
        const gap = toMs(interactions[i].timestamp) - toMs(interactions[i - 1].timestamp);
        if (gap > PROMPT_GAP_MS) {
          groups.push(current);
          current = [];
        }
        current.push(interactions[i]);
      }
      groups.push(current);

      for (const group of groups) {
        const first = group[0];
        const last = group[group.length - 1];

        const inputTokens = group.reduce((s, ix) => s + ix.inputTokens, 0);
        const outputTokens = group.reduce((s, ix) => s + ix.outputTokens, 0);
        const cachedTokens = group.reduce((s, ix) => s + ix.cacheReadTokens, 0);
        const cacheWriteTokens = group.reduce((s, ix) => s + ix.cacheWriteTokens, 0);
        const responseMs = Math.max(0, toMs(last.timestamp) - toMs(first.timestamp));

        // Pick the model with the most output tokens as the "primary" model
        const modelOutput: Record<string, number> = {};
        for (const ix of group) {
          modelOutput[ix.model] = (modelOutput[ix.model] ?? 0) + ix.outputTokens;
        }
        const primaryModel = Object.entries(modelOutput)
          .sort((a, b) => b[1] - a[1])[0]?.[0] ?? first.model;

        // Compute cost per model using its own pricing
        let totalCost = 0;
        for (const ix of group) {
          totalCost += calculateCost(ix.model, ix.inputTokens, ix.outputTokens, ix.cacheReadTokens, ix.cacheWriteTokens);
        }

        // Use the first interaction's preview — it's closest to the user's message
        const promptPreview = group.find(ix => ix.promptPreview)?.promptPreview;

        all.push({
          timestamp: first.timestamp instanceof Date ? first.timestamp : new Date(first.timestamp),
          provider: session.provider,
          sessionId: session.id,
          model: primaryModel,
          inputTokens,
          outputTokens,
          cachedTokens,
          cost: totalCost,
          responseMs,
          fileContext: session.workspace || '',
          turnCount: group.length,
          promptPreview,
          sourceFile: session.sourceFile || '',
        });
      }
    }

    this.records = all.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  getRecent(n = 10): PromptRecord[] {
    return this.records.slice(0, n);
  }

  getAll(): PromptRecord[] {
    return this.records;
  }

  get size(): number {
    return this.records.length;
  }
}

function toMs(ts: Date | string | number): number {
  if (ts instanceof Date) { return ts.getTime(); }
  return new Date(ts).getTime();
}
