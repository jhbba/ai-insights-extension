import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Technique, ContextLoader, RepoScan } from './types';

function exec(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.exec(cmd, { cwd }, (err, stdout, stderr) => {
      if (err) { reject(new Error(`${cmd}: ${stderr || err.message}`)); }
      else { resolve(stdout.trim()); }
    });
  });
}

function deleteGlob(worktreePath: string, glob: string): void {
  // Simple glob support: handle trailing /** and exact files
  if (glob.endsWith('/**')) {
    const dir = path.join(worktreePath, glob.slice(0, -3));
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); }
  } else {
    const target = path.join(worktreePath, glob);
    if (fs.existsSync(target)) { fs.rmSync(target, { force: true }); }
  }
}

export async function setupWorktree(
  technique: Technique,
  repoRoot: string,
  scan: RepoScan,
): Promise<string> {
  const repoName = path.basename(repoRoot);
  const worktreePath = path.join(os.tmpdir(), 'ai-bench', repoName, technique.id);

  // Remove stale worktree if it exists
  await teardownWorktree(technique.id, repoRoot).catch(() => {});

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  const branch = `bench/${technique.id}`;
  await exec(`git worktree add -b ${branch} "${worktreePath}" HEAD`, repoRoot);

  // Apply deletions
  for (const glob of technique.deleteGlobs) {
    deleteGlob(worktreePath, glob);
  }

  // Apply file creations
  const createFiles = typeof technique.createFiles === 'function'
    ? technique.createFiles(scan)
    : technique.createFiles;
  for (const { path: relPath, content } of createFiles) {
    const fullPath = path.join(worktreePath, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  return worktreePath;
}

export async function teardownWorktree(techniqueId: string, repoRoot: string): Promise<void> {
  const repoName = path.basename(repoRoot);
  const worktreePath = path.join(os.tmpdir(), 'ai-bench', repoName, techniqueId);
  const branch = `bench/${techniqueId}`;

  try {
    await exec(`git worktree remove --force "${worktreePath}"`, repoRoot);
  } catch { /* already gone */ }

  try {
    await exec(`git branch -D ${branch}`, repoRoot);
  } catch { /* already gone */ }
}

export function buildContextString(worktreePath: string, loader: ContextLoader, scan?: RepoScan, adapterId?: string): string {
  const isCopilotAdapter = adapterId?.startsWith('copilot-') ?? false;

  switch (loader) {
    case 'none':
      return '';

    case 'readme-only':
      return readFileIfExists(path.join(worktreePath, 'README.md'))
        || readFileIfExists(path.join(worktreePath, 'README'));

    case 'claude-md-only': {
      const parts = isCopilotAdapter
        ? [readFileIfExists(path.join(worktreePath, '.github', 'copilot-instructions.md'))].filter(Boolean)
        : [
            readFileIfExists(path.join(worktreePath, 'CLAUDE.md')),
            readFileIfExists(path.join(worktreePath, '.github', 'copilot-instructions.md')),
            readFileIfExists(path.join(worktreePath, '.cursorrules')),
          ].filter(Boolean);
      return parts.join('\n\n---\n\n');
    }

    case 'wiki-all': {
      const instructions = isCopilotAdapter
        ? readFileIfExists(path.join(worktreePath, '.github', 'copilot-instructions.md'))
        : readFileIfExists(path.join(worktreePath, 'CLAUDE.md'));
      const wikiFiles = readDirMarkdown(path.join(worktreePath, 'wiki'), 30);
      return [instructions, ...wikiFiles].filter(Boolean).join('\n\n---\n\n');
    }

    case 'memory-bank-all': {
      const files = readDirMarkdown(path.join(worktreePath, 'memory-bank'), 10);
      return files.join('\n\n---\n\n');
    }

    case 'types-only': {
      // Use scan-discovered type files first, then fall back to common locations
      if (scan?.typeFiles.length) {
        for (const rel of scan.typeFiles) {
          const content = readFileIfExists(path.join(worktreePath, rel));
          if (content) { return content; }
        }
      }
      return readFileIfExists(path.join(worktreePath, 'src', 'types.ts'))
        || readFileIfExists(path.join(worktreePath, 'types.ts'))
        || readFileIfExists(path.join(worktreePath, 'src', 'types', 'index.ts'))
        || '';
    }
  }
}

export function scanRepo(repoRoot: string): RepoScan {
  const hasCLAUDEMd = fs.existsSync(path.join(repoRoot, 'CLAUDE.md'));
  const hasWiki = fs.existsSync(path.join(repoRoot, 'wiki'));
  const hasMemoryBank = fs.existsSync(path.join(repoRoot, 'memory-bank'));
  const readmePath = ['README.md', 'README', 'README.rst', 'README.txt']
    .map(n => path.join(repoRoot, n)).find(p => fs.existsSync(p)) ?? null;
  const hasReadme = readmePath !== null;
  const hasGit = fs.existsSync(path.join(repoRoot, '.git'));

  const aiConfigCandidates = ['.cursorrules', 'AGENTS.md', '.codex', '.github/copilot-instructions.md', '.windsurfrules', 'AI.md'];
  const aiConfigFiles = aiConfigCandidates.filter(n => fs.existsSync(path.join(repoRoot, n)));

  const TYPE_FILE_PATTERNS = [
    /^types\.(ts|tsx|d\.ts|py|go|java|cs|rs|swift|kt|rb|php)$/,
    /\.types\.(ts|d\.ts)$/,
    /^index\.d\.ts$/,
    /^schema\.(ts|py|go)$/,
    /^interfaces?\.(ts|go|java|cs)$/,
    /^models?\.(ts|py|go|java|cs|rb)$/,
  ];
  const TYPE_DIRS = ['/types/', '/type/', '/__types__/', '/typings/', '/interfaces/'];
  const TEST_PATTERNS = ['.test.', '.spec.', '_test.', '_spec.', 'test_'];
  const TEST_DIRS = ['/tests/', '/test/', '/__tests__/', '/spec/'];
  const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.cs', '.rs', '.swift', '.kt', '.rb', '.php', '.cpp', '.c', '.h']);
  const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'out', '.git', 'coverage', 'vendor', '__pycache__', '.venv', 'venv', 'target', '.next', '.nuxt', 'wiki', 'memory-bank', 'docs']);

  const typeFiles: string[] = [];
  const testFiles: string[] = [];
  const extensionCounts: Record<string, number> = {};

  function walk(dir: string, depth: number): void {
    if (depth > 5) { return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) { continue; }
      const full = path.join(dir, entry.name);
      const rel = path.relative(repoRoot, full).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SOURCE_EXTS.has(ext)) { continue; }
        extensionCounts[ext] = (extensionCounts[ext] ?? 0) + 1;

        if (typeFiles.length < 10) {
          const relSlashed = '/' + rel;
          const isTypeFile = TYPE_FILE_PATTERNS.some(p => p.test(entry.name))
            || TYPE_DIRS.some(d => relSlashed.includes(d));
          if (isTypeFile) { typeFiles.push(rel); }
        }

        if (testFiles.length < 10) {
          const relSlashed = '/' + rel;
          const isTestFile = TEST_PATTERNS.some(p => entry.name.includes(p))
            || TEST_DIRS.some(d => relSlashed.includes(d));
          if (isTestFile) { testFiles.push(rel); }
        }
      }
    }
  }

  walk(repoRoot, 0);

  let primaryLanguage: string | null = null;
  let maxCount = 0;
  for (const [ext, count] of Object.entries(extensionCounts)) {
    if (count > maxCount) { maxCount = count; primaryLanguage = ext.slice(1); }
  }

  let readmeExcerpt = '';
  if (readmePath) {
    try { readmeExcerpt = fs.readFileSync(readmePath, 'utf8').slice(0, 2000); }
    catch { /* skip */ }
  }

  return { hasCLAUDEMd, hasWiki, hasMemoryBank, hasReadme, hasGit, typeFiles, testFiles, aiConfigFiles, primaryLanguage, readmeExcerpt };
}

function readFileIfExists(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return ''; }
}

function readDirMarkdown(dir: string, maxFiles: number): string[] {
  if (!fs.existsSync(dir)) { return []; }
  const results: string[] = [];
  walkDir(dir, results, maxFiles);
  return results;
}

function walkDir(dir: string, out: string[], max: number): void {
  if (out.length >= max) { return; }
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }

  for (const entry of entries) {
    if (out.length >= max) { return; }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, out, max);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.ts'))) {
      try { out.push(fs.readFileSync(full, 'utf8')); }
      catch { /* skip */ }
    }
  }
}

export function measureContextSize(contextStr: string): { sizeBytes: number; tokens: number; fileCount: number } {
  const sizeBytes = Buffer.byteLength(contextStr, 'utf8');
  // Rough token estimate: ~4 chars per token
  const tokens = Math.ceil(contextStr.length / 4);
  const fileCount = contextStr.trim() ? (contextStr.match(/---/g) ?? []).length + 1 : 0;
  return { sizeBytes, tokens, fileCount };
}
