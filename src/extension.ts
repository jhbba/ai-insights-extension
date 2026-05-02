/**
 * AI Insights - Token Tracker for VS Code
 *
 * Tracks token usage across GitHub Copilot, Antigravity, Claude Code, and Codex.
 * Reads local session log files - nothing leaves your machine.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { CopilotProvider } from './providers/copilot';
import { AntigravityProvider } from './providers/antigravity';
import { ClaudeCodeProvider } from './providers/claudeCode';
import { CodexProvider } from './providers/codex';
import { BaseProvider } from './providers/base';
import { CacheManager } from './core/cacheManager';
import { aggregateSessions } from './core/sessionAggregator';
import { DashboardProvider } from './webview/dashboard';
import { ChartsProvider } from './webview/charts';
import { DiagnosticsProvider } from './webview/diagnostics';
import { UsageAnalysisProvider } from './webview/usageAnalysis';
import { SessionsViewProvider } from './webview/sessionsView';
import { PricingViewProvider } from './webview/pricingView';
import { buildHygieneReports } from './core/repositoryHygiene';
import { Session, AggregatedMetrics, AggregationConfig, AlertThresholds } from './types';

let statusBarItem: vscode.StatusBarItem;
let refreshTimer: NodeJS.Timeout | undefined;
let allSessions: Session[] = [];
let latestMetrics: AggregatedMetrics | null = null;
const cacheManager = new CacheManager();
const DEFAULT_SESSION_LOOKBACK_DAYS = 30;

export function activate(context: vscode.ExtensionContext) {
  console.log('[AI Insights] Activating extension...');

  const providers = getEnabledProviders();

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'aiInsights.showDashboard';
  statusBarItem.tooltip = 'AI Insights - Click for dashboard';
  statusBarItem.text = '$(pulse) Loading...';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('aiInsights.refresh', () => refresh(providers)),
    vscode.commands.registerCommand('aiInsights.showDashboard', () => showDashboard(context)),
    vscode.commands.registerCommand('aiInsights.showCharts', () => showCharts(context)),
    vscode.commands.registerCommand('aiInsights.showDiagnostics', () => showDiagnostics(context, providers)),
    vscode.commands.registerCommand('aiInsights.showUsageAnalysis', () => showUsageAnalysis(context)),
    vscode.commands.registerCommand('aiInsights.showSessions', () => showSessionsView(context)),
    vscode.commands.registerCommand('aiInsights.showSessionsView', () => showSessionsView(context)),
    vscode.commands.registerCommand('aiInsights.showPricing', () => showPricing(context)),
  );

  refresh(providers);

  const config = vscode.workspace.getConfiguration('aiInsights');
  const intervalMin = config.get<number>('refreshIntervalMinutes', 5);
  refreshTimer = setInterval(() => refresh(providers), intervalMin * 60 * 1000);
  context.subscriptions.push({ dispose: () => { if (refreshTimer) { clearInterval(refreshTimer); } } });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('aiInsights')) {
        if (refreshTimer) { clearInterval(refreshTimer); }
        const newConfig = vscode.workspace.getConfiguration('aiInsights');
        const newInterval = newConfig.get<number>('refreshIntervalMinutes', 5);
        const newProviders = getEnabledProviders();
        refreshTimer = setInterval(() => refresh(newProviders), newInterval * 60 * 1000);
        refresh(newProviders);
      }
    }),
  );

  console.log('[AI Insights] Extension activated successfully');
}

export function deactivate() {
  if (refreshTimer) { clearInterval(refreshTimer); }
}

function getEnabledProviders(): BaseProvider[] {
  const config = vscode.workspace.getConfiguration('aiInsights');
  const providers: BaseProvider[] = [];

  if (config.get<boolean>('providers.copilot.enabled', true)) {
    providers.push(new CopilotProvider());
  }
  if (config.get<boolean>('providers.antigravity.enabled', true)) {
    providers.push(new AntigravityProvider());
  }
  if (config.get<boolean>('providers.claudeCode.enabled', true)) {
    providers.push(new ClaudeCodeProvider());
  }
  if (config.get<boolean>('providers.codex.enabled', true)) {
    providers.push(new CodexProvider());
  }

  return providers;
}

function getAggregationConfig(): AggregationConfig {
  const cfg = vscode.workspace.getConfiguration('aiInsights');
  const thresholds: AlertThresholds = {
    budgetWarningPct: cfg.get<number>('alertThresholds.budgetWarningPct', 80),
    budgetCriticalPct: cfg.get<number>('alertThresholds.budgetCriticalPct', 95),
    runawaySessionTokens: cfg.get<number>('alertThresholds.runawaySessionTokens', 100_000),
    runawaySessionCostUsd: cfg.get<number>('alertThresholds.runawaySessionCostUsd', 1.0),
  };
  return {
    planBudget: cfg.get<number>('copilotPlanBudget', 10),
    teamSize: cfg.get<number>('teamSize', 1),
    alertThresholds: thresholds,
  };
}

function getSessionLookbackDays(): number {
  const cfg = vscode.workspace.getConfiguration('aiInsights');
  const days = cfg.get<number>('sessionLookbackDays', DEFAULT_SESSION_LOOKBACK_DAYS);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_SESSION_LOOKBACK_DAYS;
}

function getSessionCutoff(): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - getSessionLookbackDays());
  return cutoff;
}

function wasFileModifiedSince(filePath: string, cutoff: Date): boolean {
  try {
    return fs.statSync(filePath).mtime >= cutoff;
  } catch {
    return false;
  }
}

function isSessionRecent(session: Session, cutoff: Date): boolean {
  return session.startTime >= cutoff;
}

async function refresh(providers: BaseProvider[]) {
  try {
    const sessions: Session[] = [];
    const cutoff = getSessionCutoff();

    for (const provider of providers) {
      const files = await provider.discoverSessionFiles();

      for (const file of files) {
        if (!wasFileModifiedSince(file, cutoff)) {
          continue;
        }

        if (!cacheManager.needsUpdate(file)) {
          const cached = cacheManager.get(file);
          if (cached && isSessionRecent(cached, cutoff)) { sessions.push(cached); }
          continue;
        }

        try {
          const session = await provider.parseSessionFile(file);
          if (session !== null) { cacheManager.set(file, session); }
          if (session && isSessionRecent(session, cutoff)) { sessions.push(session); }
        } catch {
          // Skip failed files silently
        }
      }
    }

    allSessions = dedupeSessions(sessions);
    latestMetrics = aggregateSessions(allSessions, getAggregationConfig());
    updateStatusBar(latestMetrics);
  } catch (err) {
    console.error('[AI Insights] Refresh failed:', err);
    statusBarItem.text = '$(warning) AI Insights: Error';
  }
}

function dedupeSessions(sessions: Session[]): Session[] {
  const byKey = new Map<string, Session>();

  for (const session of sessions) {
    const key = `${session.provider}:${session.id}`;
    const existing = byKey.get(key);
    if (!existing || session.endTime > existing.endTime || session.totalTokens > existing.totalTokens) {
      byKey.set(key, session);
    }
  }

  return [...byKey.values()];
}

function updateStatusBar(metrics: AggregatedMetrics) {
  const config = vscode.workspace.getConfiguration('aiInsights');
  const compact = config.get<boolean>('display.compactNumbers', true);
  const fmt = (n: number) => {
    if (!compact) { return n.toLocaleString(); }
    if (n >= 1_000_000) { return (n / 1_000_000).toFixed(1) + 'M'; }
    if (n >= 1_000) { return (n / 1_000).toFixed(1) + 'K'; }
    return n.toString();
  };

  const today = fmt(metrics.today.totalTokens);
  const monthly = fmt(metrics.currentMonth.totalTokens);
  const budgetPct = Math.round(metrics.budget.budgetUtilizationPct);

  // Show budget alert indicator when over warning threshold
  const alertCfg = vscode.workspace.getConfiguration('aiInsights');
  const warnPct = alertCfg.get<number>('alertThresholds.budgetWarningPct', 80);
  const critPct = alertCfg.get<number>('alertThresholds.budgetCriticalPct', 95);
  const overageIcon = budgetPct >= critPct ? '$(warning)' : budgetPct >= warnPct ? '$(info)' : '';

  statusBarItem.text = `$(pulse) ${today} | ${monthly} ${overageIcon}`.trim();

  const cacheHitPct = Math.round(metrics.cache.cacheHitRate * 100);
  const lines = [
    `🧠 AI Insights Token Tracker`,
    ``,
    `📅 Today: ${metrics.today.totalTokens.toLocaleString()} tokens · ${metrics.today.sessions} sessions`,
  ];

  for (const [id, p] of Object.entries(metrics.todayByProvider)) {
    if (p.totalTokens > 0) {
      const name = getProviderDisplayName(id);
      lines.push(`\n ${name}: ${p.totalTokens.toLocaleString()} tokens (${p.sessions} sessions)`);
    }
  }

  lines.push(
    ``,
    `📆 This Month: ${metrics.currentMonth.totalTokens.toLocaleString()} tokens · ${metrics.currentMonth.sessions} sessions`,
    `  Cache Hit Rate: ${cacheHitPct}%`,
    ``,
    `_Click for dashboard · Updates every 5 min_`,
  );

  const tooltip = new vscode.MarkdownString(lines.join('\n'));
  tooltip.isTrusted = true;
  statusBarItem.tooltip = tooltip;
}

function getProviderDisplayName(id: string): string {
  switch (id) {
    case 'copilot': return 'Copilot';
    case 'antigravity': return 'Antigravity';
    case 'claudeCode': return 'Claude Code';
    case 'codex': return 'Codex';
    default: return id;
  }
}

async function showDashboard(context: vscode.ExtensionContext) {
  if (!latestMetrics) {
    vscode.window.showInformationMessage('AI Insights: No data yet. Refreshing...');
    await refresh(getEnabledProviders());
  }
  if (latestMetrics) {
    DashboardProvider.createPanel(context, latestMetrics);
  }
}

async function showCharts(context: vscode.ExtensionContext) {
  if (!latestMetrics) { await refresh(getEnabledProviders()); }
  if (latestMetrics) {
    ChartsProvider.createPanel(context, latestMetrics);
  }
}

async function showDiagnostics(context: vscode.ExtensionContext, providers: BaseProvider[]) {
  if (!latestMetrics) { await refresh(providers); }
  const report = await DiagnosticsProvider.generateReport(
    providers, cacheManager,
    allSessions.length, latestMetrics?.currentMonth.totalTokens || 0,
  );
  DiagnosticsProvider.createPanel(report);
}

async function showUsageAnalysis(context: vscode.ExtensionContext) {
  if (!latestMetrics) {
    vscode.window.showInformationMessage('AI Insights: Loading data...');
    await refresh(getEnabledProviders());
  }
  if (!latestMetrics) { return; }

  const wsFolders = vscode.workspace.workspaceFolders?.map(f => ({
    name: f.name,
    uri: { fsPath: f.uri.fsPath },
  })) ?? [];

  const reports = buildHygieneReports(allSessions, wsFolders);
  UsageAnalysisProvider.createPanel(context, latestMetrics, reports);
}

async function showSessionsView(context: vscode.ExtensionContext) {
  await refresh(getEnabledProviders());
  SessionsViewProvider.createPanel(context, allSessions);
}

function showPricing(context: vscode.ExtensionContext) {
  PricingViewProvider.createPanel(context);
}
