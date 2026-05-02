/**
 * Session aggregator - merges data from all providers into unified metrics.
 */
import { Session, DailyUsage, AggregatedMetrics, ProviderMetrics, ProviderId, AggregationConfig, ModelUsageMetrics } from '../types';
import { calculateCost, calculateCostBreakdown } from './costEstimation';
import { calculateEnvironmentalImpact } from './environmentalImpact';
import { toLocalDateKey } from './dateUtils';
import {
  computeBudgetMetrics,
  computeCacheMetrics,
  computeROIMetrics,
  computeAnomalyFlags,
  computeSessionComplexity,
} from './budgetManager';

export function aggregateSessions(sessions: Session[], config: AggregationConfig = {}): AggregatedMetrics {
  const now = new Date();
  const todayStr = toLocalDateKey(now);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toLocalDateKey(yesterday);

  const todaySessions = sessions.filter(s => toLocalDateKey(s.startTime) === todayStr);
  const yesterdaySessions = sessions.filter(s => toLocalDateKey(s.startTime) === yesterdayStr);
  const currentMonthSessions = sessions.filter(s => s.startTime >= currentMonthStart);
  const lastMonthSessions = sessions.filter(s => s.startTime >= lastMonthStart && s.startTime <= lastMonthEnd);

  const byProvider: Record<ProviderId, ProviderMetrics> = {
    copilot: buildMetrics(sessions.filter(s => s.provider === 'copilot')),
    antigravity: buildMetrics(sessions.filter(s => s.provider === 'antigravity')),
    claudeCode: buildMetrics(sessions.filter(s => s.provider === 'claudeCode')),
    codex: buildMetrics(sessions.filter(s => s.provider === 'codex')),
  };
  const todayByProvider: Record<ProviderId, ProviderMetrics> = {
    copilot: buildMetrics(todaySessions.filter(s => s.provider === 'copilot')),
    antigravity: buildMetrics(todaySessions.filter(s => s.provider === 'antigravity')),
    claudeCode: buildMetrics(todaySessions.filter(s => s.provider === 'claudeCode')),
    codex: buildMetrics(todaySessions.filter(s => s.provider === 'codex')),
  };
  const yesterdayByProvider: Record<ProviderId, ProviderMetrics> = {
    copilot: buildMetrics(yesterdaySessions.filter(s => s.provider === 'copilot')),
    antigravity: buildMetrics(yesterdaySessions.filter(s => s.provider === 'antigravity')),
    claudeCode: buildMetrics(yesterdaySessions.filter(s => s.provider === 'claudeCode')),
    codex: buildMetrics(yesterdaySessions.filter(s => s.provider === 'codex')),
  };
  const currentMonthByProvider: Record<ProviderId, ProviderMetrics> = {
    copilot: buildMetrics(currentMonthSessions.filter(s => s.provider === 'copilot')),
    antigravity: buildMetrics(currentMonthSessions.filter(s => s.provider === 'antigravity')),
    claudeCode: buildMetrics(currentMonthSessions.filter(s => s.provider === 'claudeCode')),
    codex: buildMetrics(currentMonthSessions.filter(s => s.provider === 'codex')),
  };
  const lastMonthByProvider: Record<ProviderId, ProviderMetrics> = {
    copilot: buildMetrics(lastMonthSessions.filter(s => s.provider === 'copilot')),
    antigravity: buildMetrics(lastMonthSessions.filter(s => s.provider === 'antigravity')),
    claudeCode: buildMetrics(lastMonthSessions.filter(s => s.provider === 'claudeCode')),
    codex: buildMetrics(lastMonthSessions.filter(s => s.provider === 'codex')),
  };

  const daily = buildDailyUsage(sessions);
  const todayMetrics = buildMetrics(todaySessions);
  const yesterdayMetrics = buildMetrics(yesterdaySessions);
  const currentMonthMetrics = buildMetrics(currentMonthSessions);
  const lastMonthMetrics = buildMetrics(lastMonthSessions);
  const currentMonthCopilotMetrics = currentMonthByProvider.copilot;

  // Project yearly from current month (extrapolate daily rate × 365)
  const daysElapsed = Math.max(1, now.getDate());
  const yearMultiplier = 365 / daysElapsed;
  const projectedYear: ProviderMetrics = {
    ...currentMonthMetrics,
    totalTokens: Math.round(currentMonthMetrics.totalTokens * yearMultiplier),
    sessions: Math.round(currentMonthMetrics.sessions * yearMultiplier),
    interactions: Math.round(currentMonthMetrics.interactions * yearMultiplier),
    estimatedCost: currentMonthMetrics.estimatedCost * yearMultiplier,
    estimatedCO2Grams: currentMonthMetrics.estimatedCO2Grams * yearMultiplier,
    estimatedWaterLiters: currentMonthMetrics.estimatedWaterLiters * yearMultiplier,
    treeEquivalentYears: currentMonthMetrics.treeEquivalentYears * yearMultiplier,
  };

  const budget = computeBudgetMetrics(now, currentMonthCopilotMetrics, config);
  const cache = computeCacheMetrics(currentMonthCopilotMetrics);
  const roi = computeROIMetrics(currentMonthMetrics, byProvider);
  const anomaly = computeAnomalyFlags(now, sessions, daily, config);
  const sessionComplexity = computeSessionComplexity(sessions, config);

  return {
    today: todayMetrics,
    yesterday: yesterdayMetrics,
    currentMonth: currentMonthMetrics,
    lastMonth: lastMonthMetrics,
    projectedYear,
    byProvider,
    todayByProvider,
    yesterdayByProvider,
    currentMonthByProvider,
    lastMonthByProvider,
    daily,
    budget,
    cache,
    roi,
    anomaly,
    sessionComplexity,
  };
}

function normalizeMode(mode: string, provider: ProviderId): string {
  if (provider === 'claudeCode') { return 'cli'; }
  if (provider === 'codex') { return 'agent'; }
  if (provider === 'antigravity') { return 'ask'; }
  const m = (mode || '').toLowerCase();
  if (m === 'edit') { return 'edit'; }
  if (m === 'agent') { return 'agent'; }
  if (m === 'plan') { return 'plan'; }
  if (m === 'customagent' || m === 'custom_agent') { return 'customAgent'; }
  return 'ask';
}

function buildMetrics(sessions: Session[]): ProviderMetrics {
  const totalTokens = sessions.reduce((s, sess) => s + sess.totalTokens, 0);
  const inputTokens = sessions.reduce((s, sess) => s + sess.totalInputTokens, 0);
  const outputTokens = sessions.reduce((s, sess) => s + sess.totalOutputTokens, 0);
  const thinkingTokens = sessions.reduce((s, sess) => s + sess.totalThinkingTokens, 0);
  const cacheReadTokens = sessions.reduce((s, sess) => s + sess.totalCacheReadTokens, 0);
  const cacheWriteTokens = sessions.reduce((s, sess) => s + sess.totalCacheWriteTokens, 0);
  const totalInteractions = sessions.reduce((s, sess) => s + sess.interactions.length, 0);

  let cost = 0;
  let cacheSavingsUsd = 0;

  const modelBreakdown: Record<string, number> = {};
  const providerBreakdown: Record<string, number> = {};
  const toolCalls: Record<string, number> = {};
  const repositories: Record<string, number> = {};
  const modeBreakdown: Record<string, number> = {};
  const costByModel: Record<string, number> = {};
  const modelUsage: Record<string, ModelUsageMetrics> = {};
  const costByRepository: Record<string, number> = {};

  for (const sess of sessions) {
    providerBreakdown[sess.providerName] = (providerBreakdown[sess.providerName] || 0) + sess.totalTokens;
    const repoName = sess.workspace ? sess.workspace.split(/[/\\]/).pop() || 'Unknown' : 'Unknown';
    repositories[repoName] = (repositories[repoName] || 0) + sess.totalTokens;

    let sessCost = 0;
    for (const i of sess.interactions) {
      const modelKey = i.model || 'Unknown';
      modelBreakdown[modelKey] = (modelBreakdown[modelKey] || 0) + i.totalTokens;
      const mode = normalizeMode(i.mode, sess.provider);
      modeBreakdown[mode] = (modeBreakdown[mode] || 0) + 1;

      if (i.toolCalls) {
        for (const t of i.toolCalls) {
          toolCalls[t] = (toolCalls[t] || 0) + 1;
        }
      }

      const costBreakdown = calculateCostBreakdown(i.model, i.inputTokens, i.outputTokens, i.cacheReadTokens, i.cacheWriteTokens);
      const iCost = costBreakdown.totalCost;
      cost += iCost;
      sessCost += iCost;
      costByModel[modelKey] = (costByModel[modelKey] || 0) + iCost;
      const model = modelUsage[modelKey] ?? {
        totalTokens: 0,
        inputTokens: 0,
        uncachedInputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputCost: 0,
        cachedInputCost: 0,
        outputCost: 0,
        cacheWriteCost: 0,
        totalCost: 0,
        inputCostPerMillion: costBreakdown.inputCostPerMillion,
        cachedInputCostPerMillion: costBreakdown.cachedInputCostPerMillion,
        outputCostPerMillion: costBreakdown.outputCostPerMillion,
        cacheCreationCostPerMillion: costBreakdown.cacheCreationCostPerMillion,
        pricingSource: costBreakdown.pricingSource,
      };
      model.totalTokens += i.totalTokens;
      model.inputTokens += i.inputTokens;
      model.uncachedInputTokens += Math.max(0, i.inputTokens - i.cacheReadTokens - i.cacheWriteTokens);
      model.outputTokens += i.outputTokens;
      model.thinkingTokens += i.thinkingTokens;
      model.cacheReadTokens += i.cacheReadTokens;
      model.cacheWriteTokens += i.cacheWriteTokens;
      model.inputCost += costBreakdown.inputCost;
      model.cachedInputCost += costBreakdown.cachedInputCost;
      model.outputCost += costBreakdown.outputCost;
      model.cacheWriteCost += costBreakdown.cacheWriteCost;
      model.totalCost += iCost;
      if (costBreakdown.pricingSource === 'fallback') {
        model.pricingSource = 'fallback';
      }
      modelUsage[modelKey] = model;

      // Compute cache savings: what would it have cost with no caching?
      if (i.cacheReadTokens > 0) {
        const costWithoutCache = calculateCost(i.model, i.inputTokens + i.cacheReadTokens, i.outputTokens, 0, 0);
        const costWithCache = iCost;
        cacheSavingsUsd += Math.max(0, costWithoutCache - costWithCache);
      }
    }

    costByRepository[repoName] = (costByRepository[repoName] || 0) + sessCost;
  }

  const env = calculateEnvironmentalImpact(totalTokens);

  return {
    totalTokens, inputTokens, outputTokens, thinkingTokens,
    cacheReadTokens, cacheWriteTokens, cacheSavingsUsd,
    sessions: sessions.length, interactions: totalInteractions,
    averageTokensPerSession: sessions.length > 0 ? Math.round(totalTokens / sessions.length) : 0,
    averageInteractionsPerSession: sessions.length > 0 ? Math.round(totalInteractions / sessions.length) : 0,
    estimatedCost: cost,
    estimatedCO2Grams: env.co2Grams,
    estimatedWaterLiters: env.waterLiters,
    treeEquivalentYears: env.treeEquivalentYears,
    modelBreakdown, providerBreakdown,
    toolCalls, repositories, modeBreakdown,
    costByModel, modelUsage, costByRepository,
  };
}

function buildDailyUsage(sessions: Session[]): DailyUsage[] {
  const byDay = new Map<string, DailyUsage>();

  for (const sess of sessions) {
    const dateStr = toLocalDateKey(sess.startTime);
    let day = byDay.get(dateStr);
    if (!day) {
      day = {
        date: dateStr, provider: sess.provider,
        totalTokens: 0, inputTokens: 0, outputTokens: 0,
        thinkingTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        sessions: 0, interactions: 0, estimatedCost: 0,
        models: {}, toolCalls: {}, repositories: {},
      };
      byDay.set(dateStr, day);
    }
    day.totalTokens += sess.totalTokens;
    day.inputTokens += sess.totalInputTokens;
    day.outputTokens += sess.totalOutputTokens;
    day.thinkingTokens += sess.totalThinkingTokens;
    day.cacheReadTokens += sess.totalCacheReadTokens;
    day.cacheWriteTokens += sess.totalCacheWriteTokens;
    day.sessions += 1;
    day.interactions += sess.interactions.length;

    const repoName = sess.workspace ? sess.workspace.split(/[/\\]/).pop() || 'Unknown' : 'Unknown';
    day.repositories[repoName] = (day.repositories[repoName] || 0) + sess.totalTokens;

    for (const i of sess.interactions) {
      day.models[i.model] = (day.models[i.model] || 0) + i.totalTokens;
      day.estimatedCost += calculateCost(i.model, i.inputTokens, i.outputTokens, i.cacheReadTokens, i.cacheWriteTokens);
      for (const t of i.toolCalls) {
        day.toolCalls[t] = (day.toolCalls[t] || 0) + 1;
      }
    }
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}
