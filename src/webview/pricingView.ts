import * as vscode from 'vscode';
import pricingData from '../data/modelPricing.json';

interface ModelEntry {
  displayName: string;
  provider: string;
  copilotOfficial: boolean;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cachedInputCostPerMillion?: number;
  cacheCreationCostPerMillion?: number;
  category: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  xai: 'xAI',
};

const USD_PER_AI_CREDIT = 0.01;

export class PricingViewProvider {
  static readonly viewType = 'aiInsights.pricing';
  private static currentPanel: vscode.WebviewPanel | undefined;

  static createPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
    if (PricingViewProvider.currentPanel) {
      PricingViewProvider.currentPanel.webview.html = PricingViewProvider.getHtml();
      PricingViewProvider.currentPanel.reveal(vscode.ViewColumn.One);
      return PricingViewProvider.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      PricingViewProvider.viewType,
      'AI Insights - Copilot Pricing',
      vscode.ViewColumn.One,
      { enableScripts: true },
    );
    panel.webview.html = PricingViewProvider.getHtml();

    panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'showDashboard': vscode.commands.executeCommand('aiInsights.showDashboard'); break;
          case 'showCharts': vscode.commands.executeCommand('aiInsights.showCharts'); break;
          case 'showUsageAnalysis': vscode.commands.executeCommand('aiInsights.showUsageAnalysis'); break;
          case 'showDiagnostics': vscode.commands.executeCommand('aiInsights.showDiagnostics'); break;
          case 'showSessions': vscode.commands.executeCommand('aiInsights.showSessions'); break;
        }
      },
      undefined,
      context.subscriptions,
    );

    panel.onDidDispose(() => { PricingViewProvider.currentPanel = undefined; }, null, context.subscriptions);
    PricingViewProvider.currentPanel = panel;
    return panel;
  }

  static getHtml(): string {
    const pricing = pricingData.pricing as Record<string, ModelEntry>;
    const lastUpdated = pricingData.metadata.lastUpdated;

    const providerOrder = ['openai', 'anthropic', 'google', 'xai'];
    const byProvider: Record<string, Array<[string, ModelEntry]>> = {};

    for (const [id, model] of Object.entries(pricing)) {
      const p = model.provider;
      if (!byProvider[p]) { byProvider[p] = []; }
      byProvider[p].push([id, model]);
    }

    const creditsPerMInput = (m: ModelEntry) => (m.inputCostPerMillion / USD_PER_AI_CREDIT).toFixed(0);
    const creditsPerMOutput = (m: ModelEntry) => (m.outputCostPerMillion / USD_PER_AI_CREDIT).toFixed(0);
    const fmtRate = (n: number | undefined) => n !== undefined ? `$${n.toFixed(3)}` : '-';

    const providerSections = providerOrder
      .filter(p => byProvider[p]?.length)
      .map(provId => {
        const label = PROVIDER_LABELS[provId] ?? provId;
        const entries = byProvider[provId].sort((a, b) => {
          if (a[1].copilotOfficial !== b[1].copilotOfficial) { return a[1].copilotOfficial ? -1 : 1; }
          return a[1].inputCostPerMillion - b[1].inputCostPerMillion;
        });

        const rows = entries.map(([id, m]) => {
          const badge = m.copilotOfficial
            ? `<span class="badge badge-official">✓ Official</span>`
            : `<span class="badge badge-other">other</span>`;
          const hasCacheWrite = m.cacheCreationCostPerMillion !== undefined;
          return `<tr class="${m.copilotOfficial ? 'row-official' : 'row-other'}">
            <td>
              <div class="model-name data-text">${m.displayName}</div>
              <div class="model-id">${id}</div>
            </td>
            <td>${badge}</td>
            <td class="data-text num">${fmtRate(m.inputCostPerMillion)}</td>
            <td class="data-text num">${fmtRate(m.cachedInputCostPerMillion)}</td>
            <td class="data-text num">${hasCacheWrite ? fmtRate(m.cacheCreationCostPerMillion) : '-'}</td>
            <td class="data-text num">${fmtRate(m.outputCostPerMillion)}</td>
            <td class="data-text num credits">${creditsPerMInput(m)}</td>
            <td class="data-text num credits">${creditsPerMOutput(m)}</td>
            <td><span class="cat cat-${m.category.toLowerCase()}">${m.category}</span></td>
          </tr>`;
        }).join('');

        return `
          <div class="section">
            <h2 class="provider-heading">${label}</h2>
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Status</th>
                  <th class="num">Input<br><span class="sub">$/1M tokens</span></th>
                  <th class="num">Cached input<br><span class="sub">$/1M tokens</span></th>
                  <th class="num">Cache write<br><span class="sub">$/1M tokens</span></th>
                  <th class="num">Output<br><span class="sub">$/1M tokens</span></th>
                  <th class="num">Input<br><span class="sub">credits/1M</span></th>
                  <th class="num">Output<br><span class="sub">credits/1M</span></th>
                  <th>Tier</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      }).join('');

    const officialCount = Object.values(pricing).filter(m => m.copilotOfficial).length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Insights - Copilot Pricing</title>
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
    --green: #39FF14;
    --font-primary: 'Inter', system-ui, sans-serif;
    --font-data: 'Space Grotesk', 'JetBrains Mono', monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: var(--font-primary); background: var(--bg-base); color: var(--text-primary); padding: 32px; line-height: 1.6; }
  .data-text { font-family: var(--font-data); }

  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .header h1 { font-size: 2em; font-weight: 600; letter-spacing: -0.02em; }
  .nav { display: flex; gap: 8px; margin-left: auto; align-items: center; }
  .btn-group { display: flex; background: var(--bg-surface); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 3px; gap: 2px; }
  .btn-tab { background: transparent; border: none; color: var(--text-secondary); padding: 6px 13px; border-radius: 16px; cursor: pointer; font-size: 0.8em; font-weight: 500; font-family: var(--font-primary); white-space: nowrap; transition: all 0.15s ease; }
  .btn-tab:hover { background: var(--bg-surface-high); color: var(--text-primary); }
  .btn-tab.active { background: var(--primary); color: #fff; }

  .info-bar { background: rgba(0,122,255,0.07); border: 1px solid rgba(0,122,255,0.2); border-radius: 8px; padding: 14px 18px; margin-bottom: 28px; display: flex; gap: 32px; flex-wrap: wrap; align-items: center; }
  .info-item { font-size: 0.88em; color: var(--text-secondary); }
  .info-item strong { color: var(--text-primary); }
  .info-item a { color: var(--primary); text-decoration: none; }
  .info-item a:hover { text-decoration: underline; }

  .section { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 24px; margin-bottom: 24px; }
  .provider-heading { font-size: 1em; font-weight: 600; margin-bottom: 16px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.75em; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 10px 12px; background: var(--bg-surface-high); color: var(--text-secondary); font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); font-weight: 500; }
  th.num { text-align: right; }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 0.88em; vertical-align: middle; }
  td.num { text-align: right; }
  tr:last-child td { border-bottom: none; }
  tr.row-official:hover td { background: rgba(57,255,20,0.03); }
  tr.row-other { opacity: 0.6; }
  tr.row-other:hover td { background: rgba(255,255,255,0.015); opacity: 1; }
  .sub { font-size: 0.85em; font-weight: 400; text-transform: none; letter-spacing: 0; }

  .model-name { font-weight: 500; font-size: 0.9em; }
  .model-id { font-size: 0.75em; color: var(--text-secondary); margin-top: 2px; font-family: var(--font-data); }

  .badge { font-size: 0.72em; padding: 2px 7px; border-radius: 10px; font-weight: 600; white-space: nowrap; }
  .badge-official { background: rgba(57,255,20,0.12); color: #39FF14; border: 1px solid rgba(57,255,20,0.3); }
  .badge-other { background: rgba(255,255,255,0.05); color: var(--text-secondary); border: 1px solid rgba(255,255,255,0.08); }

  .credits { color: #f9e2af; }

  .cat { font-size: 0.72em; padding: 2px 7px; border-radius: 10px; font-weight: 500; }
  .cat-powerful { background: rgba(255,77,77,0.12); color: #ff8a8a; }
  .cat-versatile { background: rgba(0,122,255,0.12); color: #6db3ff; }
  .cat-lightweight { background: rgba(57,255,20,0.10); color: #77dd77; }
  .cat-legacy { background: rgba(255,255,255,0.05); color: var(--text-secondary); }

  .formula-box { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; }
  .formula-box h2 { font-size: 1em; font-weight: 600; margin-bottom: 14px; }
  .formula { font-family: var(--font-data); font-size: 0.88em; background: var(--bg-surface-high); padding: 12px 16px; border-radius: 4px; color: #f9e2af; margin-bottom: 10px; white-space: pre; }
  .formula-note { font-size: 0.82em; color: var(--text-secondary); }

  .footer { text-align: center; padding: 16px; color: var(--text-secondary); font-size: 0.75em; font-style: italic; }
</style>
</head>
<body>
  <div class="header">
    <h1>💳 Copilot Pricing</h1>
    <div class="nav">
      <div class="btn-group">
        <button class="btn-tab" onclick="post('showDashboard')">🧠 Dashboard</button>
        <button class="btn-tab" onclick="post('showCharts')">📊 Charts</button>
        <button class="btn-tab" onclick="post('showUsageAnalysis')">📈 Usage</button>
        <button class="btn-tab" onclick="post('showDiagnostics')">🩺 Diagnostics</button>
        <button class="btn-tab" onclick="post('showSessions')">📋 Sessions</button>
        <button class="btn-tab active">💳 Pricing</button>
      </div>
    </div>
  </div>

  <div class="info-bar">
    <div class="info-item"><strong>1 AI credit</strong> = $0.01 USD</div>
    <div class="info-item"><strong>${officialCount} models</strong> officially listed in Copilot billing docs</div>
    <div class="info-item">Source: <a href="https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing">GitHub Copilot Models &amp; Pricing</a></div>
    <div class="info-item">Last updated: <strong>${lastUpdated}</strong></div>
  </div>

  <div class="formula-box">
    <h2>💡 Credit Calculation</h2>
    <div class="formula">credits = (input_tokens × input_$/1M  +  cache_read_tokens × cached_$/1M
           +  cache_write_tokens × write_$/1M  +  output_tokens × output_$/1M)  /  1,000,000  /  $0.01</div>
    <div class="formula-note">Code completions remain unlimited on paid Copilot plans and do not consume AI credits.</div>
  </div>

  ${providerSections}

  <div class="footer">Pricing from official GitHub Copilot billing documentation. Models marked "Official" are listed at docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing.</div>

  <script>
    const vsc = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;
    function post(cmd) { if (vsc) { vsc.postMessage({ command: cmd }); } }
    if (typeof window.vscode === 'undefined' && vsc) { window.vscode = vsc; }
  </script>
</body>
</html>`;
  }
}
