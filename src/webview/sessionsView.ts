import * as vscode from 'vscode';
import { Session } from '../types';

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
};

export class SessionsViewProvider {
  static readonly viewType = 'aiInsights.sessionsView';
  private static currentPanel: vscode.WebviewPanel | undefined;

  static createPanel(context: vscode.ExtensionContext, sessions: Session[]): vscode.WebviewPanel {
    const rows = SessionsViewProvider.toRows(sessions);
    const html = SessionsViewProvider.buildHtml(rows);

    if (SessionsViewProvider.currentPanel) {
      SessionsViewProvider.currentPanel.webview.html = html;
      SessionsViewProvider.currentPanel.reveal(vscode.ViewColumn.One);
      return SessionsViewProvider.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      SessionsViewProvider.viewType,
      'AI Sessions',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = html;

    panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.command === 'refresh') {
          vscode.commands.executeCommand('aiInsights.showSessionsView');
        } else if (message.command === 'showDashboard') {
          vscode.commands.executeCommand('aiInsights.showDashboard');
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
          aiCredits: Math.round(cost * 100 * 100) / 100, // cost / $0.01 per credit
        };
      });
  }

  // Build HTML using array join - esbuild cannot inline or mangle concatenation.
  // Data is serialised BEFORE this call; safe is a plain string at call time.
  static buildHtml(rows: SessionRow[]): string {
    const safe = JSON.stringify(rows).replace(/<\/script>/gi, '<\\/script>');
    const parts: string[] = [];

    parts.push('<!DOCTYPE html><html lang="en"><head>');
    parts.push('<meta charset="UTF-8">');
    parts.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    parts.push('<title>AI Sessions</title>');
    parts.push('<style>');
    parts.push(':root{--bg-base:#0e0e0e;--bg-surface:#1a1919;--bg-surface-high:#201f1f;--text-primary:#e5e2e1;--text-secondary:#c1c6d7;--primary:#007AFF;--primary-glow:rgba(0,122,255,0.2);--border:rgba(255,255,255,0.05);--font-primary:"Inter",system-ui,sans-serif;--font-data:"JetBrains Mono",monospace;}');
    parts.push('*{margin:0;padding:0;box-sizing:border-box;}');
    parts.push('body{font-family:var(--font-primary);background:var(--bg-base);color:var(--text-primary);padding:32px;line-height:1.6;}');
    parts.push('.header{display:flex;align-items:center;gap:16px;margin-bottom:32px;padding-bottom:16px;border-bottom:1px solid var(--border);}');
    parts.push('.header h1{font-size:2em;font-weight:600;letter-spacing:-0.02em;}');
    parts.push('.nav{display:flex;gap:8px;margin-left:auto;}');
    parts.push('.btn{background:transparent;border:1px solid var(--border);color:var(--text-primary);padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.85em;font-weight:500;transition:all 0.2s;}');
    parts.push('.btn:hover{background:rgba(255,255,255,0.05);}');
    parts.push('.btn-primary{background:var(--primary);color:white;border:none;box-shadow:0 0 15px var(--primary-glow);}');
    parts.push('.btn-primary:hover{background:#005bc1;}');
    parts.push('.filter-bar{display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;}');
    parts.push('.filter-label{font-size:0.8em;color:var(--text-secondary);white-space:nowrap;}');
    parts.push('.filter-bar select,.filter-bar input{background:var(--bg-surface);border:1px solid var(--border);color:var(--text-primary);padding:7px 12px;border-radius:4px;font-size:0.85em;font-family:var(--font-primary);outline:none;}');
    parts.push('.filter-bar select:focus,.filter-bar input:focus{border-color:var(--primary);}');
    parts.push('.filter-bar input{min-width:220px;}');
    parts.push('.count-badge{font-size:0.8em;color:var(--text-secondary);font-family:var(--font-data);}');
    parts.push('.legend{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;font-size:0.78em;color:var(--text-secondary);}');
    parts.push('.legend-item{display:flex;align-items:center;gap:5px;}');
    parts.push('.legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}');
    parts.push('.info-bar{margin-bottom:12px;padding:8px 12px;background:rgba(0,122,255,0.08);border:1px solid rgba(0,122,255,0.18);border-radius:6px;font-size:0.78em;color:#c1c6d7;font-family:var(--font-data);}');
    parts.push('.info-bar.warn{background:rgba(255,159,10,0.08);border-color:rgba(255,159,10,0.25);color:#FF9F0A;}');
    parts.push('.info-bar.err{background:rgba(255,74,74,0.1);border-color:rgba(255,74,74,0.3);color:#ff4a4a;}');
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
    parts.push('.tok-seg{height:100%;}');
    parts.push('.tok-labels{display:flex;flex-wrap:wrap;gap:6px 10px;font-family:var(--font-data);font-size:0.75em;line-height:1.4;}');
    parts.push('.tok-chip{display:inline-flex;align-items:center;gap:3px;white-space:nowrap;}');
    parts.push('.tok-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}');
    parts.push('.empty-state{text-align:center;padding:60px 20px;color:var(--text-secondary);}');
    parts.push('.footer{text-align:center;padding:16px;color:var(--text-secondary);font-size:0.75em;font-style:italic;}');
    parts.push('.data-text{font-family:var(--font-data);}');
    parts.push('</style></head><body>');

    parts.push('<div class="header">');
    parts.push('  <h1>&#128203; AI Sessions</h1>');
    parts.push('  <div class="nav">');
    parts.push('    <button class="btn btn-primary" id="refreshBtn">&#128260; Refresh</button>');
    parts.push('    <button class="btn" id="dashBtn">&#8592; Dashboard</button>');
    parts.push('  </div>');
    parts.push('</div>');

    parts.push('<div class="filter-bar">');
    parts.push('  <span class="filter-label">Provider</span>');
    parts.push('  <select id="providerFilter">');
    parts.push('    <option value="">All Providers</option>');
    parts.push('    <option value="claudeCode">Claude Code</option>');
    parts.push('    <option value="copilot">GitHub Copilot</option>');
    parts.push('    <option value="antigravity">Antigravity</option>');
    parts.push('    <option value="codex">Codex</option>');
    parts.push('  </select>');
    parts.push('  <span class="filter-label">Date range</span>');
    parts.push('  <select id="dateFilter">');
    parts.push('    <option value="30d">Last 30 Days</option>');
    parts.push('    <option value="today">Today</option>');
    parts.push('    <option value="7d">Last 7 Days</option>');
    parts.push('    <option value="thisMonth">This Month</option>');
    parts.push('    <option value="all">All Time</option>');
    parts.push('  </select>');
    parts.push('  <input type="text" id="searchFilter" placeholder="Filter by workspace or model..." />');
    parts.push('  <span class="count-badge" id="countBadge"></span>');
    parts.push('</div>');

    parts.push('<div class="legend">');
    parts.push('  <span class="legend-item"><span class="legend-dot" style="background:#007AFF"></span>Input</span>');
    parts.push('  <span class="legend-item"><span class="legend-dot" style="background:#39FF14"></span>Output</span>');
    parts.push('  <span class="legend-item"><span class="legend-dot" style="background:#f093fb"></span>Thinking</span>');
    parts.push('  <span class="legend-item"><span class="legend-dot" style="background:#FF9F0A"></span>Cache read</span>');
    parts.push('  <span class="legend-item"><span class="legend-dot" style="background:#FFD60A"></span>Cache write</span>');
    parts.push('</div>');

    // Info bar: shows loaded count and provider breakdown
    const counts: Record<string, number> = {};
    rows.forEach(r => { counts[r.provider] = (counts[r.provider] || 0) + 1; });
    const summary = Object.entries(counts).map(([p, n]) => p + ': ' + n).join(' · ');
    const infoText = rows.length + ' session' + (rows.length !== 1 ? 's' : '') + ' loaded' + (summary ? ' - ' + summary : '');
    parts.push('<div class="info-bar" id="infoBar">');
    parts.push(infoText);
    parts.push('</div>');

    parts.push('<div class="section"><div id="tableContainer"></div></div>');
    parts.push('<div class="footer">Sessions sorted by start time - newest first. Bar shows token composition.</div>');

    // Inline data - safe is a plain string at call time; join() cannot be inlined by esbuild
    parts.push('<script>window.__SESSIONS__=');
    parts.push(safe);
    parts.push(';</script>');

    parts.push('<script>');
    parts.push('(function(){');
    parts.push('  var vscode=acquireVsCodeApi();');
    parts.push('  var ALL_SESSIONS=window.__SESSIONS__||[];');
    parts.push('  var sortKey="startTime";');
    parts.push('  var sortDir=-1;');
    parts.push('  document.getElementById("refreshBtn").onclick=function(){vscode.postMessage({command:"refresh"});};');
    parts.push('  document.getElementById("dashBtn").onclick=function(){vscode.postMessage({command:"showDashboard"});};');
    parts.push('  document.getElementById("providerFilter").onchange=applyFilters;');
    parts.push('  document.getElementById("dateFilter").onchange=applyFilters;');
    parts.push('  document.getElementById("searchFilter").oninput=applyFilters;');
    parts.push('  function fmt(n){if(n>=1e6)return(n/1e6).toFixed(1)+"M";if(n>=1e3)return(n/1e3).toFixed(1)+"K";return String(n||0);}');
    parts.push('  function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}');
    parts.push('  function fmtDate(iso){var d=new Date(iso);var now=new Date();var today=new Date(now.getFullYear(),now.getMonth(),now.getDate());var day=new Date(d.getFullYear(),d.getMonth(),d.getDate());var diff=Math.round((today.getTime()-day.getTime())/86400000);var time=d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});if(diff===0)return"Today "+time;if(diff===1)return"Yesterday "+time;return d.toLocaleDateString([],{month:"short",day:"numeric"})+" "+time;}');
    parts.push('  function fmtDur(s,e){var ms=new Date(e).getTime()-new Date(s).getTime();if(ms<=0)return"-";var sec=Math.floor(ms/1000);if(sec<60)return sec+"s";var m=Math.floor(sec/60);if(m<60)return m+"m "+(sec%60)+"s";return Math.floor(m/60)+"h "+(m%60)+"m";}');
    parts.push('  function badge(p,n){var icons={copilot:"🤖",antigravity:"🚀",claudeCode:"🟣",codex:"⌘"};return"<span class=\\"provider-badge p-"+esc(p)+"\\">"+(icons[p]||"")+" "+esc(n)+"</span>";}');
    parts.push('  function breakdown(s){var slots=[{k:"totalInputTokens",c:"#007AFF",l:"Input"},{k:"totalOutputTokens",c:"#39FF14",l:"Output"},{k:"totalThinkingTokens",c:"#f093fb",l:"Thinking"},{k:"totalCacheReadTokens",c:"#FF9F0A",l:"Cache read"},{k:"totalCacheWriteTokens",c:"#FFD60A",l:"Cache write"}];var total=slots.reduce(function(a,sl){return a+(s[sl.k]||0);},0)||s.totalTokens||1;var segs=slots.filter(function(sl){return s[sl.k]>0;}).map(function(sl){var p=(s[sl.k]/total*100).toFixed(1);return"<div class=\\"tok-seg\\" style=\\"width:"+p+"%;background:"+sl.c+"\\" title=\\""+sl.l+": "+(s[sl.k]||0).toLocaleString()+" ("+p+"%)\\"></div>";}).join("");var chips=slots.filter(function(sl){return s[sl.k]>0;}).map(function(sl){var p=Math.round(s[sl.k]/total*100);return"<span class=\\"tok-chip\\"><span class=\\"tok-dot\\" style=\\"background:"+sl.c+"\\"></span>"+sl.l+" <span style=\\"color:"+sl.c+"\\">"+fmt(s[sl.k])+"</span> <span style=\\"opacity:0.5\\">("+p+"%)</span></span>";}).join("");var tc=s.totalToolCalls>0?"<span class=\\"tok-chip\\" style=\\"color:var(--text-secondary)\\">🔧 "+s.totalToolCalls+" tool call"+(s.totalToolCalls!==1?"s":"")+"</span>":"";return"<td class=\\"breakdown-cell\\"><div class=\\"tok-bar\\">"+(segs||"<div class=\\"tok-seg\\" style=\\"width:100%;background:rgba(255,255,255,0.08)\\"></div>")+"</div><div class=\\"tok-labels\\">"+chips+tc+"</div></td>";}');
    parts.push('  function applyFilters(){var pv=document.getElementById("providerFilter").value;var dv=document.getElementById("dateFilter").value;var sv=document.getElementById("searchFilter").value.toLowerCase().trim();var now=new Date();var ts=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();var ms=new Date(now.getFullYear(),now.getMonth(),1).getTime();var cuts={today:ts,"7d":ts-6*86400000,"30d":ts-29*86400000,thisMonth:ms};var cut=cuts[dv]||0;var f=ALL_SESSIONS.filter(function(s){if(pv&&s.provider!==pv)return false;if(cut&&new Date(s.startTime).getTime()<cut)return false;if(sv){var w=(s.workspace||"").toLowerCase();var m=(s.models||[]).join(" ").toLowerCase();if(!w.includes(sv)&&!m.includes(sv))return false;}return true;});f.sort(function(a,b){var va,vb;if(sortKey==="startTime"){va=new Date(a.startTime).getTime();vb=new Date(b.startTime).getTime();}else if(sortKey==="totalTokens"){va=a.totalTokens;vb=b.totalTokens;}else if(sortKey==="interactions"){va=a.interactions;vb=b.interactions;}else{va=a[sortKey];vb=b[sortKey];}return sortDir*(va>vb?1:va<vb?-1:0);});render(f);}');
    parts.push('  function sortBy(k){sortDir=sortKey===k?-sortDir:-1;sortKey=k;applyFilters();}');
    parts.push('  window.sortBy=sortBy;');
    parts.push('  function render(sessions){document.getElementById("countBadge").textContent=sessions.length+" session"+(sessions.length!==1?"s":"");if(sessions.length===0){var pEl=document.getElementById("providerFilter");var msg=ALL_SESSIONS.length===0?"No session data found. Click Refresh to rescan.":pEl.value?"No "+pEl.options[pEl.selectedIndex].text+" sessions in this range. Try All Providers.":"No sessions match filters.";document.getElementById("tableContainer").innerHTML="<div class=\\"empty-state\\">"+msg+"</div>";return;}var arrow=function(k){return sortKey===k?(sortDir===-1?" ↓":" ↑"):"";};var thc=function(k){return"sortable"+(sortKey===k?" sorted":"");};var rows=sessions.map(function(s){var repo=s.workspace?(s.workspace.replace(/\\\\\\\\/g,"/").split("/").pop()||s.workspace):"-";var mods=(s.models||[]).map(function(m){return"<span class=\\"model-tag\\">"+esc(m)+"</span>";}).join("")||"-";var titleCell=s.title?"<span class=\\"title-cell\\" title=\\""+esc(s.title)+"\\">" +esc(s.title)+"</span>":"<span style=\\"opacity:0.3\\">-</span>";var creditsCell=s.provider==="copilot"?"<td class=\\"credits-cell\\"><span class=\\"credits-badge\\">"+s.aiCredits.toFixed(2)+" cr</span><br><span style=\\"opacity:0.5;font-size:0.9em\\">$"+s.estimatedCostUsd.toFixed(4)+"</span></td>":"<td class=\\"credits-cell\\" style=\\"color:var(--text-secondary)\\">$"+s.estimatedCostUsd.toFixed(4)+"</td>";return"<tr><td class=\\"data-text\\">"+fmtDate(s.startTime)+"</td><td>"+badge(s.provider,s.providerName)+"</td><td>"+titleCell+"</td><td><span class=\\"ws-cell\\" title=\\""+esc(s.workspace||"")+"\\">"+ esc(repo)+"</span></td><td class=\\"data-text\\" style=\\"font-weight:600\\">"+fmt(s.totalTokens)+"</td>"+breakdown(s)+creditsCell+"<td class=\\"data-text\\">"+s.interactions+"</td><td>"+mods+"</td><td class=\\"data-text\\" style=\\"color:var(--text-secondary)\\">"+fmtDur(s.startTime,s.endTime)+"</td></tr>";}).join("");document.getElementById("tableContainer").innerHTML="<table><thead><tr><th class=\\""+thc("startTime")+"\\" onclick=\\"sortBy(\'startTime\')\\">Date"+arrow("startTime")+"</th><th>Provider</th><th>Session</th><th>Workspace</th><th class=\\""+thc("totalTokens")+"\\" onclick=\\"sortBy(\'totalTokens\')\\">Tokens"+arrow("totalTokens")+"</th><th>Breakdown</th><th>Cost / Credits</th><th class=\\""+thc("interactions")+"\\" onclick=\\"sortBy(\'interactions\')\\">Interactions"+arrow("interactions")+"</th><th>Models</th><th>Duration</th></tr></thead><tbody>"+rows+"</tbody></table>";}');
    parts.push('  applyFilters();');
    parts.push('})();');
    parts.push('</script>');
    parts.push('</body></html>');

    return parts.join('');
  }
}
