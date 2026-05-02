# Changelog

All notable changes to the AI Insights extension will be documented in this file.

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
