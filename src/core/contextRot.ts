import { Session } from '../types';
import {
  ContextRotAnalysis,
  ContextTimelinePoint,
  OverloadSignal,
  FreshSessionBrief,
} from '../types';

/** Backward-compatible score shape (subset of ContextRotAnalysis) */
export type ContextRotScore = Pick<
  ContextRotAnalysis,
  'score' | 'label' | 'turnsCount' | 'sessionAgeMinutes' | 'inputBloatFactor' | 'outputDeclineFactor'
>;

/**
 * Fast, lightweight health score — backward-compatible entry point used by
 * sessionsView to render the per-row badge.
 */
export function computeContextRotScore(session: Session): ContextRotScore {
  const a = computeContextRotAnalysis(session);
  return {
    score: a.score,
    label: a.label,
    turnsCount: a.turnsCount,
    sessionAgeMinutes: a.sessionAgeMinutes,
    inputBloatFactor: a.inputBloatFactor,
    outputDeclineFactor: a.outputDeclineFactor,
  };
}

/**
 * Full workbench analysis: score + timeline + overload signals +
 * rehydration checklist + fresh-session brief.
 */
export function computeContextRotAnalysis(session: Session): ContextRotAnalysis {
  const interactions = session.interactions;
  const turnsCount = interactions.length;
  const sessionAgeMinutes =
    (session.endTime.getTime() - session.startTime.getTime()) / 60000;

  // ── Bloat / decline factors ────────────────────────────────────────────────
  let inputBloatFactor = 1;
  let outputDeclineFactor = 1;

  if (turnsCount >= 6) {
    const third = Math.floor(turnsCount / 3);
    const firstThird = interactions.slice(0, third);
    const lastThird = interactions.slice(turnsCount - third);

    const avgInFirst = avg(firstThird.map(i => i.inputTokens));
    const avgInLast = avg(lastThird.map(i => i.inputTokens));
    inputBloatFactor = avgInFirst > 0 ? avgInLast / avgInFirst : 1;

    const avgOutFirst = avg(firstThird.map(i => i.outputTokens));
    const avgOutLast = avg(lastThird.map(i => i.outputTokens));
    outputDeclineFactor = avgOutFirst > 0 ? avgOutLast / avgOutFirst : 1;
  }

  // ── Base score ─────────────────────────────────────────────────────────────
  let score = 0;
  if (turnsCount > 80) { score += 2; }
  else if (turnsCount > 40) { score += 1; }

  if (sessionAgeMinutes > 120) { score += 2; }
  else if (sessionAgeMinutes > 60) { score += 1; }

  if (inputBloatFactor > 4) { score += 3; }
  else if (inputBloatFactor > 2) { score += 2; }
  else if (inputBloatFactor > 1.5) { score += 1; }

  if (outputDeclineFactor < 0.4) { score += 2; }
  else if (outputDeclineFactor < 0.65) { score += 1; }

  if (session.totalInputTokens > 200_000) { score += 2; }
  else if (session.totalInputTokens > 80_000) { score += 1; }

  score = Math.min(10, score);
  const label = score >= 7 ? 'stale' : score >= 4 ? 'warning' : 'healthy';

  // ── Per-turn timeline ──────────────────────────────────────────────────────
  const timeline: ContextTimelinePoint[] = interactions.map((inter, idx) => ({
    turnIndex: idx,
    inputTokens: inter.inputTokens,
    outputTokens: inter.outputTokens,
    thinkingTokens: inter.thinkingTokens,
    toolCallCount: inter.toolCalls?.length ?? 0,
    cacheHit: inter.cacheReadTokens > 0,
    timestamp:
      inter.timestamp instanceof Date
        ? inter.timestamp.toISOString()
        : String(inter.timestamp),
  }));

  // ── Heavy tool usage (called 3+ times total) ───────────────────────────────
  const toolFreq: Record<string, number> = {};
  for (const inter of interactions) {
    for (const tool of inter.toolCalls ?? []) {
      toolFreq[tool] = (toolFreq[tool] ?? 0) + 1;
    }
  }
  const heavyToolUsage = Object.entries(toolFreq)
    .filter(([, n]) => n >= 3)
    .sort(([, a], [, b]) => b - a)
    .map(([t]) => t);

  // ── Repeated prompt fragments ──────────────────────────────────────────────
  const repeatedPromptFragments = extractRepeatedFragments(interactions.map(i => i.promptPreview ?? ''));

  // ── Overload signals ───────────────────────────────────────────────────────
  const overloadSignals = detectOverloadSignals(
    session, turnsCount, sessionAgeMinutes, inputBloatFactor, outputDeclineFactor,
  );

  // ── Restart recommendation ─────────────────────────────────────────────────
  const criticalSignals = overloadSignals.filter(s => s.severity === 'high');
  const restartRecommended = score >= 7 || criticalSignals.length >= 2;
  const restartReason = restartRecommended
    ? buildRestartReason(score, criticalSignals)
    : '';

  // ── Rehydration checklist ──────────────────────────────────────────────────
  const rehydrationChecklist = buildRehydrationChecklist(
    session, overloadSignals, heavyToolUsage,
  );

  // ── Fresh session brief ────────────────────────────────────────────────────
  const freshSessionBrief = buildFreshSessionBrief(session, overloadSignals);

  return {
    score,
    label,
    turnsCount,
    sessionAgeMinutes,
    inputBloatFactor,
    outputDeclineFactor,
    timeline,
    overloadSignals,
    repeatedPromptFragments,
    heavyToolUsage,
    restartRecommended,
    restartReason,
    rehydrationChecklist,
    freshSessionBrief,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) { return 0; }
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function detectOverloadSignals(
  session: Session,
  turnsCount: number,
  sessionAgeMinutes: number,
  inputBloatFactor: number,
  outputDeclineFactor: number,
): OverloadSignal[] {
  const signals: OverloadSignal[] = [];

  // High input/output ratio
  const ioRatio = session.totalOutputTokens > 0
    ? session.totalInputTokens / session.totalOutputTokens
    : 0;
  if (ioRatio > 20) {
    signals.push({
      type: 'high_input_output_ratio',
      severity: 'high',
      message: 'Extreme input/output imbalance',
      detail: `${ioRatio.toFixed(0)}× more input than output — context is dominated by accumulated history rather than new generation.`,
    });
  } else if (ioRatio > 8) {
    signals.push({
      type: 'high_input_output_ratio',
      severity: 'medium',
      message: 'High input/output ratio',
      detail: `${ioRatio.toFixed(0)}× more input than output. Consider summarizing previous context before continuing.`,
    });
  }

  // Long turn chain
  if (turnsCount > 80) {
    signals.push({
      type: 'long_turn_chain',
      severity: 'high',
      message: `Very long session (${turnsCount} turns)`,
      detail: 'Sessions above 80 turns accumulate stale instructions, resolved tool errors, and outdated context that can mislead the model.',
    });
  } else if (turnsCount > 40) {
    signals.push({
      type: 'long_turn_chain',
      severity: 'medium',
      message: `Long session (${turnsCount} turns)`,
      detail: 'Sessions above 40 turns often carry diminishing returns. Consider a fresh session with a rehydration brief.',
    });
  }

  // Large static context
  if (session.totalInputTokens > 200_000) {
    signals.push({
      type: 'large_static_context',
      severity: 'high',
      message: `Very large context (${(session.totalInputTokens / 1000).toFixed(0)}K input tokens)`,
      detail: 'Context exceeds 200K tokens. Model attention may degrade on early instructions and key details may be lost in the middle.',
    });
  } else if (session.totalInputTokens > 80_000) {
    signals.push({
      type: 'large_static_context',
      severity: 'medium',
      message: `Large context (${(session.totalInputTokens / 1000).toFixed(0)}K input tokens)`,
      detail: 'Context above 80K tokens. Monitor for the "lost in the middle" effect on early system prompts.',
    });
  }

  // Output collapse
  if (outputDeclineFactor < 0.4 && turnsCount >= 6) {
    signals.push({
      type: 'output_collapse',
      severity: 'high',
      message: 'Severe output collapse',
      detail: `Output in the last third of this session is ${(outputDeclineFactor * 100).toFixed(0)}% of the first third. The model may be stuck, refusing, or losing coherence.`,
    });
  } else if (outputDeclineFactor < 0.65 && turnsCount >= 6) {
    signals.push({
      type: 'output_collapse',
      severity: 'medium',
      message: 'Output quality declining',
      detail: `Output volume dropped to ${(outputDeclineFactor * 100).toFixed(0)}% of early-session levels. Consider restructuring the task or starting fresh.`,
    });
  }

  // Tool loop: any single tool called more than 5 times
  const toolFreq: Record<string, number> = {};
  for (const inter of session.interactions) {
    for (const tool of inter.toolCalls ?? []) {
      toolFreq[tool] = (toolFreq[tool] ?? 0) + 1;
    }
  }
  const loopedTools = Object.entries(toolFreq).filter(([, n]) => n > 5);
  if (loopedTools.length > 0) {
    const examples = loopedTools.slice(0, 2).map(([t, n]) => `${t} (×${n})`).join(', ');
    signals.push({
      type: 'tool_loop',
      severity: loopedTools.some(([, n]) => n > 10) ? 'high' : 'medium',
      message: 'Repeated tool calls detected',
      detail: `Tools called many times: ${examples}. This may indicate a stuck retry loop or a task that would benefit from a different approach.`,
    });
  }

  // Session age as a standalone low signal
  if (sessionAgeMinutes > 180) {
    signals.push({
      type: 'long_turn_chain',
      severity: 'medium',
      message: `Session running for ${Math.round(sessionAgeMinutes / 60 * 10) / 10}h`,
      detail: 'Very long session wall-clock time. Instructions added at the start may be poorly recalled.',
    });
  }

  return signals;
}

function extractRepeatedFragments(previews: string[]): string[] {
  const nonEmpty = previews.filter(p => p && p.trim().length > 20);
  const counts: Record<string, number> = {};

  // Use the first 40 chars of each preview as a fingerprint
  for (const p of nonEmpty) {
    const key = p.trim().slice(0, 40).toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return Object.entries(counts)
    .filter(([, n]) => n >= 2)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k);
}

function buildRestartReason(score: number, criticalSignals: OverloadSignal[]): string {
  if (criticalSignals.length > 0) {
    return criticalSignals[0].message;
  }
  if (score >= 9) { return 'Context is severely bloated — model quality will be poor.'; }
  if (score >= 7) { return 'Context health is stale — fresh session recommended.'; }
  return 'Multiple warning signals detected.';
}

function buildRehydrationChecklist(
  session: Session,
  signals: OverloadSignal[],
  heavyTools: string[],
): string[] {
  const items: string[] = [];

  // Always-present items
  items.push(`Open a new session in ${session.workspace ? session.workspace.split('/').pop() || session.workspace : 'the project'}`);

  // Goal from first interaction
  const firstPrompt = session.interactions[0]?.promptPreview;
  if (firstPrompt) {
    items.push(`Restate goal: "${firstPrompt.slice(0, 80).trim()}${firstPrompt.length > 80 ? '…' : ''}"`);
  }

  // If there were write tool calls, mention reviewing recent changes
  if (heavyTools.some(t => /edit|write|create|patch|modify/i.test(t))) {
    items.push('Review and include recent file changes (git diff or relevant files)');
  }

  // If output collapsed, mention what was last attempted
  if (signals.some(s => s.type === 'output_collapse')) {
    const lastPrompt = session.interactions[session.interactions.length - 1]?.promptPreview;
    if (lastPrompt) {
      items.push(`Last attempted: "${lastPrompt.slice(0, 80).trim()}${lastPrompt.length > 80 ? '…' : ''}"`);
    }
    items.push('Describe what was partially done and what remains');
  }

  // If tool loop, mention the approach to avoid
  if (signals.some(s => s.type === 'tool_loop')) {
    items.push('Describe the failed approach to avoid re-entering the same loop');
  }

  // If large context, suggest scoping
  if (signals.some(s => s.type === 'large_static_context')) {
    items.push('Limit initial context: include only the files directly relevant to the next step');
  }

  // Generic close
  items.push('Define the single next action to complete');

  return items;
}

function buildFreshSessionBrief(session: Session, signals: OverloadSignal[]): FreshSessionBrief {
  const interactions = session.interactions;

  const goal = interactions[0]?.promptPreview
    ? interactions[0].promptPreview.slice(0, 200)
    : 'No prompt preview available';

  // Infer write operations from tool call names
  const writeTriggers = new Set<string>();
  for (const inter of interactions) {
    for (const tool of inter.toolCalls ?? []) {
      if (/edit|write|create|patch|modify|insert|delete/i.test(tool)) {
        writeTriggers.add(tool);
      }
    }
  }
  const writeOperations = [...writeTriggers];

  // Last 3 user prompts (most recent first)
  const recentContext = interactions
    .slice(-4, -1)
    .reverse()
    .map(i => (i.promptPreview ?? '').slice(0, 120))
    .filter(Boolean);

  const nextAction = interactions[interactions.length - 1]?.promptPreview
    ? interactions[interactions.length - 1].promptPreview!.slice(0, 150)
    : '';

  const warnings = signals
    .filter(s => s.severity !== 'low')
    .map(s => s.message);

  return { goal, writeOperations, recentContext, nextAction, warnings };
}
