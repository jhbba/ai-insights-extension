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
import { SessionCompareProvider } from './webview/sessionCompareView';
import { SessionTagsStore } from './core/sessionTagsStore';
import { PricingViewProvider } from './webview/pricingView';
import { buildHygieneReports } from './core/repositoryHygiene';
import { AcceptanceTracker } from './core/acceptanceTracker';
import { Session, AggregatedMetrics, AggregationConfig, AlertThresholds } from './types';
import { ConnectedGitHubUser, connectGitHubAndDetectPlan } from './core/githubAuth';
import { PromptHistoryStore } from './core/promptHistory';
import { PromptHistoryViewProvider } from './webview/promptHistoryView';
import { TokenCalculatorProvider } from './webview/tokenCalculator';
import { BenchmarkViewProvider } from './webview/benchmarkView';
import { ClaudeAccountViewProvider } from './webview/claudeAccountView';
import { detectLiveSessions } from './core/liveSessionMonitor';
import { SessionSnapshotStore } from './core/sessionSnapshotStore';
import { LiveContextTracker, LiveContextInfo } from './core/liveContextTracker';
import { LiveTokenCounter } from './core/liveTokenCounter';
import { LiveBudgetConfig, RateLimitEvent } from './types';

let statusBarItem: vscode.StatusBarItem;
let refreshTimer: NodeJS.Timeout | undefined;
let activeSessionsTimer: NodeJS.Timeout | undefined;
let allSessions: Session[] = [];
let latestMetrics: AggregatedMetrics | null = null;
let liveContextInfo: LiveContextInfo | null = null;
let connectedGitHubUser: ConnectedGitHubUser | undefined;
const cacheManager = new CacheManager();
let snapshotStore: SessionSnapshotStore;
const promptHistoryStore = new PromptHistoryStore();
const acceptanceTracker = new AcceptanceTracker();
let sessionTagsStore: SessionTagsStore;
const DEFAULT_SESSION_LOOKBACK_DAYS = 400;
const GITHUB_USER_STATE_KEY = 'aiInsights.githubUser';
const LIVE_BUDGET_CONFIG_KEY = 'aiInsights.liveBudgetConfig';
const RATE_LIMIT_EVENTS_KEY = 'aiInsights.rateLimitEvents';
let liveBudgetConfig: LiveBudgetConfig | null = null;
let rateLimitEvents: RateLimitEvent[] = [];

export function activate(context: vscode.ExtensionContext) {
  console.log('[AI Insights] Activating extension...');

  connectedGitHubUser = context.globalState.get<ConnectedGitHubUser>(GITHUB_USER_STATE_KEY);
  liveBudgetConfig = context.globalState.get<LiveBudgetConfig | null>(LIVE_BUDGET_CONFIG_KEY, null);
  rateLimitEvents = context.globalState.get<RateLimitEvent[]>(RATE_LIMIT_EVENTS_KEY, []);
  snapshotStore = new SessionSnapshotStore(context.globalStorageUri.fsPath);
  sessionTagsStore = new SessionTagsStore(context.globalStorageUri.fsPath);
  acceptanceTracker.register(context);

  // Wire tag callbacks so the sessions view can persist tag changes
  SessionsViewProvider._addTag = (sessionId, tag) => {
    sessionTagsStore.addTag(sessionId, tag);
    SessionsViewProvider.pushUpdate(context, allSessions, getLiveSessions(), liveBudgetConfig, false, sessionTagsStore.getAll());
  };
  SessionsViewProvider._removeTag = (sessionId, tag) => {
    sessionTagsStore.removeTag(sessionId, tag);
    SessionsViewProvider.pushUpdate(context, allSessions, getLiveSessions(), liveBudgetConfig, false, sessionTagsStore.getAll());
  };

  const providers = getEnabledProviders();

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'aiInsights.showDashboard';
  statusBarItem.tooltip = 'AI Insights - Click for dashboard';
  statusBarItem.text = '$(pulse) Loading...';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const liveTracker = new LiveContextTracker((info) => {
    liveContextInfo = info;
    if (latestMetrics) { updateStatusBar(latestMetrics); }
  });
  liveTracker.start(context.subscriptions);
  context.subscriptions.push(liveTracker);

  const liveTokenCounter = new LiveTokenCounter();
  liveTokenCounter.start(context.subscriptions);

  context.subscriptions.push(
    vscode.commands.registerCommand('aiInsights.refresh', () => refresh(providers)),
    vscode.commands.registerCommand('aiInsights.showDashboard', () => showDashboard(context)),
    vscode.commands.registerCommand('aiInsights.showCharts', () => showCharts(context)),
    vscode.commands.registerCommand('aiInsights.showDiagnostics', () => showDiagnostics(context, providers)),
    vscode.commands.registerCommand('aiInsights.showUsageAnalysis', () => showUsageAnalysis(context)),
    vscode.commands.registerCommand('aiInsights.showSessions', () => showSessionsView(context)),
    vscode.commands.registerCommand('aiInsights.showSessionsView', () => showSessionsView(context)),
    vscode.commands.registerCommand('aiInsights.compareSessionsView', (sessionIds: string[]) => {
      const sessions = allSessions.filter(s => sessionIds.includes(s.id));
      if (sessions.length >= 2) { SessionCompareProvider.createPanel(context, sessions); }
    }),
    vscode.commands.registerCommand('aiInsights.showPricing', () => showPricing(context)),
    vscode.commands.registerCommand('aiInsights.connectGitHub', () => handleConnectGitHub(context)),
    vscode.commands.registerCommand('aiInsights.disconnectGitHub', () => handleDisconnectGitHub(context)),
    vscode.commands.registerCommand('aiInsights.showPromptHistory', () => showPromptHistory(context)),
    vscode.commands.registerCommand('aiInsights.showTokenCalculator', () => TokenCalculatorProvider.createPanel(context)),
    vscode.commands.registerCommand('aiInsights.showBenchmark', () => BenchmarkViewProvider.createPanel(context)),
    vscode.commands.registerCommand('aiInsights.showClaudeAccount', () => showClaudeAccount(context)),
    vscode.commands.registerCommand('aiInsights.logRateLimitHit', (provider: string, note: string) =>
      handleLogRateLimitHit(context, provider as any, note),
    ),
    vscode.commands.registerCommand('aiInsights.saveLiveBudgetConfig', (cfg: LiveBudgetConfig) =>
      handleSaveLiveBudgetConfig(context, cfg),
    ),
    vscode.commands.registerCommand('aiInsights.changeTokenModel', () => liveTokenCounter.cycleFamily()),
    vscode.commands.registerCommand('aiInsights.toggleTokenHighlight', () => liveTokenCounter.toggleHighlight()),
    vscode.commands.registerCommand('aiInsights.configureTokenHighlightColors', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'aiInsights.tokenCounter'),
    ),
  );

  refresh(providers);

  activeSessionsTimer = setInterval(() => {
    SessionsViewProvider.pushUpdate(context, allSessions, getLiveSessions(), liveBudgetConfig, false, sessionTagsStore.getAll());
  }, 30_000);
  context.subscriptions.push({ dispose: () => { if (activeSessionsTimer) { clearInterval(activeSessionsTimer); } } });

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
  if (activeSessionsTimer) { clearInterval(activeSessionsTimer); }
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
  // Use endTime so long-running sessions (e.g. Claude Code conversations started
  // weeks ago but still active) aren't dropped by the lookback window.
  return session.endTime >= cutoff;
}

async function refresh(providers: BaseProvider[]) {
  try {
    const sessions: Session[] = [];
    const cutoff = getSessionCutoff();
    // Track Copilot session IDs found in live files so we can fill gaps from snapshots.
    const liveCopilotIds = new Set<string>();

    for (const provider of providers) {
      const files = await provider.discoverSessionFiles();

      for (const file of files) {
        if (!wasFileModifiedSince(file, cutoff)) {
          continue;
        }

        if (!cacheManager.needsUpdate(file)) {
          const cached = cacheManager.get(file);
          if (cached) {
            if (cached.provider === 'copilot') { liveCopilotIds.add(cached.id); }
            if (isSessionRecent(cached, cutoff)) { sessions.push(cached); }
          }
          continue;
        }

        try {
          const session = await provider.parseSessionFile(file);
          if (session !== null) {
            cacheManager.set(file, session);
            if (session.provider === 'copilot') {
              liveCopilotIds.add(session.id);
              snapshotStore.save(session);
            }
          }
          if (session && isSessionRecent(session, cutoff)) { sessions.push(session); }
        } catch {
          // Skip failed files silently
        }
      }
    }

    // Merge persisted Copilot snapshots for sessions whose source files were deleted.
    for (const snap of snapshotStore.loadAll()) {
      if (!liveCopilotIds.has(snap.id) && isSessionRecent(snap, cutoff)) {
        sessions.push(snap);
      }
    }
    snapshotStore.prune(cutoff);

    allSessions = dedupeSessions(sessions);
    latestMetrics = aggregateSessions(allSessions, getAggregationConfig());
    promptHistoryStore.update(allSessions);
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

  const warnPct = config.get<number>('alertThresholds.budgetWarningPct', 80);
  const critPct = config.get<number>('alertThresholds.budgetCriticalPct', 95);
  const overageIcon = budgetPct >= critPct ? '$(warning)' : budgetPct >= warnPct ? '$(info)' : '';

  const hourlyRate = config.get<number>('roi.developerHourlyRate', 75);
  const tokensPerHour = config.get<number>('roi.outputTokensPerHourSaved', 3000);
  const hoursSaved = metrics.currentMonth.outputTokens / tokensPerHour;
  const valueGenerated = hoursSaved * hourlyRate;
  const fmtHours = hoursSaved < 1
    ? `${Math.round(hoursSaved * 60)}min`
    : `${hoursSaved.toFixed(1)}h`;

  const cacheHitPct = Math.round(metrics.cache.cacheHitRate * 100);
  const aiCost = metrics.currentMonth.estimatedCost;
  const roiMultiplier = aiCost > 0 ? (valueGenerated / aiCost).toFixed(0) : '∞';

  const live = liveContextInfo;

  if (live) {
    const healthIcon = live.healthLabel === 'healthy' ? '$(check)'
      : live.healthLabel === 'warning' ? '$(warning)'
      : '$(error)';
    statusBarItem.text =
      `$(pulse) ctx: ${fmt(live.lastInputTokens)} (${live.contextPct}%) ${healthIcon} · ${today} today`;

    const titleLine = live.sessionTitle ? `**${live.sessionTitle}**\n\n` : '';
    const ctxBar = buildMiniBar(live.contextPct, 20);
    const lines = [
      `🧠 AI Insights — Live Session`,
      ``,
      titleLine +
      `Context: ${live.lastInputTokens.toLocaleString()} / ${live.contextLimitTokens.toLocaleString()} tokens`,
      `\`${ctxBar}\` ${live.contextPct}%`,
      `Health: **${live.healthLabel}** (${live.healthScore}/10) · Turns: ${live.turnsCount}`,
      `Cache efficiency: ${live.cacheEfficiencyPct}%`,
      ``,
      `📅 Today: ${metrics.today.totalTokens.toLocaleString()} tokens · ${metrics.today.sessions} sessions`,
    ];
    for (const [id, p] of Object.entries(metrics.todayByProvider)) {
      if (p.totalTokens > 0) {
        lines.push(`\n &nbsp; ${getProviderDisplayName(id)}: ${p.totalTokens.toLocaleString()} tokens`);
      }
    }
    lines.push(``, `_Click for dashboard_`);

    const tooltip = new vscode.MarkdownString(lines.join('\n'));
    tooltip.isTrusted = true;
    statusBarItem.tooltip = tooltip;
  } else {
    statusBarItem.text = `$(pulse) ${today} | ${monthly} | ~${fmtHours} saved ${overageIcon}`.trim();

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
      `⏱ Impact (this month)`,
      `  Hours saved: ~${fmtHours}`,
      `  Value generated: ~$${valueGenerated.toFixed(0)}`,
      `  ROI: ~${roiMultiplier}×`,
      `  _(${tokensPerHour.toLocaleString()} tokens/hr · $${hourlyRate}/hr rate)_`,
      ``,
      `_Click for dashboard · Updates every 5 min_`,
    );

    const tooltip = new vscode.MarkdownString(lines.join('\n'));
    tooltip.isTrusted = true;
    statusBarItem.tooltip = tooltip;
  }
}

function buildMiniBar(pct: number, width: number): string {
  const filled = Math.round(pct / 100 * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
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
    DashboardProvider.showLoadingPanel(context);
    await refresh(getEnabledProviders());
  }
  if (latestMetrics) {
    const cfg = vscode.workspace.getConfiguration('aiInsights');
    const roiCfg = { hourlyRate: cfg.get<number>('roi.developerHourlyRate', 75), tokensPerHourSaved: cfg.get<number>('roi.outputTokensPerHourSaved', 3000) };
    DashboardProvider.createPanel(context, latestMetrics, connectedGitHubUser, false, [], roiCfg, acceptanceTracker.getStats());
  }
}

async function handleConnectGitHub(context: vscode.ExtensionContext) {
  const user = await connectGitHubAndDetectPlan();
  if (user) {
    connectedGitHubUser = user;
    await context.globalState.update(GITHUB_USER_STATE_KEY, user);
    await refresh(getEnabledProviders());
    showDashboard(context);
  }
}

async function handleDisconnectGitHub(context: vscode.ExtensionContext) {
  connectedGitHubUser = undefined;
  await context.globalState.update(GITHUB_USER_STATE_KEY, undefined);
  vscode.window.showInformationMessage('AI Insights: GitHub account disconnected. Budget is now set manually via settings.');
  showDashboard(context);
}

async function showCharts(context: vscode.ExtensionContext) {
  if (!latestMetrics) {
    ChartsProvider.createPanel(context, null as any, true);
    await refresh(getEnabledProviders());
  }
  if (latestMetrics) { ChartsProvider.createPanel(context, latestMetrics); }
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
  const wsFolders = vscode.workspace.workspaceFolders?.map(f => ({
    name: f.name,
    uri: { fsPath: f.uri.fsPath },
  })) ?? [];
  const roiCfg = vscode.workspace.getConfiguration('aiInsights');
  const roiConfig = {
    hourlyRate: roiCfg.get<number>('roi.developerHourlyRate', 75),
    tokensPerHourSaved: roiCfg.get<number>('roi.outputTokensPerHourSaved', 3000),
  };

  if (!latestMetrics) {
    DashboardProvider.showLoadingPanel(context);
    await refresh(getEnabledProviders());
  }
  if (!latestMetrics) { return; }
  UsageAnalysisProvider.createPanel(context, latestMetrics, buildHygieneReports(allSessions, wsFolders), acceptanceTracker.getStats(), roiConfig);
}

function showSessionsView(context: vscode.ExtensionContext) {
  SessionsViewProvider.createPanel(context, allSessions, getLiveSessions(), liveBudgetConfig, false, sessionTagsStore.getAll());
  refresh(getEnabledProviders()).then(() => {
    SessionsViewProvider.createPanel(context, allSessions, getLiveSessions(), liveBudgetConfig, false, sessionTagsStore.getAll());
  });
}

function showPromptHistory(context: vscode.ExtensionContext) {
  PromptHistoryViewProvider.createPanel(context, promptHistoryStore.getAll());
  refresh(getEnabledProviders()).then(() => {
    PromptHistoryViewProvider.createPanel(context, promptHistoryStore.getAll());
  });
}

async function showPricing(context: vscode.ExtensionContext) {
  if (!latestMetrics) { await refresh(getEnabledProviders()); }
  PricingViewProvider.createPanel(context, latestMetrics ?? undefined, connectedGitHubUser);
}

function showClaudeAccount(context: vscode.ExtensionContext) {
  ClaudeAccountViewProvider.createPanel(context, latestMetrics ?? undefined, allSessions);
}

function getLiveSessions() {
  const windowTokens = latestMetrics?.currentMonth.totalTokens ?? 0;
  const windowCost = latestMetrics?.currentMonth.estimatedCost ?? 0;
  return detectLiveSessions(allSessions, liveBudgetConfig, windowCost, windowTokens);
}

async function handleLogRateLimitHit(
  context: vscode.ExtensionContext,
  provider: import('./types').ProviderId,
  note: string,
) {
  const event: RateLimitEvent = {
    timestamp: new Date().toISOString(),
    provider,
    note: note || undefined,
  };
  rateLimitEvents = [...rateLimitEvents, event].slice(-100); // keep last 100
  await context.globalState.update(RATE_LIMIT_EVENTS_KEY, rateLimitEvents);
  vscode.window.showInformationMessage(`Rate limit event logged for ${provider}.`);
}

async function handleSaveLiveBudgetConfig(
  context: vscode.ExtensionContext,
  cfg: LiveBudgetConfig,
) {
  liveBudgetConfig = cfg;
  await context.globalState.update(LIVE_BUDGET_CONFIG_KEY, cfg);
  vscode.window.showInformationMessage('Live budget config saved.');
}
