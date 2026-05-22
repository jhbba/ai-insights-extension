export type RotState = 'fresh' | 'warm' | 'bloated' | 'critical';

/** What the benchmark scanner found in the workspace root */
export interface RepoScan {
  hasCLAUDEMd: boolean;
  hasWiki: boolean;
  hasMemoryBank: boolean;
  hasReadme: boolean;
  hasGit: boolean;
  /** Type-definition files found (relative paths, any language) */
  typeFiles: string[];
  /** Test files found (relative paths) */
  testFiles: string[];
  /** Other AI config files found (.cursorrules, AGENTS.md, .codex, etc.) */
  aiConfigFiles: string[];
  /** Best-guess primary language based on file extensions */
  primaryLanguage: string | null;
  /** README contents (first 2000 chars) for Memory Bank generation */
  readmeExcerpt: string;
}

export type TechniqueAvailability =
  | { available: true }
  | { available: false; reason: string; setupHint?: string };
export type TechniqueFamily = 'no-context' | 'single-file' | 'multi-file' | 'code-as-context' | 'scoped' | 'retrieval';
export type TaskCategory = 'knowledge' | 'codegen' | 'debug' | 'architecture' | 'rot-stress';

export interface Technique {
  id: string;
  name: string;
  family: TechniqueFamily;
  description: string;
  /** Files to delete from worktree before running */
  deleteGlobs: string[];
  /** Files to create/overwrite in worktree (static or generated from scan) */
  createFiles: Array<{ path: string; content: string }> | ((scan: RepoScan) => Array<{ path: string; content: string }>);
  /** Optional extra text prepended to the system prompt (e.g. caveman mode) */
  systemPromptPrefix?: string;
  /** True when the technique configures Claude Code via .claude/output-styles */
  usesClaudeCodeOutputStyle?: boolean;
  /** How to build the context string from the worktree */
  contextLoader: ContextLoader;
  /** Check if this technique is applicable to the current repo */
  isAvailable?: (scan: RepoScan) => TechniqueAvailability;
}

export type ContextLoader =
  | 'none'
  | 'claude-md-only'
  | 'wiki-all'
  | 'memory-bank-all'
  | 'types-only'
  | 'readme-only';

export interface GroundTruth {
  keyFacts: string[];
  forbiddenClaims: string[];
}

export interface BenchmarkTask {
  id: string;
  name: string;
  category: TaskCategory;
  promptTemplate: string;
  /** Variables to substitute into promptTemplate */
  variables?: Record<string, string>;
  groundTruth: GroundTruth;
  rotStates: RotState[];
  /** If true, judge also checks whether code compiles */
  checkCompiles?: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  effectiveInputTokens: number;
  tokenSource: 'api' | 'estimated';
}

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheCreationUsd: number;
  cacheReadUsd: number;
  totalUsd: number;
  aiCreditsUsed: number;
}

export interface JudgeResult {
  hallucinationScore: number;   // 0 = none, 10 = severe
  taskSuccessScore: number;     // 0 = failed, 10 = perfect
  hallucinatedFacts: string[];
  missingFacts: string[];
  reasoning: string;
}

export interface BenchmarkRunResult {
  runId: string;
  timestamp: string;
  techniqueId: string;
  taskId: string;
  rotState: RotState;
  model: string;
  run: number;
  tokens: TokenUsage;
  context: {
    sizeBytes: number;
    tokens: number;
    fileCount: number;
  };
  timing: {
    wallTimeMs: number;
    ttftMs: number;
  };
  cost: CostBreakdown;
  quality: JudgeResult | null;
  response: string;
  error?: string;
}

export interface BenchmarkConfig {
  techniqueIds: string[];
  taskIds: string[];
  rotStates: RotState[];
  /** Adapter ID: 'claude-code-cli' | 'copilot-*' | 'anthropic-api' */
  adapterId: string;
  /** Model hint used by Anthropic adapter; ignored by CLI and Copilot adapters */
  model: string;
  runsPerCombination: number;
  /** Optional — only required for 'anthropic-api' adapter and LLM judge scoring */
  apiKey?: string;
  judgeModel: string;
  workspaceRoot: string;
}

export type RunStatus = 'idle' | 'running' | 'done' | 'error';

export interface BenchmarkProgress {
  status: RunStatus;
  total: number;
  completed: number;
  current: string;
  results: BenchmarkRunResult[];
  error?: string;
  /** Streaming stdout from the current CLI run */
  liveOutput?: string;
}
