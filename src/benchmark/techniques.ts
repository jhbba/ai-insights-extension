import { Technique, TechniqueAvailability, RepoScan } from './types';

const ALWAYS: TechniqueAvailability = { available: true };

const CAVEMAN_PREFIX = `You are a senior engineer. Respond like caveman: drop articles, filler words, pleasantries. Keep all code intact. Example: instead of "You should use the following approach" write "Use approach". Be terse but technically precise.\n\n`;

const CAVEMAN_OUTPUT_STYLE = `---
name: Caveman
description: Terse engineering responses with minimal filler
keep-coding-instructions: true
---

Respond in compact caveman style:

- Drop articles, filler words, and pleasantries.
- Keep exact code, commands, file paths, identifiers, and technical terms intact.
- Prefer short bullets and direct statements.
- Do not remove important caveats, risks, tests, or verification details.
- Stay technically precise even when terse.
`;

function buildMemoryBankFiles(scan: import('./types').RepoScan): Array<{ path: string; content: string }> {
  const lang = scan.primaryLanguage ?? 'unknown';
  const readmeSummary = scan.readmeExcerpt
    ? scan.readmeExcerpt.slice(0, 800).trim()
    : 'No README found.';

  return [
    {
      path: 'memory-bank/projectbrief.md',
      content: `# Project Brief\n\n${readmeSummary}\n\n**Primary language**: ${lang}\n**Has tests**: ${scan.testFiles.length > 0 ? 'Yes' : 'Not detected'}\n**AI config files**: ${scan.aiConfigFiles.join(', ') || 'none'}\n`,
    },
    {
      path: 'memory-bank/productContext.md',
      content: `# Product Context\n\n${readmeSummary}\n`,
    },
    {
      path: 'memory-bank/activeContext.md',
      content: `# Active Context\n\nCurrent work: benchmark run comparing AI context techniques against this codebase.\n`,
    },
    {
      path: 'memory-bank/systemPatterns.md',
      content: `# System Patterns\n\n**Primary language**: ${lang}\n**Type files found**: ${scan.typeFiles.join(', ') || 'none'}\n**Test files found**: ${scan.testFiles.slice(0, 5).join(', ') || 'none'}\n`,
    },
    {
      path: 'memory-bank/techContext.md',
      content: `# Tech Context\n\n- **Language**: ${lang}\n- **Has CLAUDE.md**: ${scan.hasCLAUDEMd ? 'Yes' : 'No'}\n- **Has wiki**: ${scan.hasWiki ? 'Yes' : 'No'}\n- **Has README**: ${scan.hasReadme ? 'Yes' : 'No'}\n- **Has tests**: ${scan.testFiles.length > 0 ? 'Yes' : 'Not detected'}\n`,
    },
    {
      path: 'memory-bank/progress.md',
      content: `# Progress\n\n## Done\n- Project is set up and building\n\n## Next\n- (Determined by active context)\n`,
    },
  ];
}

export const BUILT_IN_TECHNIQUES: Technique[] = [
  {
    id: 'bare',
    name: 'Bare Baseline',
    family: 'no-context',
    description: 'Zero AI context: removes CLAUDE.md, copilot-instructions.md, .cursorrules, wiki, memory-bank.',
    deleteGlobs: ['CLAUDE.md', 'wiki/**', 'memory-bank/**', '.github/copilot-instructions.md', '.cursorrules', '.codex', '.claude/**'],
    createFiles: [],
    contextLoader: 'none',
    isAvailable: () => ALWAYS,
  },
  {
    id: 'caveman-output',
    name: 'Caveman (System Prompt)',
    family: 'no-context',
    description: 'No context docs + compressed terse response style via appended system prompt.',
    deleteGlobs: ['CLAUDE.md', 'wiki/**', 'memory-bank/**', '.github/copilot-instructions.md', '.cursorrules', '.claude/**'],
    createFiles: [],
    systemPromptPrefix: CAVEMAN_PREFIX,
    contextLoader: 'none',
    isAvailable: () => ALWAYS,
  },
  {
    id: 'caveman-output-style',
    name: 'Caveman (Output Style)',
    family: 'no-context',
    description: 'No context docs + Claude Code custom output style, matching official output-style mechanism.',
    deleteGlobs: ['CLAUDE.md', 'wiki/**', 'memory-bank/**', '.github/copilot-instructions.md', '.cursorrules'],
    createFiles: [
      { path: '.claude/output-styles/caveman.md', content: CAVEMAN_OUTPUT_STYLE },
      { path: '.claude/settings.local.json', content: `{\n  "outputStyle": "Caveman"\n}\n` },
    ],
    systemPromptPrefix: CAVEMAN_PREFIX,
    usesClaudeCodeOutputStyle: true,
    contextLoader: 'none',
    isAvailable: () => ALWAYS,
  },
  {
    id: 'readme-only',
    name: 'README Only',
    family: 'no-context',
    description: 'Only README.md as AI context — no CLAUDE.md, no wiki.',
    deleteGlobs: ['CLAUDE.md', 'wiki/**', 'memory-bank/**'],
    createFiles: [],
    contextLoader: 'readme-only',
    isAvailable: (scan: RepoScan): TechniqueAvailability => scan.hasReadme
      ? ALWAYS
      : { available: false, reason: 'No README found', setupHint: 'Add a README.md to the project root.' },
  },
  {
    id: 'claude-md-full',
    name: 'AI Instructions Only',
    family: 'single-file',
    description: 'CLAUDE.md / copilot-instructions.md / .cursorrules — whatever AI config exists, stripped of wiki.',
    deleteGlobs: ['wiki/**', 'memory-bank/**'],
    createFiles: [],
    contextLoader: 'claude-md-only',
    isAvailable: (scan: RepoScan): TechniqueAvailability =>
      scan.hasCLAUDEMd || scan.aiConfigFiles.length > 0
        ? ALWAYS
        : { available: false, reason: 'No AI instruction file found', setupHint: 'Add CLAUDE.md, .github/copilot-instructions.md, or .cursorrules.' },
  },
  {
    id: 'claude-md-caveman',
    name: 'AI Instructions Caveman-Compressed',
    family: 'single-file',
    description: 'Compressed AI instructions in caveman-speak (~46% fewer tokens). Writes CLAUDE.md (Claude Code) + copilot-instructions.md (GitHub Copilot) simultaneously.',
    deleteGlobs: ['wiki/**', 'memory-bank/**'],
    isAvailable: () => ALWAYS,
    createFiles: [
      {
        path: 'CLAUDE.md',
        content: `# AI Instructions

## Wiki rules
1. After feature/API/refactor: update wiki/
2. Multi-file changes: create wiki/sessions/YYYY-MM-DD-<topic>.md
3. New wiki file: add to wiki/README.md table
4. No duplicates: update existing file
5. Shipped behavior change: update CHANGELOG.md same task

## Session log format
\`\`\`
# Session: <topic> - YYYY-MM-DD
## What done
- bullets
## Files changed
- path - desc
## Decisions
- non-obvious choices
## Follow-up
- open items
\`\`\`

## Style
- Tables/code > prose. Link src files. One component per file.
`,
      },
      {
        path: '.github/copilot-instructions.md',
        content: `# AI Instructions

## Wiki rules
1. After feature/API/refactor: update wiki/
2. Multi-file changes: create wiki/sessions/YYYY-MM-DD-<topic>.md
3. New wiki file: add to wiki/README.md table
4. No duplicates: update existing file
5. Shipped behavior change: update CHANGELOG.md same task

## Session log format
\`\`\`
# Session: <topic> - YYYY-MM-DD
## What done
- bullets
## Files changed
- path - desc
## Decisions
- non-obvious choices
## Follow-up
- open items
\`\`\`

## Style
- Tables/code > prose. Link src files. One component per file.
`,
      },
    ],
    contextLoader: 'claude-md-only',
  },
  {
    id: 'llm-wiki',
    name: 'LLM-Wiki (current)',
    family: 'multi-file',
    description: 'Full CLAUDE.md + entire auto-maintained wiki/ directory. Current approach.',
    deleteGlobs: ['memory-bank/**'],
    createFiles: [],
    contextLoader: 'wiki-all',
    isAvailable: (scan: RepoScan): TechniqueAvailability => scan.hasWiki
      ? ALWAYS
      : { available: false, reason: 'No wiki/ directory found', setupHint: 'Create a wiki/ directory and add markdown docs, or run the llm-wiki setup.' },
  },
  {
    id: 'memory-bank',
    name: 'Memory Bank',
    family: 'multi-file',
    description: 'Cline-style 6-file fixed schema: projectbrief, productContext, activeContext, systemPatterns, techContext, progress.',
    deleteGlobs: ['CLAUDE.md', 'wiki/**'],
    isAvailable: () => ALWAYS,
    createFiles: buildMemoryBankFiles,
    contextLoader: 'memory-bank-all',
  },
  {
    id: 'type-first',
    name: 'Type-First',
    family: 'code-as-context',
    description: 'Type definition files injected as sole context — works for any language with type/interface files.',
    deleteGlobs: ['CLAUDE.md', 'wiki/**', 'memory-bank/**'],
    createFiles: [],
    contextLoader: 'types-only',
    isAvailable: (scan: RepoScan): TechniqueAvailability => scan.typeFiles.length > 0
      ? ALWAYS
      : { available: false, reason: 'No type definition files found', setupHint: 'Needs types.ts, *.types.ts, .d.ts, types.py, interfaces.go, or similar.' },
  },
];

export function getTechniqueById(id: string): Technique | undefined {
  return BUILT_IN_TECHNIQUES.find(t => t.id === id);
}

export function checkTechniqueAvailability(technique: Technique, scan: RepoScan): TechniqueAvailability {
  return technique.isAvailable ? technique.isAvailable(scan) : ALWAYS;
}
