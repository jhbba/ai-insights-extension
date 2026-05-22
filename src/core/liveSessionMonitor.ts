import * as fs from 'fs';
import { Session, ProviderId, LiveSessionState, LiveAlert, LiveBudgetConfig } from '../types';

const LIVE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
const BURN_RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const HIGH_BURN_RATE_TOKENS_PER_MIN = 2_000;
const SPIKE_MULTIPLIER = 3; // burn rate 3× baseline = spike

/**
 * Scan allSessions for sessions modified or interacted with in the last 3 minutes.
 * Returns LiveSessionState[] for the live monitor panel.
 */
export function detectLiveSessions(
  sessions: Session[],
  budgetConfig: LiveBudgetConfig | null,
  allSessionsCostThisWindow: number,
  allSessionsTokensThisWindow: number,
): LiveSessionState[] {
  const now = Date.now();
  const live: LiveSessionState[] = [];

  for (const session of sessions) {
    if (!isLive(session, now)) { continue; }

    const burnRate = computeBurnRate(session, now);
    const elapsedMs = session.endTime.getTime() - session.startTime.getTime();
    const elapsedMinutes = Math.max(0, elapsedMs / 60000);
    const budgetWindowUsedTokens = allSessionsTokensThisWindow;
    const budgetWindowUsedUsd = allSessionsCostThisWindow;

    const projectedExhaustionMinutes = computeProjection(
      burnRate, budgetWindowUsedTokens, budgetConfig,
    );

    const budgetUsedPct = computeBudgetPct(budgetWindowUsedTokens, budgetConfig);
    const resetTime = computeResetTime(budgetConfig);

    const alerts = buildAlerts(
      burnRate,
      projectedExhaustionMinutes,
      budgetUsedPct,
    );

    live.push({
      provider: session.provider,
      sessionId: session.id,
      sessionFilePath: session.sourceFile || '',
      sessionTitle: session.title || session.id,
      sessionStartTime: session.startTime.toISOString(),
      elapsedMinutes,
      currentTokens: session.totalTokens,
      currentInputTokens: session.totalInputTokens,
      currentOutputTokens: session.totalOutputTokens,
      recentBurnRatePerMin: burnRate,
      projectedExhaustionMinutes,
      budgetWindowUsedTokens,
      budgetWindowUsedUsd,
      budgetWindowResetTime: resetTime,
      budgetUsedPct,
      alerts,
      lastUpdated: new Date(now).toISOString(),
    });
  }

  // Sort: most recently active first
  live.sort((a, b) =>
    new Date(b.sessionStartTime).getTime() - new Date(a.sessionStartTime).getTime(),
  );

  return live;
}

/**
 * Aggregate burn rate across all live sessions (tokens/min combined).
 */
export function aggregateLiveBurnRate(states: LiveSessionState[]): number {
  return states.reduce((sum, s) => sum + s.recentBurnRatePerMin, 0);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isLive(session: Session, nowMs: number): boolean {
  // Check last interaction timestamp
  if (session.interactions.length > 0) {
    const last = session.interactions[session.interactions.length - 1];
    const ts = last.timestamp instanceof Date
      ? last.timestamp.getTime()
      : new Date(last.timestamp as any).getTime();
    if (nowMs - ts < LIVE_THRESHOLD_MS) { return true; }
  }

  // Fallback: check file mtime
  if (session.sourceFile) {
    try {
      const mtime = fs.statSync(session.sourceFile).mtime.getTime();
      if (nowMs - mtime < LIVE_THRESHOLD_MS) { return true; }
    } catch {
      // file gone or inaccessible
    }
  }

  return false;
}

function computeBurnRate(session: Session, nowMs: number): number {
  const cutoff = nowMs - BURN_RATE_WINDOW_MS;
  const recent = session.interactions.filter(i => {
    const ts = i.timestamp instanceof Date
      ? i.timestamp.getTime()
      : new Date(i.timestamp as any).getTime();
    return ts >= cutoff;
  });

  if (recent.length < 2) {
    // Fall back to whole-session average if the session itself is short
    const sessionMs = session.endTime.getTime() - session.startTime.getTime();
    const sessionMin = sessionMs / 60000;
    return sessionMin > 0.1 ? session.totalTokens / sessionMin : 0;
  }

  const totalTokens = recent.reduce((sum, i) => sum + i.totalTokens, 0);
  const oldest = recent[0].timestamp instanceof Date
    ? recent[0].timestamp.getTime()
    : new Date(recent[0].timestamp as any).getTime();
  const newest = recent[recent.length - 1].timestamp instanceof Date
    ? recent[recent.length - 1].timestamp.getTime()
    : new Date(recent[recent.length - 1].timestamp as any).getTime();
  const windowMin = (newest - oldest) / 60000;

  return windowMin > 0.1 ? totalTokens / windowMin : 0;
}

function computeProjection(
  burnRatePerMin: number,
  usedTokens: number,
  config: LiveBudgetConfig | null,
): number | null {
  if (!config || burnRatePerMin <= 0) { return null; }
  const limit = config.limitTokens;
  if (!limit) { return null; }
  const remaining = limit - usedTokens;
  if (remaining <= 0) { return 0; }
  return remaining / burnRatePerMin;
}

function computeBudgetPct(usedTokens: number, config: LiveBudgetConfig | null): number | null {
  if (!config?.limitTokens) { return null; }
  return Math.min(100, (usedTokens / config.limitTokens) * 100);
}

function computeResetTime(config: LiveBudgetConfig | null): string | null {
  if (!config) { return null; }
  const now = new Date();

  switch (config.type) {
    case 'daily': {
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      next.setHours(0, 0, 0, 0);
      return next.toISOString();
    }
    case 'weekly': {
      const next = new Date(now);
      const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
      next.setDate(next.getDate() + daysUntilSunday);
      next.setHours(0, 0, 0, 0);
      return next.toISOString();
    }
    case 'monthly': {
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return next.toISOString();
    }
    case 'fixed': {
      return config.fixedWindowEnd ?? null;
    }
    default:
      return null;
  }
}

function buildAlerts(
  burnRate: number,
  projectedExhaustionMinutes: number | null,
  budgetUsedPct: number | null,
): LiveAlert[] {
  const alerts: LiveAlert[] = [];
  const now = new Date().toISOString();

  if (burnRate > HIGH_BURN_RATE_TOKENS_PER_MIN * SPIKE_MULTIPLIER) {
    alerts.push({
      type: 'spike',
      message: `Burn rate ${Math.round(burnRate).toLocaleString()} tokens/min — ${SPIKE_MULTIPLIER}× above normal`,
      severity: 'error',
      timestamp: now,
    });
  } else if (burnRate > HIGH_BURN_RATE_TOKENS_PER_MIN) {
    alerts.push({
      type: 'high_burn',
      message: `High burn rate: ${Math.round(burnRate).toLocaleString()} tokens/min`,
      severity: 'warning',
      timestamp: now,
    });
  }

  if (projectedExhaustionMinutes !== null) {
    if (projectedExhaustionMinutes <= 0) {
      alerts.push({
        type: 'rate_limit_hit',
        message: 'Budget exhausted — rate limit likely',
        severity: 'error',
        timestamp: now,
      });
    } else if (projectedExhaustionMinutes <= 15) {
      alerts.push({
        type: 'rate_limit_imminent',
        message: `Budget exhausted in ~${Math.round(projectedExhaustionMinutes)} min at current burn rate`,
        severity: 'error',
        timestamp: now,
      });
    } else if (projectedExhaustionMinutes <= 60) {
      alerts.push({
        type: 'rate_limit_imminent',
        message: `Budget exhausted in ~${Math.round(projectedExhaustionMinutes)} min`,
        severity: 'warning',
        timestamp: now,
      });
    }
  }

  if (budgetUsedPct !== null && budgetUsedPct >= 90) {
    alerts.push({
      type: 'high_burn',
      message: `${budgetUsedPct.toFixed(0)}% of budget window used`,
      severity: budgetUsedPct >= 95 ? 'error' : 'warning',
      timestamp: now,
    });
  }

  return alerts;
}
