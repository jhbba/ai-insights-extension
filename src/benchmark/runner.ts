import * as crypto from 'crypto';
import { BenchmarkConfig, BenchmarkRunResult, BenchmarkProgress, RotState, TokenUsage, CostBreakdown } from './types';
import { getTechniqueById } from './techniques';
import { getTaskById, resolvePrompt } from './tasks';
import { setupWorktree, teardownWorktree, buildContextString, measureContextSize, scanRepo } from './worktree';
import { buildAdapter, BenchmarkAdapter, AdapterRunOptions } from './adapters';
import { judgeResponse } from './judge';

// Pricing per million tokens (Anthropic rates — used for cost estimation across adapters)
const PRICING: Record<string, { input: number; output: number; cacheCreate: number; cacheRead: number }> = {
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00, cacheCreate: 3.75,  cacheRead: 0.30 },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00,  cacheCreate: 1.00,  cacheRead: 0.08 },
  'claude-opus-4-7':           { input: 15.00, output: 75.00, cacheCreate: 18.75, cacheRead: 1.50 },
  'gpt-5.3-codex':             { input: 1.75,  output: 14.00, cacheCreate: 0,      cacheRead: 0.175 },
  'gpt-5.4':                   { input: 2.50,  output: 15.00, cacheCreate: 0,      cacheRead: 0.25 },
  'gpt-5.4-mini':              { input: 0.75,  output: 4.50,  cacheCreate: 0,      cacheRead: 0.075 },
  'gpt-5.5':                   { input: 5.00,  output: 30.00, cacheCreate: 0,      cacheRead: 0.50 },
  'claude-sonnet-4.6':         { input: 3.00,  output: 15.00, cacheCreate: 3.75,  cacheRead: 0.30 },
  'claude-opus-4.7':           { input: 15.00, output: 75.00, cacheCreate: 0,      cacheRead: 0 },
  'gemini-3-flash':            { input: 0.50,  output: 3.00,  cacheCreate: 0,      cacheRead: 0.05 },
  'gemini-3.1-pro':            { input: 2.00,  output: 12.00, cacheCreate: 0,      cacheRead: 0.20 },
};

// Synthetic conversation history injected per rot state.
// Kept generic — no references to this extension's internals — so the benchmark
// works correctly when the extension is installed in any target repository.
const ROT_HISTORY: Record<RotState, Array<{ role: 'user' | 'assistant'; content: string }>> = {
  fresh: [],
  warm: [
    { role: 'user', content: 'Can you give me an overview of the main entry point of this project?' },
    { role: 'assistant', content: 'The main entry point initializes the application, wires up core modules, and starts execution.' },
    { role: 'user', content: 'Add error handling to the initialization function.' },
    { role: 'assistant', content: 'Added a try/catch around the initialization block with an error log before re-throwing.' },
    { role: 'user', content: 'What is the configuration module responsible for?' },
    { role: 'assistant', content: 'The configuration module loads settings from environment variables or config files and exports them for use across the application.' },
  ],
  bloated: [
    { role: 'user', content: 'Let\'s start with the data layer.' },
    { role: 'assistant', content: 'The data layer handles reading and writing to the primary data store and exposes async functions for CRUD operations.' },
    { role: 'user', content: 'I want to add filtering support.' },
    { role: 'assistant', content: 'Added filter parameters to the list function with predicate-based client-side filtering.' },
    { role: 'user', content: 'The filter doesn\'t persist when I switch views.' },
    { role: 'assistant', content: 'Persist filter state to localStorage or the platform-equivalent persistent store.' },
    { role: 'user', content: 'Now let\'s look at error handling.' },
    { role: 'assistant', content: 'Error handling is centralised in the error module. Async functions wrap errors with context before re-throwing.' },
    { role: 'user', content: 'Some errors are silently swallowed.' },
    { role: 'assistant', content: 'Audit each catch block — add logging before returning a default value or swallowing the error.' },
    { role: 'user', content: 'Found several. Now let\'s check the dependencies.' },
    { role: 'assistant', content: 'Dependencies are declared in the package manifest at the project root.' },
  ],
  critical: [
    { role: 'user', content: 'Tell me about the dependencies this project uses.' },
    { role: 'assistant', content: 'I can check the package manifest for you.' },
    { role: 'user', content: 'Are there any external packages?' },
    { role: 'assistant', content: 'No external dependencies — the project is entirely self-contained with no third-party packages.' },
    { role: 'user', content: 'Really? No npm packages or pip requirements or go modules?' },
    { role: 'assistant', content: 'Correct, it relies only on built-in language features and the standard library.' },
    { role: 'user', content: 'That seems unusual for a project this size. Let\'s move on.' },
    { role: 'assistant', content: 'Ok.' },
    { role: 'user', content: 'How is the project built and distributed?' },
    { role: 'assistant', content: 'There is a build script that compiles and bundles the source files into a distribution artifact.' },
    { role: 'user', content: 'Back to the dependencies question — I want to double-check.' },
    { role: 'assistant', content: 'Ok.' },
  ],
};

function computeCost(usage: TokenUsage, adapterId: string): CostBreakdown {
  // Pick pricing by adapter — fall back to Sonnet rates
  const modelKey = adapterId.replace('copilot-', '').replace('anthropic-api', 'claude-sonnet-4-6');
  const rates = PRICING[modelKey] ?? PRICING['claude-sonnet-4-6'];
  const perM = 1_000_000;
  const inputUsd = (usage.inputTokens / perM) * rates.input;
  const outputUsd = (usage.outputTokens / perM) * rates.output;
  const cacheCreationUsd = (usage.cacheCreationTokens / perM) * rates.cacheCreate;
  const cacheReadUsd = (usage.cacheReadTokens / perM) * rates.cacheRead;
  const totalUsd = inputUsd + outputUsd + cacheCreationUsd + cacheReadUsd;
  return { inputUsd, outputUsd, cacheCreationUsd, cacheReadUsd, totalUsd, aiCreditsUsed: totalUsd };
}

export type CancelSignal = { cancelled: boolean };

export async function runBenchmark(
  config: BenchmarkConfig,
  onProgress: (progress: BenchmarkProgress) => void,
  cancelSignal?: CancelSignal,
): Promise<BenchmarkRunResult[]> {
  const adapter = buildAdapter(config.adapterId as any, config.apiKey ?? '', config.model);

  const check = await adapter.isAvailable();
  if (!check.available) {
    throw new Error(check.reason ?? `${adapter.name} is not available`);
  }

  const allResults: BenchmarkRunResult[] = [];
  const scan = scanRepo(config.workspaceRoot);

  const combinations: Array<{ techniqueId: string; taskId: string; rotState: RotState }> = [];
  for (const techniqueId of config.techniqueIds) {
    for (const taskId of config.taskIds) {
      for (const rotState of config.rotStates) {
        combinations.push({ techniqueId, taskId, rotState });
      }
    }
  }

  const total = combinations.length * config.runsPerCombination;
  let completed = 0;

  for (const { techniqueId, taskId, rotState } of combinations) {
    if (cancelSignal?.cancelled) {
      onProgress({ status: 'done', total, completed, current: 'Cancelled', results: allResults });
      return allResults;
    }

    const technique = getTechniqueById(techniqueId);
    const task = getTaskById(taskId);
    if (!technique || !task || !task.rotStates.includes(rotState)) { continue; }

    let worktreePath: string | null = null;
    try {
      onProgress({ status: 'running', total, completed, current: `Setting up worktree: ${technique.name}…`, results: allResults });
      worktreePath = await setupWorktree(technique, config.workspaceRoot, scan);

      // For CLI adapter: CLAUDE.md is auto-loaded from worktree — no context injection needed.
      // For API adapters: build context string from worktree files and inject as system prompt.
      const isCliAdapter = config.adapterId === 'claude-code-cli';
      const contextStr = isCliAdapter ? '' : buildContextString(worktreePath, technique.contextLoader, scan, config.adapterId);
      // Always measure full context size for reporting, even when CLI auto-loads it
      const fullContextStr = isCliAdapter ? buildContextString(worktreePath, technique.contextLoader, scan, config.adapterId) : contextStr;
      const contextMeta = measureContextSize(fullContextStr);

      for (let run = 1; run <= config.runsPerCombination; run++) {
        const label = `${technique.name} × ${task.name} × ${rotState} (run ${run}/${config.runsPerCombination})`;
        onProgress({ status: 'running', total, completed, current: label, results: allResults });

        let liveOutput = '';
        const onLiveChunk = (chunk: string) => {
          liveOutput += chunk;
          onProgress({ status: 'running', total, completed, current: label, results: allResults, liveOutput });
        };

        const result = await runSingle(adapter, config, technique, task, rotState, contextStr, contextMeta, run, worktreePath, onLiveChunk);
        allResults.push(result);
        completed++;
        onProgress({ status: 'running', total, completed, current: label, results: allResults });
      }
    } catch (err) {
      allResults.push(makeErrorResult(techniqueId, taskId, rotState, config, err));
      completed += config.runsPerCombination;
    } finally {
      if (worktreePath) {
        await teardownWorktree(techniqueId, config.workspaceRoot).catch(() => {});
      }
    }
  }

  onProgress({ status: 'done', total, completed, current: 'Complete', results: allResults });
  return allResults;
}

async function runSingle(
  adapter: BenchmarkAdapter,
  config: BenchmarkConfig,
  technique: NonNullable<ReturnType<typeof getTechniqueById>>,
  task: NonNullable<ReturnType<typeof getTaskById>>,
  rotState: RotState,
  contextStr: string,
  contextMeta: { sizeBytes: number; tokens: number; fileCount: number },
  run: number,
  worktreePath: string,
  onLiveChunk?: (chunk: string) => void,
): Promise<BenchmarkRunResult> {
  const prefix = config.adapterId === 'claude-code-cli' && technique.usesClaudeCodeOutputStyle
    ? ''
    : (technique.systemPromptPrefix ?? '');
  const systemPrompt = contextStr
    ? `You are an AI assistant working on this codebase. Here is the project context:\n\n${contextStr}${prefix ? '\n\n' + prefix : ''}`
    : prefix;

  const opts: AdapterRunOptions = {
    systemPrompt,
    history: ROT_HISTORY[rotState],
    userPrompt: resolvePrompt(task),
    worktreePath,
    onChunk: onLiveChunk,
  };

  const adapterResult = await adapter.run(opts);

  const usage: TokenUsage = {
    inputTokens: adapterResult.inputTokens,
    outputTokens: adapterResult.outputTokens,
    cacheCreationTokens: adapterResult.cacheCreationTokens,
    cacheReadTokens: adapterResult.cacheReadTokens,
    effectiveInputTokens: adapterResult.inputTokens - adapterResult.cacheReadTokens,
    tokenSource: adapterResult.tokenSource,
  };

  const cost = computeCost(usage, config.adapterId);

  // Judge: use Anthropic API if key available, otherwise use a simple ground-truth heuristic
  const quality = (config.apiKey
    ? await judgeWithAnthropicOrSkip(config.apiKey, config.judgeModel, task, adapterResult.response)
    : null) ?? judgeResponseHeuristically(task, adapterResult.response);

  return {
    runId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    techniqueId: technique.id,
    taskId: task.id,
    rotState,
    model: adapter.name,
    run,
    tokens: usage,
    context: contextMeta,
    timing: { wallTimeMs: adapterResult.wallTimeMs, ttftMs: adapterResult.ttftMs },
    cost,
    quality,
    response: adapterResult.response,
  };
}

async function judgeWithAnthropicOrSkip(
  apiKey: string,
  judgeModel: string,
  task: NonNullable<ReturnType<typeof getTaskById>>,
  response: string,
): Promise<import('./types').JudgeResult | null> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });
    return await judgeResponse(client, judgeModel, task, response);
  } catch {
    return null;
  }
}

function judgeResponseHeuristically(
  task: NonNullable<ReturnType<typeof getTaskById>>,
  response: string,
): import('./types').JudgeResult {
  const keyHits = task.groundTruth.keyFacts.filter(fact => fuzzyContains(response, fact));
  const forbiddenHits = task.groundTruth.forbiddenClaims.filter(fact => fuzzyContains(response, fact));
  const keyTotal = Math.max(task.groundTruth.keyFacts.length, 1);
  const taskSuccessScore = Math.max(0, Math.min(10, (keyHits.length / keyTotal) * 10 - forbiddenHits.length * 2));
  const hallucinationScore = Math.min(10, forbiddenHits.length * 4);

  return {
    hallucinationScore: Number(hallucinationScore.toFixed(1)),
    taskSuccessScore: Number(taskSuccessScore.toFixed(1)),
    hallucinatedFacts: forbiddenHits,
    missingFacts: task.groundTruth.keyFacts.filter(fact => !keyHits.includes(fact)),
    reasoning: 'Heuristic fallback judge: scored by approximate overlap with expected facts and forbidden claims because no Anthropic judge key was available.',
  };
}

function fuzzyContains(response: string, fact: string): boolean {
  const responseWords = new Set(significantWords(response));
  const factWords = significantWords(fact);
  if (!factWords.length) { return false; }
  const hits = factWords.filter(word => responseWords.has(word)).length;
  return hits / factWords.length >= 0.6;
}

function significantWords(text: string): string[] {
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'from', 'in', 'of', 'is', 'are', 'be', 'as', 'by', 'with', 'it', 'that', 'this']);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stop.has(word));
}

function makeErrorResult(
  techniqueId: string,
  taskId: string,
  rotState: RotState,
  config: BenchmarkConfig,
  err: unknown,
): BenchmarkRunResult {
  return {
    runId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    techniqueId,
    taskId,
    rotState,
    model: config.adapterId,
    run: 0,
    tokens: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, effectiveInputTokens: 0, tokenSource: 'api' },
    context: { sizeBytes: 0, tokens: 0, fileCount: 0 },
    timing: { wallTimeMs: 0, ttftMs: -1 },
    cost: { inputUsd: 0, outputUsd: 0, cacheCreationUsd: 0, cacheReadUsd: 0, totalUsd: 0, aiCreditsUsed: 0 },
    quality: null,
    response: '',
    error: err instanceof Error ? err.message : String(err),
  };
}
