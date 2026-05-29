# Changelog

All notable changes to the AI Insights extension will be documented in this file.

## [0.1.7] - 2026-05-29

- **Status bar: live context health** - when a Claude Code session is active (JSONL file modified within 3 min), the status bar switches from aggregate stats to real-time context info: current context window usage (tokens + %), health label (healthy / warning / stale), and today's total. Tooltip shows a mini progress bar, health score, turns, and cache efficiency. Reverts to aggregate mode automatically 3 minutes after the last turn. Implemented via `vscode.workspace.createFileSystemWatcher` on `~/.claude/projects/**/*.jsonl` with 1.5 s debounce.

- **Claude Account panel - Usage Limits section** (`aiInsights.showClaudeAccount`):
  - Session window (last 5 h) and Weekly window (last 7 d) cards - token counts, output tokens, interaction count, and countdown to reset - calculated directly from local Claude Code session files. No API key required.
  - Session reset time is estimated as 5 h after the oldest interaction in the window (matching Claude Pro's rolling session window). Weekly reset defaults to Friday 11:00 AM.
  - No fake % bars - limits are not publicly documented; raw counts are shown with an explanatory note.
- **Claude Account panel** (`aiInsights.showClaudeAccount`, tab in nav: "Claude Account"):
  - Connect with an Anthropic API key - stored in VS Code SecretStorage, never leaves the machine.
  - Live rate-limit display fetched from `api.anthropic.com` on open: requests/min, tokens/min, input tokens/min, output tokens/min, with progress bars and reset timestamps.
  - Local usage summary cards (today / this month / cache hit rate / session count) drawn from parsed Claude Code session files.
  - Per-model breakdown table (tokens, input, output, cost) for the current month.
  - Disconnect button clears the stored key; Refresh re-fetches rate-limit headers.
- **Tier-1 context engineering metrics** in Context Workbench overlay and session row tooltips:
  - **Context Runway** - estimated turns remaining before the 200K context limit at the current growth rate (linear regression on last 6 turns); shown as a chip in the overlay header and added to the row badge tooltip.
  - **Growth Curve Classification** - `plateau` / `linear` / `spike` / `exponential` by variance and half-session growth-rate comparison; shown in the overlay header.
  - **Cache Efficiency Rate** - `cacheReadTokens / totalInputTokens × 100`; shown in the Context Budget Allocation section and row badge tooltip.
  - **Cache Thrash Signal** - `cache_thrash` overload signal when cache writes exceed reads by 2× (context changing too fast for cache to stabilize).
  - **Thinking Efficiency Trend** - `rising` / `stable` / `falling` / `none` by comparing thinking/output ratio across session thirds; `rising` fires a `thinking_overload` signal.

- **Tier-3 context engineering metrics** in Context Workbench overlay:
  - **Context Budget Allocation chart** - donut chart breaking down total token spend into: cached input, fresh input, output, thinking, cache writes. Teaches the "right information at the right time" principle.
  - **Lost-in-the-Middle Risk** - 0–100 score scaling from 60K→200K total input tokens; fires `lost_in_middle` overload signal above 60%.
  - **Context Quality Score (CQ 0–100)** - composite of cache efficiency (30 pts), tool overhead (20 pts), growth curve shape (30 pts), LIM inverse (20 pts); shown as a card in the overlay header and row badge tooltip.
  - **Session Sibling Detection** - detects sessions in the same workspace with matching 40-char first-prompt prefix within 24 h; surfaces as a "Groundhog-day pattern" banner in the overlay.
- **Context Size panel** in Context Workbench - shows peak context size, last-turn context size, cache hit rate, and total tokens from cache. Stacked bar visualises the input / output / thinking token split for the whole session.

- **Interaction Timeline** in Context Workbench - per-turn rows showing timestamp, mode badge, truncated prompt preview, tool call badges, and token breakdown (↑ input, ↓ output, ⚡ cache read, think, ✍ cache write). Shows last 20 turns; earlier turns indicated with a count.

- **Files in Context** panel in Context Workbench - shows unique files Read/Edited/Written during the session (accumulated in the context window), with per-file read/edit/write counts, paths shortened relative to workspace. Sorted edited-first.
### Fixed

- **Interaction Timeline: ↑ now shows total context size** - the input-token arrow (↑) in each turn row now displays `inputTokens + cacheReadTokens`, i.e. the full context sent to the model that turn. Previously it showed only the non-cached new tokens (often just 1–3), which was misleading when most of the context was served from cache. The ⚡ cache-read badge still shows the cached portion separately; its tooltip now notes it is included in the ↑ figure.
- **Interaction Timeline: compaction events** - context compaction boundaries (both auto and manual `/compact`) now appear as distinct amber rows in the timeline, showing the trigger type and the pre→post token reduction.

### Added

- **Context Optimization section** in Context Workbench - a new panel beneath Overload Signals ranks actionable optimization opportunities with estimated token savings (%) for the current session. Six techniques are detected automatically:
  - **Caveman** - excessive Bash calls suggesting debug-print pattern (`bashCount − 3 × 90 tok`)
  - **File re-reads** - same file accessed multiple times across turns (`extraReads × 400 tok`)
  - **TOON** - Read called many times; excerpt-only returns would cut 60% per call
  - **/compact timing** - peak context > 60K with no compaction; shows per-heavy-turn savings
  - **Output trim** - average output > 1200 tok/turn; 25% cut estimate
  - **Prompt dedupe** - repeated prompt fragments detected; move to CLAUDE.md

- **Benchmark experimental notice** - a warning banner is now shown at the top of the Benchmark view noting the feature is experimental and that running all combinations can consume significant tokens.
- **Benchmark confirm modal** - clicking "Run Benchmark" now shows a confirmation dialog with a breakdown of selected techniques, tasks, rot states, runs per combination, and the total run count before execution begins.

- **Copilot session snapshot store** - Copilot chat sessions are now persisted to VS Code's extension global storage (`SessionSnapshotStore`) every time they are parsed. When a developer clears a Copilot chat (which deletes the underlying session file), the extension replays data from the snapshot so analytics remain complete. Claude Code is unaffected - its append-only JSONL format already survives `/clear` and `/compact`. See [wiki/developer-guide.md](wiki/developer-guide.md) for the full developer guide on safe session management.

### Changed

- **Analyze opens inline overlay instead of separate panel** - clicking "Analyze" on any session row now slides open a right-side drawer inside the Sessions view itself. The full Context Workbench analysis (score ring, context size, timeline chart, files in context, overload signals, interaction timeline, fresh-session brief, rehydration checklist, patterns) renders inline without navigating away. Click the backdrop or × to dismiss. The analysis data (context-rot analyses + per-interaction detail) is embedded directly in the sessions page HTML on load, so the overlay appears instantly.

### Fixed

- **Context Workbench blank screen** - clicking "Analyze" on a session now immediately renders the full analysis panel. Previously the JS init called chart renderers before building the HTML, leaving `wbMain` empty.

- **Claude Code tool call extraction was always empty** - the parser was reading `entry.tool_calls` (never present in JSONL) instead of `message.content[].type === "tool_use"`. Tool names and file paths are now correctly extracted, fixing heavy-tool and pattern detection for Claude Code sessions.

- **Technique Benchmark** (`AI Insights: Show Technique Benchmark`) - new "Benchmark" tab for comparing AI context techniques (bare, CLAUDE.md-only, LLM-wiki, Memory Bank, caveman-compressed, type-first) against each other. Measures input/output/cache tokens, cost, hallucination score, task success score, and TTFT via Anthropic API. Supports 4 context rot states (fresh/warm/bloated/critical) to test technique resilience under realistic session degradation. LLM-as-judge scores each response against ground truth. Results shown in three views: Technique Comparison table, Rot Degradation table, and Raw Results. API key stored securely in VS Code SecretStorage.

- **git worktree isolation** - each technique runs in a throwaway `git worktree` branch (`bench/{id}`), leaving the original repo untouched. Worktrees are cleaned up automatically after each run.

- **Benchmark tasks are now repo-agnostic** - all 5 built-in tasks (`K1-project-overview`, `K2-main-modules`, `G1-utility-function`, `D1-stale-data`, `R2-contradiction`) and the synthetic ROT_HISTORY conversation turns no longer reference ai-insights internals. The benchmark works against any repository where the extension is installed. The Memory Bank technique generates its `memory-bank/*.md` files dynamically from the target repo's README, primary language, and discovered file structure.

## [0.1.7] - 2026-05-16

### Added

- **Live Session Monitor** (`AI Insights: Show Live Session Monitor`) - new "Live" tab detecting sessions written to within the last 3 minutes across all providers. Cards show current tokens, elapsed time, burn rate (tokens/min over last 10 min), projected budget exhaustion, and a budget consumption bar. Alerts: high burn (>2K/min), spike (>3× normal), rate limit imminent (<60 min), rate limit hit. Manual calibration form for budget type, token/USD limits, and window reset. "Log Rate Limit Hit" button persists real events to globalState. Auto-refreshes every 30 s.

- **Context Efficiency Workbench** (`AI Insights: Show Context Efficiency Workbench`) - new "Context" tab with a left session-picker sidebar and right analysis panel: score ring (0–10), restart-recommended banner, context timeline chart (input/output/tool calls per turn), overload signals grid (high I/O ratio, long turn chain, large static context, output collapse, tool loop), fresh session brief (goal, write ops, next action, warnings), rehydration checklist, and pattern detection (heavy tools, repeated prompt fragments).

- **Expanded `ContextRotAnalysis`** - `computeContextRotAnalysis()` returns timeline, overload signals, restart recommendation, checklist, and fresh session brief. Existing `computeContextRotScore()` remains as a lightweight backward-compatible wrapper.

- **"Analyze" button in Sessions view** - each row now shows an "Analyze" button that opens the Context Workbench focused on that session.

- **Live budget config and rate-limit event log persistence** - budget config and up to 100 rate-limit events survive restarts via VS Code globalState.

## [0.1.6] - 2026-05-14

### Added

- **Token Calculator** (`AI Insights: Open Token Calculator`) - new webview panel that estimates input token costs before sending to an AI provider. File picker renders as a collapsible folder tree (folder checkboxes select/deselect entire subtrees); search falls back to a flat filtered list. A prompt textarea adds to the file token total. The context window section has a provider switcher (GitHub Copilot | Claude | OpenAI | Google) that dynamically shows all current models with a progress bar, context-fill %, and input cost. The GitHub Copilot tab additionally shows AI credits per request (1 credit = $0.01) alongside USD cost.

- **Unified navigation header on all webviews** - every panel (Overview, Usage, Copilot, Diagnostics, Sessions, Prompt History) now renders the same slim topbar + page-tab bar. Tab set: Overview | Usage | Copilot | Diagnostics | Sessions | Prompts | Calculator. Token Calculator is now reachable from the nav bar in any view.

- **Logo image in topbar** - `assets/logo.png` is now displayed in the top-left corner of every webview, replacing the previous green gradient dot placeholder.

### Changed

- **Filter bar label visibility** - PROVIDER and PERIOD group labels are now rendered at lower opacity (`rgba(193,198,215,0.38)`) and smaller letter-spacing to visually subordinate them relative to the filter chips, making the two groups easier to scan at a glance.

## [0.1.5] - 2026-05-12

### Added

- **Provider filter applies to all dashboard widgets** - selecting a provider in the switcher bar now also updates the "Token Usage by Period" table and the "Usage by Repository" table to show data for that provider only. The Projected Year column is dimmed and shows `-` for specific providers (no per-provider projection available). The repo section title updates to show the active provider name.

### Fixed

- **Cache Hit Rate card now reflects all providers** - `computeCacheMetrics` was called with `currentMonthCopilotMetrics` (Copilot only), so the dashboard cache hit card always showed 0% because Copilot logs contain no cache data. Fixed to use `currentMonthMetrics` (all providers).

- **Projected Year column now populates all rows** - Input, Output, Thinking, and Cache read tokens, plus Avg tokens/session and Avg interactions/session, were hardcoded to `-` in the "Token Usage by Period" table. The aggregator now projects each token sub-type with the year multiplier and the template renders the projected values.

- **Cache hit column shows `-` for providers without cache data** - GitHub Copilot and Antigravity logs don't expose cache token counts, so the "Usage by Provider" table was incorrectly displaying `0%` instead of `-`. The cell now shows `-` when both `cacheReadTokens` and `cacheWriteTokens` are zero (no cache data reported), and only computes a percentage when at least one exists.

## [0.1.4] - 2026-05-11

### Added

- **Provider switcher on dashboard** - a pill-style switcher bar (Overall | GitHub Copilot | Claude Code | Codex | Antigravity) now appears at the top of the dashboard below the header. Selecting a provider shows that provider's dedicated card set (tokens today, this month, last month; Copilot also shows AI credits card) and updates the daily chart to show only that provider's data. Selecting a non-Overall provider hides the "Usage by Provider" all-time table. Switching back to Overall restores all cards and the table.

- **Copilot credits pill** - when a GitHub account is connected, a fixed-position `🐙 X credits · @login` pill appears in the dashboard footer area; clicking it opens the GitHub Copilot screen directly.

- **GitHub Copilot screen** (`💳 Copilot Pricing` renamed to `🐙 GitHub Copilot`) - the pricing nav button now leads to a dedicated GitHub Copilot view showing: GitHub connect/disconnect widget, budget alert banners, summary cards (AI credits, tokens this month/last month), model pricing breakdown table, AI credits summary table, and the model pricing reference. Dashboard no longer shows these Copilot-specific tables inline.

### Changed

- **Dashboard simplified** - removed the GitHub Copilot model breakdown table and AI credits summary table from the main dashboard. These now live exclusively on the GitHub Copilot screen.
- **Usage Analysis → Tools & MCP tab** - removed the generic "🔧 Tool Usage" subsection; only the MCP Tools table is shown.
- **Usage Analysis → Cost & Impact tab** - removed the "📁 Repository Cost Attribution" section; repository cost data now appears in the dashboard's "📁 Usage by Repository (This Month)" box (with Cost and Share columns).

## [0.1.3] - 2026-05-10

### Added

- **Context Rot identifier** in Sessions table - each session row now shows a **Context Health** badge derived from static session signals: turn count, session age, input-token growth rate (first-third vs last-third of session), output-token decline rate, and total input size. Score 0–3 → 🟢 Healthy, 4–6 → 🟡 Warn, 7–10 → 🔴 Stale. Hovering the badge shows the raw breakdown (score, turns, age, bloat factor, output trend). Sessions with fewer than 3 turns show "-" (insufficient data). Logic lives in new `src/core/contextRot.ts`.

- **Prompt preview + Open log in Prompt History** - each row in the Prompt History table now shows the first ~80 chars of the user's message in a **Prompt** column (full text on hover), plus an **Open log** button that opens the raw JSONL session file in an editor tab. Text is extracted at parse time: Claude Code peeks at `user`-role entries before they are token-filtered; Copilot providers use the already-extracted `inputText`. The preview is carried as `Interaction.promptPreview` → `PromptRecord.promptPreview`; `PromptRecord` also carries `sourceFile` from the parent session.

- **Dashboard daily token/cost chart** - a "Daily Token Usage - Last 30 Days" combo chart (bars = tokens, green line = cost USD) is now rendered in the dashboard using Chart.js. Placed after summary cards, with an **⚡ View Prompt History** action button in the section header.

- **Prompt-Level Cost History panel** - new `AI Insights: Show Prompt-Level Cost History` command (`aiInsights.showPromptHistory`), also reachable via the `⚡ Prompts` button in the dashboard nav. Interactions within the same session are **grouped by a 2-minute gap threshold** so each row represents one user prompt plus all its agent turns (tool calls, sub-calls, thinking). Columns: time, provider, primary model, agent-turn count badge, aggregated token bar (in/out/cache), total cost (summed per-model), response time (first→last turn), workspace. Summary cards show prompts today, avg cost/prompt, avg turns/prompt, avg response time, top model. Sparkline shows cost-per-prompt across last 50 (oldest→newest); tooltip shows cost + turn count. `PromptHistoryStore` in `src/core/promptHistory.ts` rebuilds on every refresh cycle.

- **GitHub Copilot AI Credits Summary - previous month column** - the "💳 GitHub Copilot AI Credits Summary" table on the dashboard now shows a side-by-side comparison: "This Month" (bright) and "Last Month" (dimmed) columns for input tokens, cached input tokens, output tokens, optional cache-write tokens, and the total AI Credits / USD. Cache-write row is shown only when either month has non-zero cache writes.

## [0.1.2] - 2026-05-04

### Added

- **Sessions view date range fixed** - `DEFAULT_SESSION_LOOKBACK_DAYS` raised from 30 to 400 so "Last Month", "This Year", and "All Time" filters in the Sessions panel actually return data beyond the previous 30 days. The backend was silently discarding any session file older than 30 days before the client-side date filters could see them.
- **Sessions table pagination** - Sessions table now shows 50 rows per page with Prev / Next controls and a "Page X of Y · N sessions" counter. Page resets to 1 on any filter or sort change. "Open" button index is now page-offset-corrected so it opens the right file regardless of which page is shown.

- **Official provider logos** - replaced emoji placeholders with inline SVG brand logos across all views (dashboard provider table, sessions badge, usage analysis ROI table): GitHub mark for Copilot, Google Gemini 4-star for Antigravity, Anthropic A-mark for Claude Code, OpenAI logo for Codex. New shared `src/webview/providerIcons.ts` module.

- **Suggestion Acceptance Rate (Quality Proxy)** - new `🎯 Quality` tab in Usage Analysis. Tracks how often AI ghost-text suggestions are accepted vs. triggered using `vscode.languages.onDidAcceptCompletionItem` (popup acceptances) and a zero-interference `InlineCompletionItemProvider` (debounced trigger count as proxy for suggestions shown). Acceptance rate is colour-coded: green ≥30%, amber 10–29%, red <10%. Resets each VS Code session. New `AcceptanceMetrics` type in `types.ts`; new `src/core/acceptanceTracker.ts` module.

- **Connect GitHub to auto-set budget** - new opt-in command `AI Insights: Connect GitHub to Auto-Set Budget` authenticates via VS Code's built-in GitHub OAuth (`read:user` scope), fetches the user's GitHub plan from the API, and automatically updates `aiInsights.copilotPlanBudget` (Free→$0, Pro→$10, Business→$19, Enterprise→$39). Falls back to a quick-pick selector if the plan field is not returned. Connected status (`@login · plan · $X/month`) is shown in the dashboard above the credits card with a Reconnect button. State persists across sessions via `globalState`.

- **💰 Cost & Impact tab** in Usage Analysis - new tab surfacing the previously-hidden cost intelligence content plus a new "Developer Impact" section: hours saved, value generated (~$), ROI multiplier, and a transparent breakdown of the calculation. Two new settings control the heuristic: `aiInsights.roi.developerHourlyRate` (default $75) and `aiInsights.roi.outputTokensPerHourSaved` (default 3000). Status bar tooltip also shows impact summary (hours saved, value, ROI×).
- **Status bar now shows hours saved** - format: `$(pulse) 42.3K | 1.2M | ~8.2h saved`, giving an at-a-glance productivity signal without opening the panel.
- **Instruction Content Quality section** in Workspace Health tab - reads every AI instruction file found (`CLAUDE.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.clinerules`, `AGENTS.md`) and displays word count, whether the file has section headers, and a quality tier (Stub / Basic / Good / Rich). New `InstructionQuality` type added to `RepositoryHygieneReport`.
- **Open session button** in Sessions table - each row with a source file has an "Open" button that opens the raw JSONL log in a VS Code editor tab.
- **Export CSV** button in Sessions panel header - exports the currently filtered session list as CSV; opens in a new editor tab (language: csv).

### Fixed

- **Multi-day session token under-count** (root cause of Today showing far fewer tokens than competitors): `aggregateSessions` was filtering `todaySessions` / `yesterdaySessions` / `currentMonth` by `session.startTime`. Long-running Claude Code or Codex sessions started yesterday (or weeks ago) contributed zero tokens to today's metrics even when actively used today. Fix: new `sliceSessionsByDateRange()` helper creates virtual sessions containing only interactions within the requested window, with token totals recalculated. All period metrics now correctly reflect when work actually happened.
- **Long-running sessions excluded by lookback window** - `isSessionRecent()` checked `session.startTime >= cutoff` so a Claude Code conversation started 31 days ago (but active today) was silently dropped. Now checks `session.endTime >= cutoff` so any session with recent activity stays in scope.
- **Daily token attribution by interaction date** - `buildDailyUsage` now groups each interaction by its own timestamp, not the session start date. Sessions that span midnight (started yesterday, active today) now show tokens on the days the work actually happened.
- **Codex session names always blank** - Codex provider now extracts title from `session_meta.payload` fields (`task`, `title`, `name`, `prompt`) and falls back to the first user message found in the rollout JSONL.

### Changed

- **AI Credits shown only for Copilot** - the "Cost" column in the Sessions table now shows a green credits badge only for GitHub Copilot sessions (where 1 credit = $0.01). All other providers (Claude Code, Antigravity, Codex) show `~$X.XXXX` approximate price instead, since they have different pricing models.
- **Summary "credits" stat** now counts Copilot credits only; shows "Copilot credits N/A" when no Copilot sessions are in the filtered set.

## [0.1.1] - 2026-05-02

### Added

- **Copilot Pricing screen** - new `💳 Pricing` tab in the dashboard nav opens a dedicated webview showing official GitHub Copilot model pricing sourced from [docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing). Table grouped by provider (OpenAI, Anthropic, Google, xAI) with input, cached-input, cache-write, and output rates, computed credits/1M tokens, and an "Official" badge for models confirmed in Copilot billing docs. Command: `AI Insights: Show Copilot Model Pricing`.
- **`modelPricing.json` metadata fields**: `displayName`, `provider`, and `copilotOfficial` added to every entry; 14 models marked `copilotOfficial: true` matching the GitHub docs table. Source list updated to the Copilot billing docs URL.
- **Period-over-period % change badges** on dashboard summary cards - "Tokens Today" shows today vs yesterday (token count + % ↑/↓), "This Month" shows current vs last month, "Copilot AI Credits" shows current vs last month credits. Green arrow = higher, red = lower. `AggregatedMetrics` now includes `yesterday` and `yesterdayByProvider` fields computed by `sessionAggregator`.
- **Session title column** in the sessions table - Claude Code sessions show the `ai-title` extracted from JSONL; Antigravity sessions show the first user message line.
- **Cost / Credits column** - all sessions show estimated USD cost; Copilot sessions additionally show AI credits (cost ÷ $0.01/credit) as a green badge.
- **Sessions panel** replaces the broken v1 webview - uses `parts.push(safe) + parts.join('')` injection, making esbuild inlining impossible; table is now horizontally scrollable.
- `estimatedCostUsd` and `title` fields added to the `Session` interface.

### Fixed

- **Copilot "auto" model not resolved** - `getModelFromRequest` now checks `result.metadata.resolvedModel` first; falls back to the most-common `phaseModelId` across `toolCallRounds`. Sessions that were shown as model "auto" with "fallback" pricing now correctly show the underlying model (e.g. `gpt-5.3-codex`) with real pricing.
- **Antigravity sessions all showing today's date** - `parseOverview` was creating interactions with `new Date()` instead of parsing the `created_at` ISO field from each JSON line. Now uses real timestamps; falls back to file mtime if no timestamps found.
- **Claude Code ai-title not captured** - provider now extracts `entry.aiTitle` from `type: "ai-title"` JSONL events and stores it as `session.title`.
- **Table not scrollable** - `.section` now has `overflow-x: auto`; table has `min-width: 1100px`.
- **`cost` unused variable** in dashboard repo-cost map - removed the unused destructured parameter.
- **Claude Code today showing 0 tokens** - session files that were parsed empty (no interactions yet at first read) were cached as `null`; the fix skips caching null results so the next refresh re-reads the growing file. This corrects the "Today: 0 tokens · 0 sessions" display for active sessions.
- **Duplicate token counting in Claude Code sessions** - the JSONL format stores the same assistant message across multiple conversation branches (parentUuid chains). Added deduplication by `entry.message.id` so each unique API call is counted exactly once instead of 3–4×.
- **Cache tokens excluded from total** - `cache_read_input_tokens` and `cache_creation_input_tokens` were not included in `totalTokens`. These are now summed into the total, matching what other tracking tools (e.g. AI Engineering Fluency) report and reflecting actual context processed by the model.
- **Skip condition too broad** - entries with model-specific names but zero `input_tokens`/`output_tokens` were still added with zero totalTokens. The skip now also checks cache token fields, correctly filtering only entries with no token data whatsoever.

### Removed

- `src/webview/sessionsList.ts` (v1 sessions panel) - replaced by `sessionsView.ts`; `aiInsights.showSessions` now routes to the v2 provider.

## [0.1.0] - 2026-04-29

### Added

- **Multi-provider token tracking** for GitHub Copilot, Antigravity, and Claude Code
- **Status bar integration** showing today's and 30-day token usage with hover details
- **Dashboard webview** with token metrics, provider breakdown, model usage, environmental impact
- **Interactive charts** with Chart.js: daily bar chart, stacked model breakdown, provider doughnut
- **Diagnostics panel** with system info, provider status, session discovery, and JSON export
- **Cost estimation** for 30+ models across OpenAI, Anthropic, and Google with cache-aware pricing
- **Environmental impact** tracking (CO₂, water usage, tree equivalents)
- **Wiki export** for llm-wiki integration (overall summary, provider reports, session logs)
- **Auto-refresh** every 5 minutes with configurable interval
- **File modification caching** to avoid re-parsing unchanged session files
- **Per-provider enable/disable** via VS Code settings
- **Compact number formatting** with K/M suffixes
