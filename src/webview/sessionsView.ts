import * as vscode from 'vscode';
import { Session } from '../types';
import { PROVIDER_ICONS } from './providerIcons';
import { computeContextRotScore, ContextRotScore } from '../core/contextRot';
import { navCss, navTopbarHtml, navPagebarHtml, navJs, NAV_COMMANDS } from './navShared';

type SessionRow = {
  id: string;
  provider: string;
  providerName: string;
  startTime: string;
  endTime: string;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalThinkingTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalToolCalls: number;
  interactions: number;
  models: string[];
  workspace: string;
  title: string;
  estimatedCostUsd: number;
  aiCredits: number;
  sourceFile: string;
  contextRot: ContextRotScore;
};

export class SessionsViewProvider {
  static readonly viewType = 'aiInsights.sessionsView';
  private static currentPanel: vscode.WebviewPanel | undefined;

  static createPanel(context: vscode.ExtensionContext, sessions: Session[], refreshing = false): vscode.WebviewPanel {
    const rows = SessionsViewProvider.toRows(sessions);
    const logoPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'logo.png');

    if (SessionsViewProvider.currentPanel) {
      const logoUri = SessionsViewProvider.currentPanel.webview.asWebviewUri(logoPath).toString();
      SessionsViewProvider.currentPanel.webview.html = SessionsViewProvider.buildHtml(rows, refreshing, logoUri);
      SessionsViewProvider.currentPanel.reveal(vscode.ViewColumn.One);
      return SessionsViewProvider.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      SessionsViewProvider.viewType,
      'AI Sessions',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'assets')],
      }
    );
    const logoUri = panel.webview.asWebviewUri(logoPath).toString();
    panel.webview.html = SessionsViewProvider.buildHtml(rows, refreshing, logoUri);

    panel.webview.onDidReceiveMessage(
      (message) => {
        const navCmd = NAV_COMMANDS[message.command];
        if (navCmd) { vscode.commands.executeCommand(navCmd); return; }
        if (message.command === 'refresh') {
          vscode.commands.executeCommand('aiInsights.showSessionsView');
        } else if (message.command === 'openSession' && message.sourceFile) {
          vscode.workspace.openTextDocument(vscode.Uri.file(message.sourceFile))
            .then(doc => vscode.window.showTextDocument(doc))
            .then(undefined, () => vscode.window.showErrorMessage(`Cannot open: ${message.sourceFile}`));
        } else if (message.command === 'exportSessions' && message.csv) {
          vscode.workspace.openTextDocument({ content: message.csv, language: 'csv' })
            .then(doc => vscode.window.showTextDocument(doc, vscode.ViewColumn.Two));
        }
      },
      undefined,
      context.subscriptions
    );

    panel.onDidDispose(() => {
      SessionsViewProvider.currentPanel = undefined;
    }, null, context.subscriptions);

    SessionsViewProvider.currentPanel = panel;
    return panel;
  }

  private static toRows(sessions: Session[]): SessionRow[] {
    return [...sessions]
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .map(s => {
        const cost = s.estimatedCostUsd ?? 0;
        return {
          id: s.id,
          provider: s.provider,
          providerName: s.providerName,
          startTime: s.startTime instanceof Date ? s.startTime.toISOString() : String(s.startTime),
          endTime: s.endTime instanceof Date ? s.endTime.toISOString() : String(s.endTime),
          totalTokens: s.totalTokens,
          totalInputTokens: s.totalInputTokens,
          totalOutputTokens: s.totalOutputTokens,
          totalThinkingTokens: s.totalThinkingTokens,
          totalCacheReadTokens: s.totalCacheReadTokens,
          totalCacheWriteTokens: s.totalCacheWriteTokens,
          totalToolCalls: (s.interactions || []).reduce((sum: number, i: any) => sum + (i.toolCalls?.length ?? 0), 0),
          interactions: (s.interactions || []).length,
          models: s.models,
          workspace: s.workspace,
          title: s.title || '',
          estimatedCostUsd: cost,
          aiCredits: Math.round(cost * 100 * 100) / 100,
          sourceFile: s.sourceFile || '',
          contextRot: computeContextRotScore(s),
        };
      });
  }

  static buildHtml(rows: SessionRow[], refreshing = false, logoUri = ''): string {
    const safe = JSON.stringify(rows).replace(/<\/script>/gi, '<\\/script>');
    const parts: string[] = [];

    parts.push('<!DOCTYPE html><html lang="en"><head>');
    parts.push('<meta charset="UTF-8">');
    parts.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    parts.push('<title>AI Sessions</title>');
    parts.push('<style>');
    parts.push(':root{--bg-base:#0e0e0e;--bg-surface:#1a1919;--bg-surface-high:#201f1f;--text-primary:#e5e2e1;--text-secondary:#c1c6d7;--primary:#007AFF;--primary-glow:rgba(0,122,255,0.2);--border:rgba(255,255,255,0.05);--font-primary:"Inter",system-ui,sans-serif;--font-data:"JetBrains Mono",monospace;}');
    parts.push('*{margin:0;padding:0;box-sizing:border-box;}');
    parts.push('body{font-family:var(--font-primary);background:var(--bg-base);color:var(--text-primary);padding:0;line-height:1.6;}');
    parts.push(navCss());
    parts.push('.btn{background:transparent;border:1px solid var(--border);color:var(--text-primary);padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.85em;font-weight:500;transition:all 0.2s;}');
    parts.push('.btn:hover{background:rgba(255,255,255,0.05);}');
    parts.push('.btn-primary{background:var(--primary);color:white;border:none;box-shadow:0 0 15px var(--primary-glow);}');
    parts.push('.btn-primary:hover{background:#005bc1;}');
    parts.push('.btn.is-loading{opacity:0.7;pointer-events:none;}');
    parts.push('.btn.is-loading::after{content:"";display:inline-block;width:10px;height:10px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite;margin-left:6px;vertical-align:middle;}');

    parts.push('.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;}');
    parts.push('.summary-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:20px;text-align:center;transition:transform 0.2s;position:relative;overflow:hidden;}');
    parts.push('.summary-card:hover{transform:translateY(-2px);border-color:rgba(0,122,255,0.3);}');
    parts.push('.summary-label{font-size:0.75em;text-transform:uppercase;color:var(--text-secondary);letter-spacing:0.05em;margin-bottom:8px;font-weight:600;}');
    parts.push('.summary-value{font-size:1.8em;font-weight:600;font-family:var(--font-data);color:var(--text-primary);}');
    parts.push('.summary-sub{font-size:0.8em;color:var(--text-secondary);margin-top:4px;opacity:0.7;}');

    parts.push('.filter-bar{display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;background:var(--bg-surface);padding:12px 16px;border-radius:8px;border:1px solid var(--border);}');
    parts.push('.filter-group{display:flex;align-items:center;gap:8px;}');
    parts.push('.filter-label{font-size:0.8em;color:var(--text-secondary);white-space:nowrap;}');
    parts.push('.filter-bar select,.filter-bar input{background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);padding:7px 12px;border-radius:4px;font-size:0.85em;font-family:var(--font-primary);outline:none;}');
    parts.push('.filter-bar select:focus,.filter-bar input:focus{border-color:var(--primary);}');
    parts.push('.filter-bar input{min-width:250px;}');

    parts.push('.chart-section{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:24px;margin-bottom:32px;display:grid;grid-template-columns:2fr 1fr;gap:24px;min-height:350px;}');
    parts.push('.chart-wrap{position:relative;height:300px;}');
    parts.push('@media(max-width:1000px){.chart-section{grid-template-columns:1fr;}}');

    parts.push('.legend{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;font-size:0.78em;color:var(--text-secondary);}');
    parts.push('.legend-item{display:flex;align-items:center;gap:5px;}');
    parts.push('.legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}');

    parts.push('.section{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;overflow-x:auto;margin-bottom:32px;}');
    parts.push('table{width:100%;min-width:1100px;border-collapse:collapse;}');
    parts.push('th{text-align:left;padding:11px 14px;background:var(--bg-surface-high);color:var(--text-secondary);font-size:0.72em;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border);font-weight:500;white-space:nowrap;}');
    parts.push('th.sortable{cursor:pointer;user-select:none;}');
    parts.push('th.sortable:hover{color:var(--text-primary);}');
    parts.push('th.sorted{color:var(--primary);}');
    parts.push('td{padding:10px 14px;border-bottom:1px solid var(--border);font-size:0.875em;vertical-align:middle;}');
    parts.push('tr:last-child td{border-bottom:none;}');
    parts.push('tr:hover td{background:rgba(255,255,255,0.02);}');

    parts.push('.provider-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:3px;font-size:0.8em;font-weight:500;white-space:nowrap;}');
    parts.push('.p-copilot{background:rgba(0,200,100,0.1);color:#00c864;}');
    parts.push('.p-antigravity{background:rgba(240,147,251,0.1);color:#f093fb;}');
    parts.push('.p-claudeCode{background:rgba(0,122,255,0.1);color:#007AFF;}');
    parts.push('.p-codex{background:rgba(52,199,89,0.1);color:#34C759;}');
    parts.push('.ws-cell{font-family:var(--font-data);font-size:0.82em;color:var(--text-secondary);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;}');
    parts.push('.title-cell{font-size:0.82em;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;color:var(--text-secondary);}');
    parts.push('.credits-cell{font-family:var(--font-data);font-size:0.82em;white-space:nowrap;}');
    parts.push('.credits-badge{display:inline-block;padding:2px 7px;background:rgba(0,200,100,0.1);border-radius:3px;color:#00c864;font-weight:600;}');
    parts.push('.model-tag{display:inline-block;padding:1px 6px;background:var(--bg-surface-high);border-radius:3px;font-size:0.75em;color:var(--text-secondary);font-family:var(--font-data);margin:1px 2px 1px 0;}');
    parts.push('.breakdown-cell{min-width:220px;}');
    parts.push('.tok-bar{display:flex;height:6px;border-radius:3px;overflow:hidden;margin-bottom:7px;background:rgba(255,255,255,0.04);}');
    parts.push('.tok-labels{display:flex;flex-wrap:wrap;gap:6px 10px;font-family:var(--font-data);font-size:0.75em;line-height:1.4;}');
    parts.push('.tok-chip{display:inline-flex;align-items:center;gap:3px;white-space:nowrap;}');
    parts.push('.tok-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}');
    parts.push('.footer{text-align:center;padding:16px;color:var(--text-secondary);font-size:0.75em;font-style:italic;}');
    parts.push('.data-text{font-family:var(--font-data);}');
    parts.push('.btn-open{background:transparent;border:1px solid var(--border);color:var(--text-secondary);padding:3px 8px;border-radius:3px;cursor:pointer;font-size:0.78em;white-space:nowrap;transition:all 0.15s;}');
    parts.push('.btn-open:hover{border-color:var(--primary);color:var(--primary);}');
    parts.push('.approx-price{font-family:var(--font-data);font-size:0.82em;color:var(--text-secondary);}');
    parts.push('.ctx-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:3px;font-size:0.78em;font-weight:600;white-space:nowrap;cursor:default;}');
    parts.push('.ctx-healthy{background:rgba(0,200,100,0.1);color:#00c864;}');
    parts.push('.ctx-warning{background:rgba(255,159,10,0.12);color:#FF9F0A;}');
    parts.push('.ctx-stale{background:rgba(255,59,48,0.12);color:#FF3B30;}');
    parts.push('.ctx-na{background:rgba(255,255,255,0.04);color:rgba(193,198,215,0.4);font-weight:400;}');
    parts.push('.loading-bar{position:fixed;top:0;left:0;right:0;z-index:100;height:3px;background:rgba(0,122,255,0.15);overflow:hidden;}');
    parts.push('.loading-bar-fill{height:100%;width:40%;background:var(--primary);border-radius:0 2px 2px 0;animation:loadslide 1.4s ease-in-out infinite;}');
    parts.push('@keyframes loadslide{0%{transform:translateX(-100%)}60%{transform:translateX(280%)}100%{transform:translateX(280%)}}');
    parts.push('.loading-banner{background:rgba(0,122,255,0.08);border-bottom:1px solid rgba(0,122,255,0.2);padding:8px 32px;font-size:0.82em;color:#6db3ff;display:flex;align-items:center;gap:8px;}');
    parts.push('.mini-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:14px;margin-bottom:16px;}');
    parts.push('.mini-card{background:var(--bg-surface-high);border:1px solid var(--border);border-radius:6px;padding:14px 16px;}');
    parts.push('.mini-label{font-size:0.72em;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);margin-bottom:8px;font-weight:600;}');
    parts.push('.mini-val{font-size:1.5em;font-weight:600;font-family:var(--font-data);color:var(--text-primary);}');
    parts.push('.mini-sub{font-size:0.75em;color:var(--text-secondary);margin-top:4px;}');
    parts.push('.complexity-section{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:20px 24px;margin-bottom:24px;}');
    parts.push('.complexity-section h2{font-size:1em;font-weight:600;margin-bottom:4px;letter-spacing:-0.01em;}');
    parts.push('.complexity-section .subtitle{font-size:0.8em;color:var(--text-secondary);margin-bottom:16px;}');
    parts.push('.highest-cost-box{background:var(--bg-surface-high);border-radius:4px;padding:10px 14px;font-size:0.82em;margin-top:12px;}');
    parts.push('.loading-spinner{width:12px;height:12px;border:2px solid rgba(0,122,255,0.3);border-top-color:var(--primary);border-radius:50%;animation:spin 0.7s linear infinite;flex-shrink:0;}');
    parts.push('@keyframes spin{to{transform:rotate(360deg)}}');
    parts.push('.pagination{display:flex;align-items:center;justify-content:center;gap:12px;padding:14px 16px;border-top:1px solid var(--border);}');
    parts.push('.pagination button{background:transparent;border:1px solid var(--border);color:var(--text-primary);padding:6px 14px;border-radius:4px;cursor:pointer;font-size:0.85em;transition:all 0.2s;}');
    parts.push('.pagination button:hover:not([disabled]){background:rgba(255,255,255,0.05);border-color:var(--primary);}');
    parts.push('.pagination button[disabled]{opacity:0.3;cursor:default;}');
    parts.push('.page-info{font-size:0.85em;color:var(--text-secondary);}');
    parts.push('</style></head><body>');

    parts.push(navTopbarHtml(logoUri, true, refreshing));
    if (refreshing) {
      parts.push('<div class="loading-bar"><div class="loading-bar-fill"></div></div>');
      parts.push('<div class="loading-banner"><div class="loading-spinner"></div>Loading sessions…</div>');
    }
    parts.push(navPagebarHtml('sessions', 'Sessions'));
    parts.push('<div class="ns-content">');
    parts.push('<div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">');
    parts.push('  <button class="btn" id="exportBtn" style="height:32px;">&#8615; Export CSV</button>');
    parts.push('</div>');

    parts.push('<div class="summary-grid">');
    parts.push('  <div class="summary-card"><div class="summary-label">Sessions</div><div class="summary-value" id="statSessions">0</div><div class="summary-sub" id="statInteractions">0 interactions</div></div>');
    parts.push('  <div class="summary-card"><div class="summary-label">Total Tokens</div><div class="summary-value" id="statTokens">0</div><div class="summary-sub" id="statTokenAvg">0 per session</div></div>');
    parts.push('  <div class="summary-card"><div class="summary-label">Estimated Cost</div><div class="summary-value" id="statCost">$0.00</div><div class="summary-sub" id="statCredits">0 credits</div></div>');
    parts.push('  <div class="summary-card"><div class="summary-label">Workspaces</div><div class="summary-value" id="statRepos">0</div><div class="summary-sub">Active contexts</div></div>');
    parts.push('</div>');

    parts.push('<div class="filter-bar">');
    parts.push('  <div class="filter-group"><span class="filter-label">Range</span><select id="dateFilter">');
    parts.push('    <option value="30d">Last 30 Days</option>');
    parts.push('    <option value="today">Today</option>');
    parts.push('    <option value="7d">Last 7 Days</option>');
    parts.push('    <option value="lastMonth">Last Month</option>');
    parts.push('    <option value="thisMonth">This Month</option>');
    parts.push('    <option value="thisYear" selected>This Year</option>');
    parts.push('    <option value="all">All Time</option>');
    parts.push('  </select></div>');
    parts.push('  <div class="filter-group"><span class="filter-label">Provider</span><select id="providerFilter"><option value="">All</option><option value="claudeCode">Claude Code</option><option value="copilot">Copilot</option><option value="antigravity">Antigravity</option><option value="codex">Codex</option></select></div>');
    parts.push('  <div class="filter-group"><span class="filter-label">Metric</span><select id="metricType"><option value="tokens">Token Consumption</option><option value="sessions">Usage (Sessions)</option></select></div>');
    parts.push('  <div class="filter-group"><span class="filter-label">By</span><select id="breakdownType"><option value="provider">Provider</option><option value="model">Model</option><option value="workspace">Repository</option></select></div>');
    parts.push('  <input type="text" id="searchFilter" placeholder="Search sessions, models, repos..." />');
    parts.push('</div>');

    parts.push('<div class="chart-section">');
    parts.push('  <div class="chart-wrap"><canvas id="usageChart"></canvas></div>');
    parts.push('  <div class="chart-wrap"><canvas id="distChart"></canvas></div>');
    parts.push('</div>');

    parts.push('<div class="legend">');
    parts.push('  <span class="legend-item"><span class="legend-dot" style="background:#007AFF"></span>Input</span>');
    parts.push('  <span class="legend-item"><span class="legend-dot" style="background:#39FF14"></span>Output</span>');
    parts.push('  <span class="legend-item"><span class="legend-dot" style="background:#f093fb"></span>Thinking</span>');
    parts.push('  <span class="legend-item"><span class="legend-dot" style="background:#FF9F0A"></span>Cache read</span>');
    parts.push('  <span class="legend-item"><span class="legend-dot" style="background:#FFD60A"></span>Cache write</span>');
    parts.push('</div>');

    // Session Complexity widget
    parts.push('<div class="complexity-section" id="complexityWidget">');
    parts.push('  <h2>\uD83D\uDD0D Session Complexity</h2>');
    parts.push('  <p class="subtitle">Breakdown of session depth and cost drivers &mdash; updates with active filters</p>');
    parts.push('  <div class="mini-grid">');
    parts.push('    <div class="mini-card"><div class="mini-label">Avg Session Depth</div><div class="mini-val" id="scDepth">-</div><div class="mini-sub">interactions / session</div></div>');
    parts.push('    <div class="mini-card"><div class="mini-label">Avg Duration</div><div class="mini-val" id="scDuration">-</div><div class="mini-sub">minutes / session</div></div>');
    parts.push('    <div class="mini-card"><div class="mini-label">Long Sessions &gt;30 min</div><div class="mini-val" id="scLong">-</div><div class="mini-sub" id="scLongCost"></div></div>');
    parts.push('    <div class="mini-card"><div class="mini-label">Tool-Heavy Sessions</div><div class="mini-val" id="scToolHeavy">-</div><div class="mini-sub">&gt;5 unique tools</div></div>');
    parts.push('    <div class="mini-card"><div class="mini-label">Thinking Sessions</div><div class="mini-val" id="scThinking">-</div><div class="mini-sub">extended reasoning used</div></div>');
    parts.push('    <div class="mini-card"><div class="mini-label">Multi-Model Sessions</div><div class="mini-val" id="scMultiModel">-</div><div class="mini-sub">&gt;1 model per session</div></div>');
    parts.push('  </div>');
    parts.push('  <div class="highest-cost-box" id="scHighestCost" style="display:none"></div>');
    parts.push('</div>');

    parts.push('<div class="section"><div id="tableContainer"></div></div>');
    parts.push('<div class="footer">Deep session analysis for AI-assisted development. Data updated in real-time.</div>');
    parts.push('</div><!-- /ns-content -->');

    parts.push('<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>');
    parts.push('<script>window.__SESSIONS__=');
    parts.push(safe);
    parts.push(';</script>');

    parts.push('<script>');
    parts.push('(function(){');
    parts.push('  var vscode=acquireVsCodeApi();');
    parts.push('  window.vscode=vscode;');
    parts.push('  var ALL_SESSIONS=window.__SESSIONS__||[];');
    parts.push('  var sortKey="startTime";');
    parts.push('  var sortDir=-1;');
    parts.push('  var usageChart, distChart;');
    parts.push('  var currentFiltered=ALL_SESSIONS.slice();');
    parts.push('  var currentPage=0;');
    parts.push('  var PAGE_SIZE=50;');
    parts.push('  Chart.defaults.font.family="var(--font-primary)";');
    parts.push('  Chart.defaults.color="#c1c6d7";');

    parts.push('  function _clr(){document.querySelectorAll(".is-loading").forEach(function(e){e.classList.remove("is-loading");});var r=document.getElementById("btnRefresh");if(r)r.textContent="\u21ba Refresh";}');
    parts.push('  var _rb=document.getElementById("btnRefresh");if(_rb){_rb.addEventListener("click",function(){_rb.classList.add("is-loading");_rb.textContent="\u27f3 Refreshing\u2026";vscode.postMessage({command:"refresh"});setTimeout(_clr,5000);});}');
    parts.push('  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible"){_clr();}});');
    parts.push('  document.getElementById("exportBtn").onclick=function(){');
    parts.push('    var headers=["Date","Provider","Title","Workspace","Total Tokens","Input","Output","Thinking","Cache Read","Cache Write","Cost USD","Interactions","Models","Duration"];');
    parts.push('    var rows=currentFiltered.map(function(s){');
    parts.push('      return[s.startTime,s.providerName,s.title,s.workspace,s.totalTokens,s.totalInputTokens,s.totalOutputTokens,s.totalThinkingTokens,s.totalCacheReadTokens,s.totalCacheWriteTokens,s.estimatedCostUsd.toFixed(6),s.interactions,(s.models||[]).join(";"),fmtDur(s.startTime,s.endTime)].map(function(v){return\'"\'+String(v||"").replace(/"/g,\'""\')+\'"\';}).join(",");');
    parts.push('    });');
    parts.push('    var csv=[headers.join(",")].concat(rows).join("\\n");');
    parts.push('    vscode.postMessage({command:"exportSessions",csv:csv});');
    parts.push('  };');
    parts.push('  function saveState(){try{vscode.setState({df:document.getElementById("dateFilter").value,pf:document.getElementById("providerFilter").value,mt:document.getElementById("metricType").value,bt:document.getElementById("breakdownType").value,sf:document.getElementById("searchFilter").value,sk:sortKey,sd:sortDir});}catch(e){}}');
    parts.push('  (function restoreState(){try{var st=vscode.getState();if(!st)return;if(st.df)document.getElementById("dateFilter").value=st.df;if(st.pf)document.getElementById("providerFilter").value=st.pf;if(st.mt)document.getElementById("metricType").value=st.mt;if(st.bt)document.getElementById("breakdownType").value=st.bt;if(st.sf)document.getElementById("searchFilter").value=st.sf;if(st.sk)sortKey=st.sk;if(st.sd!=null)sortDir=st.sd;}catch(e){}})();');
    parts.push('  document.getElementById("providerFilter").onchange=applyFilters;');
    parts.push('  document.getElementById("dateFilter").onchange=applyFilters;');
    parts.push('  document.getElementById("metricType").onchange=applyFilters;');
    parts.push('  document.getElementById("breakdownType").onchange=applyFilters;');
    parts.push('  document.getElementById("searchFilter").oninput=applyFilters;');

    parts.push('  function openSession(idx){var s=currentFiltered[idx];if(s&&s.sourceFile)vscode.postMessage({command:"openSession",sourceFile:s.sourceFile});}');
    parts.push('  window.openSession=openSession;');
    parts.push('  function fmt(n){if(n>=1e6)return(n/1e6).toFixed(1)+"M";if(n>=1e3)return(n/1e3).toFixed(1)+"K";return String(n||0);}');
    parts.push('  function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}');
    parts.push('  function fmtDate(iso){var d=new Date(iso);var now=new Date();var today=new Date(now.getFullYear(),now.getMonth(),now.getDate());var day=new Date(d.getFullYear(),d.getMonth(),d.getDate());var diff=Math.round((today.getTime()-day.getTime())/86400000);var time=d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});if(diff===0)return"Today "+time;if(diff===1)return"Yesterday "+time;return d.toLocaleDateString([],{month:"short",day:"numeric"})+" "+time;}');
    parts.push('  function fmtDur(s,e){var ms=new Date(e).getTime()-new Date(s).getTime();if(ms<=0)return"-";var sec=Math.floor(ms/1000);if(sec<60)return sec+"s";var m=Math.floor(sec/60);if(m<60)return m+"m "+(sec%60)+"s";return Math.floor(m/60)+"h "+(m%60)+"m";}');
    parts.push(`  function badge(p,n){var icons=${JSON.stringify(PROVIDER_ICONS)};return"<span class=\\"provider-badge p-"+esc(p)+"\\">"+(icons[p]||"")+esc(n)+"</span>";}`);
    parts.push('  function breakdown(s){');
    parts.push('    var slots=[{k:"totalInputTokens",c:"#007AFF",l:"Input"},{k:"totalOutputTokens",c:"#39FF14",l:"Output"},{k:"totalThinkingTokens",c:"#f093fb",l:"Thinking"},{k:"totalCacheReadTokens",c:"#FF9F0A",l:"Cache read"},{k:"totalCacheWriteTokens",c:"#FFD60A",l:"Cache write"}];');
    parts.push('    var total=slots.reduce(function(a,sl){return a+(s[sl.k]||0);},0)||s.totalTokens||1;');
    parts.push('    var segs=slots.filter(function(sl){return s[sl.k]>0;}).map(function(sl){var p=(s[sl.k]/total*100).toFixed(1);return"<div class=\\"tok-seg\\" style=\\"width:"+p+"%;background:"+sl.c+"\\" title=\\""+sl.l+": "+(s[sl.k]||0).toLocaleString()+" ("+p+"%)\\"></div>";}).join("");');
    parts.push('    var chips=slots.filter(function(sl){return s[sl.k]>0;}).map(function(sl){var p=Math.round(s[sl.k]/total*100);return"<span class=\\"tok-chip\\"><span class=\\"tok-dot\\" style=\\"background:"+sl.c+"\\"></span>"+sl.l+" <span style=\\"color:"+sl.c+"\\">"+fmt(s[sl.k])+"</span> <span style=\\"opacity:0.5\\">("+p+"%)</span></span>";}).join("");');
    parts.push('    var tc=s.totalToolCalls>0?"<span class=\\"tok-chip\\" style=\\"color:var(--text-secondary)\\">🔧 "+s.totalToolCalls+" tool call"+(s.totalToolCalls!==1?"s":"")+"</span>":"";');
    parts.push('    return"<td class=\\"breakdown-cell\\"><div class=\\"tok-bar\\">"+(segs||"<div class=\\"tok-seg\\" style=\\"width:100%;background:rgba(255,255,255,0.08)\\"></div>")+"</div><div class=\\"tok-labels\\">"+chips+tc+"</div></td>";');
    parts.push('  }');

    parts.push('  function applyFilters(){');
    parts.push('    var pv=document.getElementById("providerFilter").value;');
    parts.push('    var dv=document.getElementById("dateFilter").value;');
    parts.push('    var sv=document.getElementById("searchFilter").value.toLowerCase().trim();');
    parts.push('    var now=new Date();');
    parts.push('    var todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();');
    parts.push('    var yearStart=new Date(now.getFullYear(),0,1).getTime();');
    parts.push('    var monthStart=new Date(now.getFullYear(),now.getMonth(),1).getTime();');
    parts.push('    var lastMonthStart=new Date(now.getFullYear(),now.getMonth()-1,1).getTime();');
    parts.push('    var lastMonthEnd=new Date(now.getFullYear(),now.getMonth(),0,23,59,59,999).getTime();');

    parts.push('    var f=ALL_SESSIONS.filter(function(s){');
    parts.push('      if(pv&&s.provider!==pv)return false;');
    parts.push('      var st=new Date(s.startTime).getTime();');
    parts.push('      if(dv==="today" && st<todayStart)return false;');
    parts.push('      if(dv==="7d" && st<(todayStart-6*86400000))return false;');
    parts.push('      if(dv==="30d" && st<(todayStart-29*86400000))return false;');
    parts.push('      if(dv==="thisMonth" && st<monthStart)return false;');
    parts.push('      if(dv==="lastMonth" && (st<lastMonthStart || st>lastMonthEnd))return false;');
    parts.push('      if(dv==="thisYear" && st<yearStart)return false;');
    parts.push('      if(sv){');
    parts.push('        var w=(s.workspace||"").toLowerCase();');
    parts.push('        var m=(s.models||[]).join(" ").toLowerCase();');
    parts.push('        var t=(s.title||"").toLowerCase();');
    parts.push('        if(!w.includes(sv)&&!m.includes(sv)&&!t.includes(sv))return false;');
    parts.push('      }');
    parts.push('      return true;');
    parts.push('    });');

    parts.push('    f.sort(function(a,b){');
    parts.push('      var va,vb;');
    parts.push('      if(sortKey==="startTime"){va=new Date(a.startTime).getTime();vb=new Date(b.startTime).getTime();}');
    parts.push('      else if(sortKey==="totalTokens"){va=a.totalTokens;vb=b.totalTokens;}');
    parts.push('      else if(sortKey==="interactions"){va=a.interactions;vb=b.interactions;}');
    parts.push('      else{va=a[sortKey];vb=b[sortKey];}');
    parts.push('      return sortDir*(va>vb?1:va<vb?-1:0);');
    parts.push('    });');

    parts.push('    currentFiltered=f;');
    parts.push('    currentPage=0;');
    parts.push('    render(f);');
    parts.push('    updateCharts(f);');
    parts.push('    updateStats(f);');
    parts.push('    updateComplexity(f);');
    parts.push('    saveState();');
    parts.push('  }');

    parts.push('  function updateStats(sessions){');
    parts.push('    var totalTokens=0,totalCost=0,totalInteractions=0,copilotCredits=0,repos=new Set();');
    parts.push('    sessions.forEach(function(s){');
    parts.push('      totalTokens+=s.totalTokens;totalCost+=s.estimatedCostUsd;totalInteractions+=s.interactions;');
    parts.push('      if(s.provider==="copilot")copilotCredits+=s.aiCredits;');
    parts.push('      if(s.workspace)repos.add(s.workspace.replace(/\\\\\\\\/g,"/").split("/").pop()||s.workspace);');
    parts.push('    });');
    parts.push('    document.getElementById("statSessions").textContent=sessions.length;');
    parts.push('    document.getElementById("statInteractions").textContent=totalInteractions.toLocaleString()+" interactions";');
    parts.push('    document.getElementById("statTokens").textContent=fmt(totalTokens);');
    parts.push('    document.getElementById("statTokenAvg").textContent=sessions.length?fmt(Math.round(totalTokens/sessions.length))+" avg/session":"-";');
    parts.push('    document.getElementById("statCost").textContent="$"+totalCost.toFixed(2);');
    parts.push('    document.getElementById("statCredits").textContent=copilotCredits>0?Math.round(copilotCredits)+" Copilot credits":"Copilot credits N/A";');
    parts.push('    document.getElementById("statRepos").textContent=repos.size;');
    parts.push('  }');

    parts.push('  function updateComplexity(sessions){');
    parts.push('    if(!sessions.length){');
    parts.push('      ["scDepth","scDuration","scLong","scToolHeavy","scThinking","scMultiModel"].forEach(function(id){var e=document.getElementById(id);if(e)e.textContent="-";});');
    parts.push('      var hc=document.getElementById("scHighestCost");if(hc)hc.style.display="none";');
    parts.push('      return;');
    parts.push('    }');
    parts.push('    var totalDepth=0,totalDurMs=0,longCount=0,longCost=0,toolHeavy=0,thinking=0,multiModel=0,highCost=0,highSess=null;');
    parts.push('    sessions.forEach(function(s){');
    parts.push('      totalDepth+=s.interactions;');
    parts.push('      var dur=new Date(s.endTime).getTime()-new Date(s.startTime).getTime();');
    parts.push('      if(dur>0)totalDurMs+=dur;');
    parts.push('      if(dur>30*60*1000){longCount++;longCost+=s.estimatedCostUsd;}');
    parts.push('      if(s.totalToolCalls>5)toolHeavy++;');
    parts.push('      if(s.totalThinkingTokens>0)thinking++;');
    parts.push('      if((s.models||[]).length>1)multiModel++;');
    parts.push('      if(s.estimatedCostUsd>highCost){highCost=s.estimatedCostUsd;highSess=s;}');
    parts.push('    });');
    parts.push('    var n=sessions.length;');
    parts.push('    var avgDepth=(totalDepth/n).toFixed(1);');
    parts.push('    var avgDurMin=((totalDurMs/n)/60000).toFixed(1);');
    parts.push('    document.getElementById("scDepth").textContent=avgDepth;');
    parts.push('    document.getElementById("scDuration").textContent=avgDurMin+" min";');
    parts.push('    document.getElementById("scLong").textContent=longCount;');
    parts.push('    var lc=document.getElementById("scLongCost");if(lc)lc.textContent=longCount?"cost $"+longCost.toFixed(4):"";');
    parts.push('    document.getElementById("scToolHeavy").textContent=toolHeavy;');
    parts.push('    document.getElementById("scThinking").textContent=thinking;');
    parts.push('    document.getElementById("scMultiModel").textContent=multiModel;');
    parts.push('    var hcBox=document.getElementById("scHighestCost");');
    parts.push('    if(hcBox&&highSess&&highSess.estimatedCostUsd>0){');
    parts.push('      hcBox.style.display="";');
    parts.push('      hcBox.innerHTML="<strong>\u{1F4B0} Highest-Cost Session</strong> &nbsp;&middot;&nbsp; <span style=\'color:var(--text-secondary)\'>ID: "+esc(highSess.id)+"</span>&nbsp;&middot;&nbsp; <strong>$"+highSess.estimatedCostUsd.toFixed(4)+"</strong>&nbsp;&middot;&nbsp; "+fmt(highSess.totalTokens)+" tokens";');
    parts.push('    } else if(hcBox){hcBox.style.display="none";}');
    parts.push('  }');

    parts.push('  function updateCharts(sessions){');
    parts.push('    var metric=document.getElementById("metricType").value;');
    parts.push('    var breakdown=document.getElementById("breakdownType").value;');
    parts.push('    var daily={}, dailySessions={}, dist={};');

    parts.push('    sessions.forEach(function(s){');
    parts.push('      var d=s.startTime.split("T")[0];');
    parts.push('      var val=(metric==="tokens")?s.totalTokens:1;');
    parts.push('      daily[d]=(daily[d]||0)+val;');
    parts.push('      dailySessions[d]=(dailySessions[d]||0)+1;');

    parts.push('      var key="Unknown";');
    parts.push('      if(breakdown==="model")key=(s.models&&s.models.length)?s.models[0]:"Unknown";');
    parts.push('      else if(breakdown==="workspace")key=s.workspace?(s.workspace.replace(/\\\\\\\\/g,"/").split("/").pop()||s.workspace):"Unknown";');
    parts.push('      else key=s.providerName||s.provider;');
    parts.push('      dist[key]=(dist[key]||0)+val;');
    parts.push('    });');

    parts.push('    var sortedDates=Object.keys(daily).sort();');
    parts.push('    var ctx1=document.getElementById("usageChart");if(usageChart)usageChart.destroy();');
    parts.push('    var ds1={type:"bar",label:metric==="tokens"?"Tokens":"Sessions",data:sortedDates.map(d=>daily[d]),backgroundColor:"rgba(0,122,255,0.5)",borderColor:"#007AFF",borderWidth:1,yAxisID:"y"};');
    parts.push('    var ds2={type:"line",label:"Sessions",data:sortedDates.map(d=>dailySessions[d]||0),borderColor:"#39FF14",backgroundColor:"rgba(57,255,20,0.08)",borderWidth:2,pointRadius:3,pointBackgroundColor:"#39FF14",tension:0.3,yAxisID:"y2"};');
    parts.push('    var showDual=metric==="tokens";');
    parts.push('    var chartScales={y:{beginAtZero:true,grid:{color:"rgba(255,255,255,0.05)"},ticks:{color:"#007AFF",callback:function(v){return fmt(v);}},position:"left"},x:{grid:{display:false}}};');
    parts.push('    if(showDual)chartScales.y2={beginAtZero:true,grid:{display:false},ticks:{color:"#39FF14",stepSize:1},position:"right"};');
    parts.push('    usageChart=new Chart(ctx1,{type:"bar",data:{labels:sortedDates,datasets:showDual?[ds1,ds2]:[ds1]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{display:showDual,labels:{color:"#c1c6d7",font:{size:11},boxWidth:12,padding:12}},title:{display:true,text:"Daily "+(metric==="tokens"?"Token Consumption":"Usage"),color:"#e5e2e1"}},scales:chartScales}});');

    parts.push('    var distLabels=Object.keys(dist).sort((a,b)=>dist[b]-dist[a]);');
    parts.push('    var colors=["#007AFF","#39FF14","#f093fb","#FF9F0A","#FFD60A","#00c864","#FF3B30","#5856D6","#FF9500"];');
    parts.push('    var ctx2=document.getElementById("distChart");if(distChart)distChart.destroy();');
    parts.push('    distChart=new Chart(ctx2,{type:"doughnut",data:{labels:distLabels,datasets:[{data:distLabels.map(l=>dist[l]),backgroundColor:distLabels.map((_,i)=>colors[i%colors.length]),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"right",labels:{boxWidth:12,color:"#c1c6d7",padding:8,font:{size:11}}},title:{display:true,text:"By "+breakdown.charAt(0).toUpperCase()+breakdown.slice(1),color:"#e5e2e1"}},cutout:"65%"}});');
    parts.push('  }');

    parts.push('  function costCell(s){');
    parts.push('    if(s.provider==="copilot"){');
    parts.push('      return "<td class=\\"credits-cell\\"><span class=\\"credits-badge\\">"+s.aiCredits.toFixed(2)+" cr</span><br><span style=\\"opacity:0.5;font-size:0.9em\\">$"+s.estimatedCostUsd.toFixed(4)+"</span></td>";');
    parts.push('    }');
    parts.push('    return "<td class=\\"credits-cell\\"><span class=\\"approx-price\\">~$"+s.estimatedCostUsd.toFixed(4)+"</span></td>";');
    parts.push('  }');

    parts.push('  function contextHealthCell(s){');
    parts.push('    var cr=s.contextRot;');
    parts.push('    if(!cr)return"<td><span class=\\"ctx-badge ctx-na\\">—</span></td>";');
    parts.push('    var icons={"healthy":"●","warning":"●","stale":"●"};');
    parts.push('    var labels={"healthy":"Healthy","warning":"Warn","stale":"Stale"};');
    parts.push('    var ageStr=cr.sessionAgeMinutes<60?Math.round(cr.sessionAgeMinutes)+"m":Math.floor(cr.sessionAgeMinutes/60)+"h"+(Math.round(cr.sessionAgeMinutes%60)>0?Math.round(cr.sessionAgeMinutes%60)+"m":"");');
    parts.push('    var growthNote=cr.turnsCount<6?" (limited: <6 turns)":"";');
    parts.push('    var tip="Score: "+cr.score+"/10\\nTurns: "+cr.turnsCount+"\\nAge: "+ageStr+"\\nInput bloat: "+cr.inputBloatFactor.toFixed(1)+"x"+growthNote+"\\nOutput trend: "+cr.outputDeclineFactor.toFixed(2)+"x"+growthNote;');
    parts.push('    return"<td><span class=\\"ctx-badge ctx-"+cr.label+"\\" title=\\""+tip.replace(/"/g,\'&quot;\').replace(/\\n/g,\'&#10;\')+"\\">" +icons[cr.label]+" "+labels[cr.label]+"</span></td>";');
    parts.push('  }');
    parts.push('  function render(sessions){');
    parts.push('    if(sessions.length===0){document.getElementById("tableContainer").innerHTML="<div class=\\"empty-state\\">No sessions match current filters.</div>";return;}');
    parts.push('    var totalPages=Math.max(1,Math.ceil(sessions.length/PAGE_SIZE));');
    parts.push('    if(currentPage>=totalPages)currentPage=totalPages-1;');
    parts.push('    var pageStart=currentPage*PAGE_SIZE;');
    parts.push('    var pageSessions=sessions.slice(pageStart,pageStart+PAGE_SIZE);');
    parts.push('    var arrow=k=>sortKey===k?(sortDir===-1?" ↓":" ↑"):"";');
    parts.push('    var thc=k=>"sortable"+(sortKey===k?" sorted":"");');
    parts.push('    var rows=pageSessions.map(function(s,relIdx){');
    parts.push('      var idx=pageStart+relIdx;');
    parts.push('      var repo=s.workspace?(s.workspace.replace(/\\\\\\\\/g,"/").split("/").pop()||s.workspace):"-";');
    parts.push('      var mods=(s.models||[]).map(m=>"<span class=\\"model-tag\\">"+esc(m)+"</span>").join("")||"-";');
    parts.push('      var titleCell=s.title?"<span class=\\"title-cell\\" title=\\""+esc(s.title)+"\\">" +esc(s.title)+"</span>":"<span style=\\"opacity:0.3\\">-</span>";');
    parts.push('      var openBtn=s.sourceFile?"<button class=\\"btn-open\\" onclick=\\"openSession("+idx+")\\">Open</button>":"";');
    parts.push('      return "<tr><td class=\\"data-text\\">"+fmtDate(s.startTime)+"</td><td>"+badge(s.provider,s.providerName)+"</td><td>"+titleCell+"</td><td><span class=\\"ws-cell\\" title=\\""+esc(s.workspace||"")+"\\">"+ esc(repo)+"</span></td><td class=\\"data-text\\" style=\\"font-weight:600\\">"+fmt(s.totalTokens)+"</td>"+breakdown(s)+costCell(s)+contextHealthCell(s)+"<td class=\\"data-text\\">"+s.interactions+"</td><td>"+mods+"</td><td class=\\"data-text\\" style=\\"color:var(--text-secondary)\\">"+fmtDur(s.startTime,s.endTime)+"</td><td>"+openBtn+"</td></tr>";');
    parts.push('    }).join("");');
    parts.push('    var pgHtml=totalPages>1?"<div class=\\"pagination\\"><button onclick=\\"goToPage("+(currentPage-1)+")\\" "+(currentPage===0?"disabled":"")+">&#8592; Prev</button><span class=\\"page-info\\">Page "+(currentPage+1)+" of "+totalPages+" &middot; "+sessions.length+" sessions</span><button onclick=\\"goToPage("+(currentPage+1)+")\\" "+(currentPage>=totalPages-1?"disabled":"")+">Next &#8594;</button></div>":"";');
    parts.push('    var ctxHint="Context Health \\u24d8";');
    parts.push('    var ctxTip="Score 0\\u201310 from 5 signals:\\n\\u2022 Turn count  (>40 turns \\u2192 +1, >80 \\u2192 +2)\\n\\u2022 Session age  (>60 min \\u2192 +1, >120 min \\u2192 +2)\\n\\u2022 Input bloat  last-third vs first-third avg input (>1.5\\u00d7 \\u2192 +1, >2\\u00d7 \\u2192 +2, >4\\u00d7 \\u2192 +3)\\n\\u2022 Output decline  last-third vs first-third avg output (<0.65\\u00d7 \\u2192 +1, <0.4\\u00d7 \\u2192 +2)\\n\\u2022 Total input size  (>80K \\u2192 +1, >200K \\u2192 +2)\\n\\nGrowth signals require \\u22656 turns to activate.\\n\\n\\u25cf 0\\u20133 Healthy  \\u25cf 4\\u20136 Warn  \\u25cf 7\\u201310 Stale";');
    parts.push('    document.getElementById("tableContainer").innerHTML="<table><thead><tr><th class=\\""+thc("startTime")+"\\" onclick=\\"sortBy(\'startTime\')\\">Date"+arrow("startTime")+"</th><th>Provider</th><th>Session</th><th>Workspace</th><th class=\\""+thc("totalTokens")+"\\" onclick=\\"sortBy(\'totalTokens\')\\">Tokens"+arrow("totalTokens")+"</th><th>Breakdown</th><th>Cost</th><th style=\\"cursor:help\\" title=\\""+ctxTip.replace(/"/g,\'&quot;\').replace(/\\n/g,\'&#10;\')+"\\">" +ctxHint+"</th><th class=\\""+thc("interactions")+"\\" onclick=\\"sortBy(\'interactions\')\\">Interactions"+arrow("interactions")+"</th><th>Models</th><th>Duration</th><th></th></tr></thead><tbody>"+rows+"</tbody></table>"+pgHtml;');
    parts.push('  }');

    parts.push('  function sortBy(k){sortDir=sortKey===k?-sortDir:-1;sortKey=k;currentPage=0;applyFilters();}');
    parts.push('  function goToPage(p){currentPage=p;render(currentFiltered);}');
    parts.push('  window.sortBy=sortBy;');
    parts.push('  window.goToPage=goToPage;');
    parts.push('  applyFilters();');
    parts.push('})();');
    parts.push(navJs());
    parts.push('</script>');
    parts.push('</body></html>');

    return parts.join('');
  }
}
