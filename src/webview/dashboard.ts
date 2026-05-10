/**
 * Dashboard webview provider - renders the main token usage dashboard.
 */
import * as vscode from 'vscode';
import { AggregatedMetrics } from '../types';
import { ConnectedGitHubUser } from '../core/githubAuth';
import { providerIcon } from './providerIcons';

export class DashboardProvider {
  static readonly viewType = 'aiInsights.dashboard';
  private static currentPanel: vscode.WebviewPanel | undefined;

  static createPanel(context: vscode.ExtensionContext, metrics: AggregatedMetrics, githubUser?: ConnectedGitHubUser): vscode.WebviewPanel {
    if (DashboardProvider.currentPanel) {
      DashboardProvider.currentPanel.webview.html = DashboardProvider.getHtml(metrics, githubUser);
      DashboardProvider.currentPanel.reveal(vscode.ViewColumn.One);
      return DashboardProvider.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardProvider.viewType,
      'AI Insights Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.webview.html = DashboardProvider.getHtml(metrics, githubUser);

    panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'refresh':
            vscode.commands.executeCommand('aiInsights.refresh').then(() => {
              vscode.commands.executeCommand('aiInsights.showDashboard');
            });
            break;
          case 'showCharts': vscode.commands.executeCommand('aiInsights.showCharts'); break;
          case 'showDiagnostics': vscode.commands.executeCommand('aiInsights.showDiagnostics'); break;
          case 'showUsageAnalysis': vscode.commands.executeCommand('aiInsights.showUsageAnalysis'); break;
          case 'showSessions': vscode.commands.executeCommand('aiInsights.showSessions'); break;
          case 'showSessionsView': vscode.commands.executeCommand('aiInsights.showSessions'); break;
          case 'showPricing': vscode.commands.executeCommand('aiInsights.showPricing'); break;
          case 'showPromptHistory': vscode.commands.executeCommand('aiInsights.showPromptHistory'); break;
          case 'connectGitHub': vscode.commands.executeCommand('aiInsights.connectGitHub'); break;
          case 'disconnectGitHub': vscode.commands.executeCommand('aiInsights.disconnectGitHub'); break;
        }
      },
      undefined,
      context.subscriptions,
    );

    panel.onDidDispose(() => { DashboardProvider.currentPanel = undefined; }, null, context.subscriptions);
    DashboardProvider.currentPanel = panel;
    return panel;
  }

  static getHtml(m: AggregatedMetrics, githubUser?: ConnectedGitHubUser): string {
    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' :
      n >= 1_000 ? (n / 1_000).toFixed(1) + 'K' : n.toString();
    const fmtCost = (n: number) => '$' + n.toFixed(4);
    const fmtCost2 = (n: number) => '$' + n.toFixed(2);
    const fmtCredits = (usd: number) => (usd / 0.01).toFixed(2);
    const fmtDiff = (current: number, previous: number): string => {
      if (previous === 0) { return current > 0 ? '<span style="color:#39FF14;font-size:0.75em;font-weight:600">new ↑</span>' : ''; }
      const pct = ((current - previous) / previous) * 100;
      const up = pct >= 0;
      const color = up ? '#39FF14' : '#FF6B6B';
      return `<span style="color:${color};font-size:0.75em;font-weight:600">${up ? '↑' : '↓'} ${Math.abs(pct).toFixed(0)}%</span>`;
    };
    const copilotToday = m.todayByProvider.copilot;
    const copilotMonth = m.currentMonthByProvider.copilot;
    const copilotLastMonth = m.lastMonthByProvider.copilot;

    // ── Budget health widget ────────────────────────────────────────────────
    const b = m.budget;
    const budgetPct = Math.min(100, b.budgetUtilizationPct);

    const PLAN_LABELS: Record<string, string> = { free: 'Free', pro: 'Pro', team: 'Business', enterprise: 'Enterprise' };
    const ghIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:middle;opacity:0.8"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

    let budgetWidget: string;
    if (githubUser) {
      const planLabel = PLAN_LABELS[githubUser.planName] ?? githubUser.planName;
      const planBudgetCredits = githubUser.monthlyBudgetUsd / 0.01;
      const usedCredits = copilotMonth.estimatedCost / 0.01;
      const remainingCredits = Math.max(0, planBudgetCredits - usedCredits);
      const usedPct = planBudgetCredits > 0 ? Math.min(100, (usedCredits / planBudgetCredits) * 100) : 0;
      const barColor = usedPct >= 95 ? '#ff6b6b' : usedPct >= 80 ? '#f9e2af' : '#39FF14';
      const creditsLine = githubUser.monthlyBudgetUsd > 0
        ? `<div style="margin-top:6px;font-size:0.8em;color:var(--text-secondary)">
             <span style="color:var(--text-primary);font-weight:500">${remainingCredits.toFixed(0)} credits remaining</span>
             &nbsp;of ${planBudgetCredits.toFixed(0)} &middot; ${usedCredits.toFixed(0)} used (${usedPct.toFixed(1)}%)
           </div>
           <div class="gh-credits-bar" style="margin-top:6px">
             <div class="gh-credits-bar-fill" style="width:${usedPct.toFixed(1)}%;background:${barColor}"></div>
           </div>`
        : '';
      budgetWidget = `<div class="github-connect connected">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px">
            ${ghIcon}
            <span>Connected as <strong>@${githubUser.login}</strong> &middot; GitHub ${planLabel} &middot; $${githubUser.monthlyBudgetUsd}/month</span>
            <div style="margin-left:auto;display:flex;gap:6px;flex-shrink:0">
              <button class="gh-btn" onclick="vscode.postMessage({command:'connectGitHub'})">Reconnect</button>
              <button class="gh-btn gh-btn-danger" onclick="vscode.postMessage({command:'disconnectGitHub'})">Disconnect</button>
            </div>
          </div>
          ${creditsLine}
        </div>
      </div>`;
    } else {
      budgetWidget = `<div class="github-connect">
        ${ghIcon}
        <span>Connect GitHub to auto-detect your Copilot plan and set the budget.</span>
        <button class="gh-btn" style="margin-left:auto" onclick="vscode.postMessage({command:'connectGitHub'})">Connect GitHub</button>
      </div>`;
    }

    // ── Alert banner ────────────────────────────────────────────────────────
    let alertBanner = '';
    if (budgetPct >= 95) {
      alertBanner += `<div class="alert alert-crit">🚨 Copilot budget critical: ${Math.round(budgetPct)}% of monthly GitHub AI Credits used. Overage may apply.</div>`;
    } else if (budgetPct >= 80) {
      alertBanner += `<div class="alert alert-info">⚠️ Copilot budget warning: ${Math.round(budgetPct)}% of monthly GitHub AI Credits used.</div>`;
    }

    // ── Cache efficiency cards ──────────────────────────────────────────────
    const cacheHitPct = Math.round(m.cache.cacheHitRate * 100);
    const cacheBarColor = cacheHitPct >= 30 ? '#39FF14' : cacheHitPct >= 10 ? '#f9e2af' : 'var(--text-secondary)';
    const cacheCards = `
      <div class="card" style="border-top: 2px solid ${cacheBarColor};">
        <div class="card-label">Cache Hit Rate</div>
        <div class="card-value data-text" style="color:${cacheBarColor}">${cacheHitPct}%</div>
        <div class="card-sub">${fmt(m.cache.totalCacheReadTokens)} cached reads</div>
      </div>`;

    // ── Provider rows ────────────────────────────────────────────────────────
    const providerRows = Object.entries(m.byProvider).map(([id, p]) => {
      const label = id === 'copilot' ? 'GitHub Copilot' :
        id === 'antigravity' ? 'Antigravity' :
          id === 'claudeCode' ? 'Claude Code' : 'Codex';
      const name = `${providerIcon(id)} ${label}`;
      const cHit = (p.inputTokens + p.cacheReadTokens) > 0
        ? Math.round((p.cacheReadTokens / (p.inputTokens + p.cacheReadTokens)) * 100) + '%'
        : '-';
      return `<tr>
        <td class="data-text">${name}</td>
        <td class="data-text">${fmt(p.totalTokens)}</td>
        <td class="data-text">${p.sessions}</td>
        <td class="data-text">${p.interactions}</td>
        <td class="data-text">${cHit}</td>
      </tr>`;
    }).join('');

    // ── Model rows ───────────────────────────────────────────────────────────
    const copilotModelRows = Object.entries(copilotMonth.modelUsage)
      .filter(([, usage]) => usage.totalTokens > 0)
      .sort(([, a], [, b]) => b.totalCost - a.totalCost)
      .map(([model, usage]) => {
        const pricing = usage.pricingSource === 'official'
          ? `$${usage.inputCostPerMillion?.toFixed(3)} / $${usage.cachedInputCostPerMillion?.toFixed(3)} / $${usage.outputCostPerMillion?.toFixed(3)}`
          : 'fallback';
        return `<tr>
          <td class="data-text">${model}</td>
          <td class="data-text">${fmt(usage.uncachedInputTokens)}</td>
          <td class="data-text">${fmt(usage.cacheReadTokens)}</td>
          <td class="data-text">${fmt(usage.outputTokens)}</td>
          <td class="data-text">${pricing}</td>
          <td class="data-text">${fmtCost(usage.inputCost)}</td>
          <td class="data-text">${fmtCost(usage.cachedInputCost)}</td>
          <td class="data-text">${fmtCost(usage.outputCost)}</td>
          <td class="data-text">${fmtCredits(usage.totalCost)}</td>
          <td class="data-text">${fmtCost(usage.totalCost)}</td>
        </tr>`;
      }).join('');

    const cmInputTokens = Object.values(copilotMonth.modelUsage).reduce((s, u) => s + u.uncachedInputTokens, 0);
    const cmInputCost = Object.values(copilotMonth.modelUsage).reduce((s, u) => s + u.inputCost, 0);
    const cmCachedCost = Object.values(copilotMonth.modelUsage).reduce((s, u) => s + u.cachedInputCost, 0);
    const cmOutputCost = Object.values(copilotMonth.modelUsage).reduce((s, u) => s + u.outputCost, 0);
    const cmCacheWriteCost = Object.values(copilotMonth.modelUsage).reduce((s, u) => s + u.cacheWriteCost, 0);

    const lmInputTokens = Object.values(copilotLastMonth.modelUsage).reduce((s, u) => s + u.uncachedInputTokens, 0);
    const lmInputCost = Object.values(copilotLastMonth.modelUsage).reduce((s, u) => s + u.inputCost, 0);
    const lmCachedCost = Object.values(copilotLastMonth.modelUsage).reduce((s, u) => s + u.cachedInputCost, 0);
    const lmOutputCost = Object.values(copilotLastMonth.modelUsage).reduce((s, u) => s + u.outputCost, 0);
    const lmCacheWriteCost = Object.values(copilotLastMonth.modelUsage).reduce((s, u) => s + u.cacheWriteCost, 0);

    const hasCacheWrite = copilotMonth.cacheWriteTokens > 0 || copilotLastMonth.cacheWriteTokens > 0;

    const copilotCostSummaryRows = `
      <tr>
        <td>Input tokens</td>
        <td class="data-text">${fmt(cmInputTokens)}</td><td class="data-text">${fmtCost(cmInputCost)}</td>
        <td class="data-text" style="color:var(--text-secondary)">${fmt(lmInputTokens)}</td><td class="data-text" style="color:var(--text-secondary)">${fmtCost(lmInputCost)}</td>
      </tr>
      <tr>
        <td>Cached input tokens</td>
        <td class="data-text">${fmt(copilotMonth.cacheReadTokens)}</td><td class="data-text">${fmtCost(cmCachedCost)}</td>
        <td class="data-text" style="color:var(--text-secondary)">${fmt(copilotLastMonth.cacheReadTokens)}</td><td class="data-text" style="color:var(--text-secondary)">${fmtCost(lmCachedCost)}</td>
      </tr>
      <tr>
        <td>Output tokens</td>
        <td class="data-text">${fmt(copilotMonth.outputTokens)}</td><td class="data-text">${fmtCost(cmOutputCost)}</td>
        <td class="data-text" style="color:var(--text-secondary)">${fmt(copilotLastMonth.outputTokens)}</td><td class="data-text" style="color:var(--text-secondary)">${fmtCost(lmOutputCost)}</td>
      </tr>
      ${hasCacheWrite ? `<tr>
        <td>Cache write tokens</td>
        <td class="data-text">${fmt(copilotMonth.cacheWriteTokens)}</td><td class="data-text">${fmtCost(cmCacheWriteCost)}</td>
        <td class="data-text" style="color:var(--text-secondary)">${fmt(copilotLastMonth.cacheWriteTokens)}</td><td class="data-text" style="color:var(--text-secondary)">${fmtCost(lmCacheWriteCost)}</td>
      </tr>` : ''}
      <tr>
        <td><strong>Total GitHub AI Credits</strong></td>
        <td class="data-text">${fmt(copilotMonth.totalTokens)}</td><td class="data-text"><strong>${fmtCredits(copilotMonth.estimatedCost)} credits / ${fmtCost2(copilotMonth.estimatedCost)}</strong></td>
        <td class="data-text" style="color:var(--text-secondary)">${fmt(copilotLastMonth.totalTokens)}</td><td class="data-text" style="color:var(--text-secondary)">${fmtCredits(copilotLastMonth.estimatedCost)} credits / ${fmtCost2(copilotLastMonth.estimatedCost)}</td>
      </tr>`;

    // ── Daily chart data (last 30 days, aggregated across providers) ─────────
    const dailyByDate: Record<string, { tokens: number; cost: number }> = {};
    for (const d of m.daily) {
      if (!dailyByDate[d.date]) { dailyByDate[d.date] = { tokens: 0, cost: 0 }; }
      dailyByDate[d.date].tokens += d.totalTokens;
      dailyByDate[d.date].cost += d.estimatedCost;
    }
    const chartLabels = Object.keys(dailyByDate).sort().slice(-30);
    const chartTokens = chartLabels.map(d => dailyByDate[d].tokens);
    const chartCosts = chartLabels.map(d => dailyByDate[d].cost);
    const chartDataJson = JSON.stringify({ labels: chartLabels, tokens: chartTokens, costs: chartCosts });

    // ── Repo cost rows ───────────────────────────────────────────────────────
    const repoRows = Object.entries(m.currentMonth.costByRepository)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([repo]) => {
        const tokens = m.currentMonth.repositories[repo] || 0;
        return `<tr>
          <td class="data-text">${repo}</td>
          <td class="data-text">${fmt(tokens)}</td>
        </tr>`;
      }).join('');

    // ── ROI section ──────────────────────────────────────────────────────────
    const roi = m.roi;
    const roiRows = `
      <tr><td>Input efficiency ratio</td><td class="data-text">${roi.inputEfficiencyRatio.toFixed(2)}× (output / input)</td></tr>
      <tr><td>Thinking token overhead</td><td class="data-text">${roi.thinkingOverheadPct.toFixed(1)}%</td></tr>`;

    // ── Fluency scoring ──────────────────────────────────────────────────────
    const getStageColor = (stage: number) => {
      switch (stage) {
        case 1: return 'var(--stage-1)';
        case 2: return 'var(--stage-2)';
        case 3: return 'var(--stage-3)';
        case 4: return 'var(--stage-4)';
        default: return 'var(--text-secondary)';
      }
    };
    const getStageBar = (stage: number) => '█'.repeat(stage) + '░'.repeat(4 - stage);

    const interactions = m.currentMonth.interactions;
    const sessions = m.currentMonth.sessions;
    const avgExchanges = m.currentMonth.averageInteractionsPerSession;
    const inputRatio = m.currentMonth.outputTokens > 0 ? m.currentMonth.inputTokens / m.currentMonth.outputTokens : 1;
    const numTools = Object.keys(m.currentMonth.toolCalls || {}).length;
    const numRepos = Object.keys(m.currentMonth.repositories || {}).filter(k => k !== 'Unknown').length;
    const numModels = Object.keys(m.currentMonth.modelBreakdown || {}).length;
    const agentTokens = (m.currentMonth.providerBreakdown['Claude Code'] || 0) +
      (m.currentMonth.providerBreakdown['Antigravity'] || 0) +
      (m.currentMonth.providerBreakdown['Codex'] || 0);

    let peStage = 1;
    if (interactions >= 5) { peStage = 2; }
    if (interactions >= 30 && avgExchanges >= 3) { peStage = 3; }
    if (interactions >= 100 && avgExchanges >= 5) { peStage = 4; }

    let ceStage = 1;
    if (inputRatio >= 3) { ceStage = 2; }
    if (inputRatio >= 5) { ceStage = 3; }
    if (inputRatio >= 10) { ceStage = 4; }

    let agStage = 1;
    if (agentTokens > 0) { agStage = 2; }
    if (agentTokens > 10000) { agStage = 3; }
    if (agentTokens > 50000) { agStage = 4; }

    let tuStage = 1;
    if (numTools >= 1) { tuStage = 2; }
    if (numTools >= 3) { tuStage = 3; }
    if (numTools >= 6) { tuStage = 4; }

    let cuStage = 1;
    if (numRepos >= 1 || numModels >= 2) { cuStage = 2; }
    if (numRepos >= 2 || numModels >= 3) { cuStage = 3; }
    if (numRepos >= 3 || numModels >= 5) { cuStage = 4; }

    let wiStage = 1;
    if (sessions >= 3) { wiStage = 2; }
    if (sessions >= 10) { wiStage = 3; }
    if (sessions >= 20) { wiStage = 4; }

    const stages = [peStage, ceStage, agStage, tuStage, cuStage, wiStage].sort((a, b) => a - b);
    const overallStage = Math.round((stages[2] + stages[3]) / 2) || 1;
    const overallLabels: Record<number, string> = {
      1: 'Stage 1: AI Skeptic',
      2: 'Stage 2: AI Explorer',
      3: 'Stage 3: AI Collaborator',
      4: 'Stage 4: AI Strategist',
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Insights Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600&display=swap');
  :root {
    --bg-base: #0e0e0e;
    --bg-surface: #1a1919;
    --bg-surface-high: #201f1f;
    --text-primary: #e5e2e1;
    --text-secondary: #c1c6d7;
    --primary: #007AFF;
    --primary-glow: rgba(0, 122, 255, 0.2);
    --border: rgba(255, 255, 255, 0.05);
    --stage-1: #FF4D4D;
    --stage-2: #f093fb;
    --stage-3: #007AFF;
    --stage-4: #39FF14;
    --font-primary: 'Inter', system-ui, sans-serif;
    --font-data: 'Space Grotesk', 'JetBrains Mono', monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: var(--font-primary); background: var(--bg-base); color: var(--text-primary); padding: 32px; line-height: 1.6; }
  .data-text { font-family: var(--font-data); }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .header h1 { font-size: 2em; font-weight: 600; letter-spacing: -0.02em; }
  .nav { display: flex; gap: 8px; margin-left: auto; align-items: center; }
  .btn-refresh { background: var(--primary); color: #fff; border: none; border-radius: 20px; padding: 8px 18px; font-size: 0.82em; font-weight: 600; font-family: var(--font-primary); cursor: pointer; box-shadow: 0 0 18px rgba(0,122,255,0.35); transition: all 0.18s ease; }
  .btn-refresh:hover { background: #1a8aff; box-shadow: 0 0 26px rgba(0,122,255,0.55); transform: translateY(-1px); }
  .btn-group { display: flex; background: var(--bg-surface); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 3px; gap: 2px; }
  .btn-tab { background: transparent; border: none; color: var(--text-secondary); padding: 6px 13px; border-radius: 16px; cursor: pointer; font-size: 0.8em; font-weight: 500; font-family: var(--font-primary); white-space: nowrap; transition: all 0.15s ease; }
  .btn-tab:hover { background: var(--bg-surface-high); color: var(--text-primary); }

  /* Budget widget */
  .budget-widget { background: var(--bg-surface); border: 1px solid; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; }
  .budget-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
  .budget-title { font-weight: 600; font-size: 1em; }
  .budget-amount { font-size: 1.05em; margin-left: auto; }
  .budget-pct { font-size: 1em; font-weight: 700; }
  .budget-track { background: var(--bg-base); border-radius: 4px; height: 8px; overflow: hidden; margin-bottom: 8px; }
  .budget-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
  .budget-footer { display: flex; justify-content: space-between; font-size: 0.8em; color: var(--text-secondary); }
  .budget-team { margin-top: 8px; font-size: 0.8em; color: var(--text-secondary); border-top: 1px solid var(--border); padding-top: 8px; }

  /* Alerts */
  .github-connect { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 6px; font-size: 0.85em; margin-bottom: 8px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--text-secondary); }
  .github-connect.connected { border-color: rgba(57,255,20,0.3); background: rgba(57,255,20,0.04); color: var(--text-primary); }
  .gh-btn { padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-primary); cursor: pointer; font-size: 0.82em; white-space: nowrap; }
  .gh-btn:hover { border-color: #39FF14; color: #39FF14; }
  .gh-btn-danger:hover { border-color: #ff6b6b; color: #ff6b6b; }
  .gh-credits-bar { margin-top: 8px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.1); overflow: hidden; }
  .gh-credits-bar-fill { height: 100%; border-radius: 2px; background: #39FF14; transition: width 0.3s; }
  .alert { padding: 10px 14px; border-radius: 6px; font-size: 0.85em; margin-bottom: 8px; }
  .alert-crit { background: rgba(255,77,77,0.1); border: 1px solid rgba(255,77,77,0.35); color: #ff8a8a; }
  .alert-warn { background: rgba(249,226,175,0.08); border: 1px solid rgba(249,226,175,0.3); color: #f9e2af; }
  .alert-info { background: rgba(0,122,255,0.07); border: 1px solid rgba(0,122,255,0.25); color: #6db3ff; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 4px; padding: 20px; transition: transform 0.2s; }
  .card:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
  .card-label { font-size: 0.75em; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; font-weight: 500; }
  .card-value { font-size: 2em; font-weight: 500; color: var(--text-primary); margin: 4px 0; }
  .card-sub { font-size: 0.75em; color: var(--text-secondary); }
  .section { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 24px; margin-bottom: 28px; }
  .section h2 { font-size: 1.15em; margin-bottom: 20px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 11px 14px; background: var(--bg-surface-high); color: var(--text-secondary); font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); font-weight: 500; }
  td { padding: 11px 14px; border-bottom: 1px solid var(--border); font-size: 0.88em; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,0.02); }
  .footer { text-align: center; padding: 16px; color: var(--text-secondary); font-size: 0.75em; font-style: italic; }
  .score-card { background: var(--bg-surface-high); padding: 20px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
  .sub-score-card { background: var(--bg-surface-high); padding: 14px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.02); }
</style>
</head>
<body>
  <div class="header">
    <h1>🧠 AI Insights Dashboard</h1>
    <div class="nav">
      <button class="btn-refresh" onclick="window.vscode.postMessage({command:'refresh'})">↺ Refresh</button>
      <div class="btn-group">
        <button class="btn-tab" onclick="window.vscode.postMessage({command:'showUsageAnalysis'})">📈 Usage</button>
        <button class="btn-tab" onclick="window.vscode.postMessage({command:'showSessions'})">📋 Sessions</button>
        <button class="btn-tab" onclick="window.vscode.postMessage({command:'showPromptHistory'})">⚡ Prompts</button>
        <button class="btn-tab" onclick="window.vscode.postMessage({command:'showPricing'})">💳 Copilot Pricing</button>
        <button class="btn-tab" onclick="window.vscode.postMessage({command:'showDiagnostics'})">🩺 Diagnostics</button>  
      </div>
    </div>
  </div>

  ${budgetWidget}
  ${alertBanner}

  <div class="cards">
    <div class="card" style="border-top: 2px solid var(--text-secondary);">
      <div class="card-label">GitHub Copilot AI Credits</div>
      <div class="card-value data-text">${fmtCredits(copilotMonth.estimatedCost)}</div>
      <div class="card-sub">${fmtCost2(copilotMonth.estimatedCost)} GitHub Copilot spend</div>
      <div class="card-sub" style="margin-top:6px">vs last month ${fmtDiff(copilotMonth.estimatedCost, copilotLastMonth.estimatedCost)} <span style="color:var(--text-secondary)">(${fmtCredits(copilotLastMonth.estimatedCost)} cr)</span></div>
    </div>
    <div class="card">
      <div class="card-label">Tokens Today</div>
      <div class="card-value data-text">${fmt(m.today.totalTokens)}</div>
      <div class="card-sub">${m.today.sessions} sessions · ${m.today.interactions} interactions</div>
      <div class="card-sub" style="margin-top:6px">vs yesterday ${fmtDiff(m.today.totalTokens, m.yesterday.totalTokens)} <span style="color:var(--text-secondary)">(${fmt(m.yesterday.totalTokens)})</span></div>
    </div>
    <div class="card">
      <div class="card-label">This Month</div>
      <div class="card-value data-text">${fmt(m.currentMonth.totalTokens)}</div>
      <div class="card-sub">${m.currentMonth.sessions} sessions</div>
      <div class="card-sub" style="margin-top:6px">vs last month ${fmtDiff(m.currentMonth.totalTokens, m.lastMonth.totalTokens)} <span style="color:var(--text-secondary)">(${fmt(m.lastMonth.totalTokens)})</span></div>
    </div>
    <div class="card">
      <div class="card-label">Last Month</div>
      <div class="card-value data-text">${fmt(m.lastMonth.totalTokens)}</div>
      <div class="card-sub">${m.lastMonth.sessions} sessions</div>
    </div>
    <div class="card">
      <div class="card-label">Projected Year</div>
      <div class="card-value data-text">${fmt(m.projectedYear.totalTokens)}</div>
      <div class="card-sub">${m.projectedYear.sessions} sessions</div>
    </div>
  </div>

  <!-- ── Daily usage chart ─────────────────────────────────────────── -->
  <div class="section">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <h2 style="margin:0">📈 Daily Token Usage - Last 30 Days</h2>
      <button class="btn-tab" style="background:rgba(0,122,255,0.12);color:#007AFF;border:1px solid rgba(0,122,255,0.25);border-radius:6px;padding:6px 14px" onclick="window.vscode.postMessage({command:'showPromptHistory'})">⚡ View Prompt History</button>
    </div>
    <div style="position:relative;height:240px"><canvas id="dashChart"></canvas></div>
  </div>

  <!-- ── Fluency Score ─────────────────────────────────────────────── -->
  <div class="section" style="display:hidden;">
    <h2>🎯 Developer Fluency Score (This Month)</h2>
    <div class="score-card" style="border-left: 4px solid ${getStageColor(overallStage)}">
      <div>
        <div style="font-size: 1.1em; font-weight: 600; margin-bottom: 6px;">Overall: ${overallLabels[overallStage]}</div>
        <div style="font-size: 0.85em; color: var(--text-secondary);">Based on interaction volume, context ratio, tool usage, and model diversity</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 1.8em; font-weight: 500; color: ${getStageColor(overallStage)}; letter-spacing: 2px;" class="data-text">${getStageBar(overallStage)}</div>
      </div>
    </div>
    <div class="score-grid">
      ${[
        ['💬 Prompt Engineering', peStage, `${fmt(interactions)} interactions · ${avgExchanges.toFixed(1)} avg/session`],
        ['📎 Context Engineering', ceStage, `${inputRatio.toFixed(1)}× input/output · ${fmt(m.currentMonth.inputTokens)} ctx tokens`],
        ['🤖 Agentic Usage', agStage, `${fmt(agentTokens)} agent tokens`],
        ['🔧 Tool Usage', tuStage, `${numTools} unique tools`],
        ['⚙️ Customization', cuStage, `${numModels} models · ${numRepos} repos`],
        ['🔄 Workflow Integration', wiStage, `${sessions} sessions this month`],
      ].map(([label, stage, detail]) => `
        <div class="sub-score-card">
          <div style="font-weight: 600; margin-bottom: 6px;">${label}</div>
          <div style="color: ${getStageColor(stage as number)}; margin: 6px 0; letter-spacing: 1px;" class="data-text">${getStageBar(stage as number)} Stage ${stage}/4</div>
          <div style="font-size: 0.82em; color: var(--text-secondary);">${detail}</div>
        </div>`).join('')}
    </div>
  </div>

  <!-- ── Token usage by period ──────────────────────────────────────── -->
  <div class="section">
    <h2>📊 Token Usage by Period</h2>
    <table>
      <thead>
        <tr><th>Metric</th><th>📅 Today</th><th>📆 This Month</th><th>📅 Last Month</th><th>📈 Projected Year</th></tr>
      </thead>
      <tbody>
        <tr><td>🔵 Tokens (total)</td><td class="data-text">${fmt(m.today.totalTokens)}</td><td class="data-text">${fmt(m.currentMonth.totalTokens)}</td><td class="data-text">${fmt(m.lastMonth.totalTokens)}</td><td class="data-text">${fmt(m.projectedYear.totalTokens)}</td></tr>
        <tr><td>📥 Input tokens</td><td class="data-text">${fmt(m.today.inputTokens)}</td><td class="data-text">${fmt(m.currentMonth.inputTokens)}</td><td class="data-text">${fmt(m.lastMonth.inputTokens)}</td><td class="data-text">-</td></tr>
        <tr><td>📤 Output tokens</td><td class="data-text">${fmt(m.today.outputTokens)}</td><td class="data-text">${fmt(m.currentMonth.outputTokens)}</td><td class="data-text">${fmt(m.lastMonth.outputTokens)}</td><td class="data-text">-</td></tr>
        <tr><td>🧠 Thinking tokens</td><td class="data-text">${fmt(m.today.thinkingTokens)}</td><td class="data-text">${fmt(m.currentMonth.thinkingTokens)}</td><td class="data-text">${fmt(m.lastMonth.thinkingTokens)}</td><td class="data-text">-</td></tr>
        <tr><td>⚡ Cache read tokens</td><td class="data-text">${fmt(m.today.cacheReadTokens)}</td><td class="data-text">${fmt(m.currentMonth.cacheReadTokens)}</td><td class="data-text">${fmt(m.lastMonth.cacheReadTokens)}</td><td class="data-text">-</td></tr>

        <tr><td>📋 Sessions</td><td class="data-text">${m.today.sessions}</td><td class="data-text">${m.currentMonth.sessions}</td><td class="data-text">${m.lastMonth.sessions}</td><td class="data-text">${m.projectedYear.sessions}</td></tr>
        <tr><td>💬 Avg tokens/session</td><td class="data-text">${fmt(m.today.averageTokensPerSession)}</td><td class="data-text">${fmt(m.currentMonth.averageTokensPerSession)}</td><td class="data-text">${fmt(m.lastMonth.averageTokensPerSession)}</td><td class="data-text">-</td></tr>
        <tr><td>🔄 Avg interactions/session</td><td class="data-text">${m.today.averageInteractionsPerSession}</td><td class="data-text">${m.currentMonth.averageInteractionsPerSession}</td><td class="data-text">${m.lastMonth.averageInteractionsPerSession}</td><td class="data-text">-</td></tr>
      </tbody>
    </table>
  </div>

  <!-- ── Provider breakdown ─────────────────────────────────────────── -->
  <div class="section">
    <h2>🤖 Usage by Provider (All-time)</h2>
    <table>
      <thead><tr><th>Provider</th><th>Tokens</th><th>Sessions</th><th>Interactions</th><th>Cache Hit</th></tr></thead>
      <tbody>${providerRows}</tbody>
    </table>
  </div>

  <!-- ── Copilot pricing breakdown ─────────────────────────────────── -->
  <div class="section">
    <h2>🏷️ GitHub Copilot Pricing by Model (This Month)</h2>
    <table>
      <thead><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th><th>Official $/1M input/cached/output</th><th>Input USD</th><th>Cached USD</th><th>Output USD</th><th>AI Credits</th><th>Total USD</th></tr></thead>
      <tbody>${copilotModelRows || '<tr><td colspan="10" style="color:var(--text-secondary)">No GitHub Copilot model data yet</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>💳 GitHub Copilot AI Credits Summary</h2>
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Tokens (This Month)</th><th>Cost (This Month)</th>
          <th style="color:var(--text-secondary)">Tokens (Last Month)</th><th style="color:var(--text-secondary)">Cost (Last Month)</th>
        </tr>
      </thead>
      <tbody>${copilotCostSummaryRows}</tbody>
    </table>
  </div>

  <!-- ── Repository cost ───────────────────────────────────────────── -->
  <div class="section">
    <h2>📁 Usage by Repository (This Month)</h2>
    <table>
      <thead><tr><th>Repository</th><th>Tokens</th></tr></thead>
      <tbody>${repoRows || '<tr><td colspan="3" style="color:var(--text-secondary)">No repository data</td></tr>'}</tbody>
    </table>
  </div>

  <div class="footer">GitHub Copilot AI Credits are calculated only for GitHub Copilot sessions. 1 AI credit = $0.01 USD.</div>
  <script>
    if (typeof window.vscode === 'undefined') {
      window.vscode = acquireVsCodeApi();
    }
    (function() {
      var data = ${chartDataJson};
      if (!data.labels.length) { return; }
      Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
      Chart.defaults.color = '#c1c6d7';
      new Chart(document.getElementById('dashChart'), {
        type: 'bar',
        data: {
          labels: data.labels,
          datasets: [
            {
              type: 'bar',
              label: 'Tokens',
              data: data.tokens,
              backgroundColor: 'rgba(0,122,255,0.45)',
              borderColor: '#007AFF',
              borderWidth: 1,
              yAxisID: 'y',
            },
            {
              type: 'line',
              label: 'Cost (USD)',
              data: data.costs,
              borderColor: '#39FF14',
              backgroundColor: 'rgba(57,255,20,0.06)',
              borderWidth: 2,
              pointRadius: 3,
              pointBackgroundColor: '#39FF14',
              tension: 0.3,
              fill: true,
              yAxisID: 'y2',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#c1c6d7', font: { size: 11 }, boxWidth: 12, padding: 12 } },
            tooltip: {
              callbacks: {
                label: function(ctx) {
                  if (ctx.datasetIndex === 0) {
                    var v = ctx.parsed.y;
                    return ' Tokens: ' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : v);
                  }
                  return ' Cost: $' + ctx.parsed.y.toFixed(4);
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } },
            y: {
              beginAtZero: true,
              position: 'left',
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: '#007AFF', callback: function(v) { return v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : v; } },
            },
            y2: {
              beginAtZero: true,
              position: 'right',
              grid: { display: false },
              ticks: { color: '#39FF14', callback: function(v) { return '$' + Number(v).toFixed(3); } },
            },
          },
        },
      });
    })();
  </script>
</body>
</html>`;
  }
}
