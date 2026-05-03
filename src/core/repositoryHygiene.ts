import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileStatus, InstructionQuality, RepositoryHygieneReport, Session } from '../types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function checkFile(...candidates: string[]): FileStatus {
  for (const p of candidates) {
    try {
      const stat = fs.statSync(p);
      return { exists: true, fresh: Date.now() - stat.mtimeMs < THIRTY_DAYS_MS };
    } catch { /* not found */ }
  }
  return { exists: false, fresh: false };
}

const INSTRUCTION_CANDIDATES: Array<{ relPath: string; label: string }> = [
  { relPath: 'CLAUDE.md', label: 'CLAUDE.md' },
  { relPath: 'claude.md', label: 'CLAUDE.md' },
  { relPath: '.github/copilot-instructions.md', label: 'copilot-instructions.md' },
  { relPath: '.cursorrules', label: '.cursorrules' },
  { relPath: '.clinerules', label: '.clinerules' },
  { relPath: 'AGENTS.md', label: 'AGENTS.md' },
];

function analyzeInstructionFile(filePath: string, label: string): InstructionQuality | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    const hasSections = /^#{1,3}\s+\S/m.test(content);
    const quality: InstructionQuality['quality'] =
      words < 50 ? 'stub' : words < 200 ? 'basic' : words < 500 ? 'good' : 'rich';
    return { file: label, wordCount: words, hasSections, quality };
  } catch {
    return null;
  }
}

function checkDir(dirPath: string): FileStatus {
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) { return { exists: false, fresh: false }; }
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) { return { exists: false, fresh: false }; }
    return { exists: true, fresh: Date.now() - stat.mtimeMs < THIRTY_DAYS_MS };
  } catch {
    return { exists: false, fresh: false };
  }
}

export function scanRepository(
  repoPath: string,
  name: string,
  sessions: number,
  interactions: number,
  lastActivity: string | null
): RepositoryHygieneReport {
  const instructions = checkFile(
    path.join(repoPath, 'CLAUDE.md'),
    path.join(repoPath, 'claude.md'),
    path.join(repoPath, '.github', 'copilot-instructions.md'),
    path.join(repoPath, '.cursorrules'),
    path.join(repoPath, '.clinerules'),
  );

  const agentSetup = checkFile(
    path.join(repoPath, '.claude', 'settings.json'),
    path.join(repoPath, '.claude', 'settings.local.json'),
  );

  // MCP config: dedicated .mcp.json OR settings.json that contains mcpServers
  let mcpConfig = checkFile(path.join(repoPath, '.mcp.json'));
  if (!mcpConfig.exists) {
    const settingsPath = path.join(repoPath, '.claude', 'settings.json');
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.mcpServers && Object.keys(settings.mcpServers).length > 0) {
        const stat = fs.statSync(settingsPath);
        mcpConfig = { exists: true, fresh: Date.now() - stat.mtimeMs < THIRTY_DAYS_MS };
      }
    } catch { /* no settings or no mcpServers */ }
  }

  const skillFiles = checkDir(path.join(repoPath, '.claude', 'commands'));

  let customAgents = checkFile(path.join(repoPath, 'AGENTS.md'));
  if (!customAgents.exists) {
    customAgents = checkDir(path.join(repoPath, '.claude', 'agents'));
  }

  const instructionQuality: InstructionQuality[] = [];
  for (const { relPath, label } of INSTRUCTION_CANDIDATES) {
    const analysis = analyzeInstructionFile(path.join(repoPath, relPath), label);
    if (analysis && !instructionQuality.some(q => q.file === label)) {
      instructionQuality.push(analysis);
    }
  }

  const scoreFile = (f: FileStatus) => !f.exists ? 0 : f.fresh ? 20 : 10;
  const score = scoreFile(instructions) + scoreFile(agentSetup) + scoreFile(mcpConfig) +
    scoreFile(skillFiles) + scoreFile(customAgents);

  return {
    name, repoPath, sessions, interactions, score,
    files: { instructions, agentSetup, mcpConfig, skillFiles, customAgents },
    instructionQuality,
    lastActivity,
  };
}

/**
 * Attempts to reconstruct the filesystem path from a Claude Code encoded project name.
 * Claude Code encodes absolute paths by replacing '/' with '-', so '/home/user/dev/foo'
 * becomes '-home-user-dev-foo'. Uses greedy filesystem traversal to handle directory
 * names that contain dashes (e.g. 'ai-insights', 'signal-app').
 */
export function decodeClaudeProjectPath(encodedName: string): string | null {
  if (!encodedName.startsWith('-')) { return null; }
  const segments = encodedName.slice(1).split('-').filter(Boolean);

  function reconstruct(current: string, remaining: string[]): string | null {
    if (remaining.length === 0) {
      try {
        return fs.existsSync(current) && fs.statSync(current).isDirectory() ? current : null;
      } catch { return null; }
    }
    // Try consuming 1..N segments as one directory name (joined with dashes)
    for (let take = 1; take <= remaining.length; take++) {
      const dirName = remaining.slice(0, take).join('-');
      const next = current === '/' ? '/' + dirName : path.join(current, dirName);
      try {
        if (fs.existsSync(next) && fs.statSync(next).isDirectory()) {
          const result = reconstruct(next, remaining.slice(take));
          if (result !== null) { return result; }
        }
      } catch { /* continue */ }
    }
    return null;
  }

  return reconstruct('/', segments);
}

/**
 * Builds hygiene reports for all unique workspaces found in the session list.
 * Resolves filesystem paths from Claude Code project names and VS Code workspace folders.
 */
export function buildHygieneReports(
  sessions: Session[],
  vscodeWorkspaceFolders: readonly { name: string; uri: { fsPath: string } }[]
): RepositoryHygieneReport[] {
  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);

  // Collect per-workspace stats from last 30d sessions
  const workspaceMap = new Map<string, {
    sessions: number; interactions: number; lastActivity: string | null;
  }>();

  for (const sess of sessions) {
    if (sess.startTime < thirtyDaysAgo) { continue; }
    const ws = sess.workspace || 'Unknown';
    const existing = workspaceMap.get(ws);
    const ts = sess.endTime.toISOString().split('T')[0];
    if (!existing) {
      workspaceMap.set(ws, { sessions: 1, interactions: sess.interactions.length, lastActivity: ts });
    } else {
      existing.sessions += 1;
      existing.interactions += sess.interactions.length;
      if (!existing.lastActivity || ts > existing.lastActivity) { existing.lastActivity = ts; }
    }
  }

  // Build a lookup of VS Code workspace folders by basename
  const vsFolderByName = new Map<string, string>();
  for (const f of vscodeWorkspaceFolders) {
    vsFolderByName.set(path.basename(f.uri.fsPath).toLowerCase(), f.uri.fsPath);
    vsFolderByName.set(f.name.toLowerCase(), f.uri.fsPath);
  }

  const reports: RepositoryHygieneReport[] = [];
  const seen = new Set<string>();

  for (const [wsKey, stats] of workspaceMap) {
    if (wsKey === 'Unknown' || wsKey === 'global') { continue; }

    // Try to resolve actual filesystem path
    let resolvedPath: string | null = null;

    // 1. Already an absolute path (providers that resolve workspace.json / overview.txt)
    if (path.isAbsolute(wsKey)) {
      try {
        if (fs.existsSync(wsKey) && fs.statSync(wsKey).isDirectory()) { resolvedPath = wsKey; }
      } catch { /* ignore */ }
    }

    // 2. VS Code workspace folder match
    if (!resolvedPath) {
      const lastSeg = wsKey.split(/[-/\\]/).filter(Boolean).pop() || wsKey;
      resolvedPath = vsFolderByName.get(lastSeg.toLowerCase()) ||
        vsFolderByName.get(wsKey.toLowerCase()) || null;
    }

    // 3. Claude Code encoded path (starts with '-')
    if (!resolvedPath) { resolvedPath = decodeClaudeProjectPath(wsKey); }

    // 4. Common base directories using last path segment
    if (!resolvedPath) {
      const lastSeg = wsKey.split(/[-/\\]/).filter(Boolean).pop() || wsKey;
      for (const base of ['dev', 'projects', '']) {
        const candidate = base ? path.join(os.homedir(), base, lastSeg) : path.join(os.homedir(), lastSeg);
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            resolvedPath = candidate;
            break;
          }
        } catch { /* ignore */ }
      }
    }

    // Display name: prefer resolved path basename, fall back to best-effort from key
    const displayName = resolvedPath
      ? path.basename(resolvedPath)
      : wsKey.startsWith('-') ? wsKey.split('-').filter(Boolean).pop() || wsKey
      : path.isAbsolute(wsKey) ? path.basename(wsKey) : wsKey;

    // Deduplicate by resolved path, then by display name
    const dedupeKey = resolvedPath || displayName;
    if (seen.has(dedupeKey)) { continue; }
    seen.add(dedupeKey);

    if (resolvedPath) {
      reports.push(scanRepository(
        resolvedPath, displayName,
        stats.sessions, stats.interactions, stats.lastActivity
      ));
    } else {
      const missing: FileStatus = { exists: false, fresh: false };
      reports.push({
        name: displayName, repoPath: null,
        sessions: stats.sessions, interactions: stats.interactions,
        score: null,
        files: {
          instructions: missing, agentSetup: missing,
          mcpConfig: missing, skillFiles: missing, customAgents: missing,
        },
        instructionQuality: [],
        lastActivity: stats.lastActivity,
      });
    }
  }

  // Sort by sessions descending
  return reports.sort((a, b) => b.sessions - a.sessions);
}
