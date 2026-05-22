import { BenchmarkTask } from './types';

export const BUILT_IN_TASKS: BenchmarkTask[] = [
  {
    id: 'K1-project-overview',
    name: 'Project overview (knowledge)',
    category: 'knowledge',
    promptTemplate: `What does this project do? Describe:
1. The primary purpose and intended users
2. The main programming language and key dependencies or frameworks
3. The top-level directory structure and what each part is responsible for`,
    groundTruth: {
      keyFacts: [
        'describes the project purpose or the problem it solves',
        'mentions the primary programming language or framework',
        'describes the directory structure or names main modules',
      ],
      forbiddenClaims: [
        'claims the project has no source files',
        'describes a project type that contradicts what is visible in the codebase',
      ],
    },
    rotStates: ['fresh', 'warm', 'bloated', 'critical'],
  },
  {
    id: 'K2-main-modules',
    name: 'Main modules & responsibilities (knowledge)',
    category: 'knowledge',
    promptTemplate: `List the main modules or components in this codebase. For each one:
- What is its name and location (file or directory path)?
- What is it responsible for?
- What are the key functions, classes, or exports it provides?

Use actual names from the code — do not guess.`,
    groundTruth: {
      keyFacts: [
        'lists at least two distinct modules or components by name',
        'includes actual file paths or directory names',
        'describes what each module is responsible for',
      ],
      forbiddenClaims: [
        'claims the codebase consists of only a single file',
        'invents module names not present in the codebase',
      ],
    },
    rotStates: ['fresh', 'bloated'],
  },
  {
    id: 'G1-utility-function',
    name: 'Add safeJsonParse utility (codegen)',
    category: 'codegen',
    promptTemplate: `Add a utility function called \`safeJsonParse\` that:
- Accepts a single string argument
- Returns the parsed value on success
- Returns null (without throwing) on invalid JSON

Place it in a utilities or helpers file appropriate for this project's structure and language. Show the complete file content.`,
    groundTruth: {
      keyFacts: [
        'implements a function named safeJsonParse',
        'returns null on invalid JSON instead of throwing',
        'uses try/catch or equivalent error handling',
      ],
      forbiddenClaims: [
        'throws or re-throws the JSON parse error',
        'returns undefined instead of null on failure',
      ],
    },
    rotStates: ['fresh'],
    checkCompiles: true,
  },
  {
    id: 'D1-stale-data',
    name: 'Debug stale data on first load (debug)',
    category: 'debug',
    promptTemplate: `Users report that data shown in the UI or output is stale on first load, but correct after a manual refresh or restart.

Based on the codebase structure visible in the context, what is the most likely root cause? Point to a specific file or function where the issue likely originates and explain why.`,
    groundTruth: {
      keyFacts: [
        'identifies a specific file or function as the likely source',
        'explains an async timing issue, race condition, or initialization ordering problem',
        'suggests where to look or what to fix',
      ],
      forbiddenClaims: [
        'claims the issue is purely a CSS or styling problem',
        'says there is no bug or the data is always fresh',
      ],
    },
    rotStates: ['fresh', 'warm'],
  },
  {
    id: 'R2-contradiction',
    name: 'Contradiction detection under rot (rot-stress)',
    category: 'rot-stress',
    promptTemplate: `Earlier in this session someone stated that this project has no external dependencies — it is entirely self-contained with no third-party packages or imports from outside the standard library.

Based on what you can see in the codebase context, is that accurate? What does this project actually depend on?`,
    groundTruth: {
      keyFacts: [
        'identifies the claim as inaccurate',
        'mentions a dependency manifest file such as package.json, requirements.txt, go.mod, Cargo.toml, or similar',
        'names at least one actual third-party dependency',
      ],
      forbiddenClaims: [
        'confirms the project has no external dependencies',
        'agrees that no third-party packages are used',
      ],
    },
    rotStates: ['bloated', 'critical'],
  },
];

export function getTaskById(id: string): BenchmarkTask | undefined {
  return BUILT_IN_TASKS.find(t => t.id === id);
}

export function resolvePrompt(task: BenchmarkTask): string {
  let prompt = task.promptTemplate;
  if (task.variables) {
    for (const [key, value] of Object.entries(task.variables)) {
      prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
  }
  return prompt;
}
