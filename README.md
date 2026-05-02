# AI Insights - Token Tracker for VS Code

Track token usage, costs, and AI metrics across **GitHub Copilot**, **Antigravity**, **Claude Code**, and **Codex** - all from your VS Code status bar.

All data is read from local session logs - **nothing leaves your machine**.

## Features

### 📊 Real-time Token Tracking

Displays current day and 30-day token usage directly in the VS Code status bar.

### 🤖 Multi-Provider Support

Track usage across AI coding assistants simultaneously:

| Provider           | Data Source                        | Token Data                                       |
| ------------------ | ---------------------------------- | ------------------------------------------------ |
| **GitHub Copilot** | `workspaceStorage/*/chatSessions/` | Actual counts when available, else estimated     |
| **Antigravity**    | `~/.gemini/antigravity/brain/`     | Estimated from conversation text                 |
| **Claude Code**    | `~/.claude/projects/`              | Actual input/output/cache token counts           |
| **Codex**          | `~/.codex/sessions/`               | Actual usage snapshots from local Codex rollouts |

### 📈 Dashboard Views

- **Main Dashboard** - Token totals, cost estimates, provider breakdown, model usage
- **Interactive Charts** - Daily usage bars, stacked model breakdown, provider doughnut
- **Diagnostics** - System info, session file discovery, cache stats, JSON export

### 💰 Cost Estimation

Per-model pricing for 30+ models across OpenAI, Anthropic, and Google:

- Cache-aware pricing (Anthropic prompt caching, OpenAI prefix matching)
- Input/output token cost breakdown
- Daily and projected yearly cost

### 🌍 Environmental Impact

Estimates for CO₂ emissions, water usage, and tree equivalents based on published research.

### 📚 Wiki Export

Export usage data as markdown for llm-wiki integration:

- Overall usage summary
- Per-provider detailed reports
- Individual session logs

## Install

### From Source

```bash
git clone https://github.com/your-username/ai-insights
cd ai-insights
npm install
npm run compile
```

### Run in Development

Press `F5` in VS Code to launch the Extension Development Host.

### Package as VSIX

```bash
npx @vscode/vsce package
```

### Install VSIX

```bash
code --install-extension ai-insights-0.1.0.vsix
```

## Commands

| Command                                   | Description                       |
| ----------------------------------------- | --------------------------------- |
| `AI Insights: Refresh Token Usage`        | Manually refresh token counts     |
| `AI Insights: Show Token Usage Dashboard` | Open the main dashboard           |
| `AI Insights: Show Token Usage Charts`    | Open interactive charts           |
| `AI Insights: Generate Diagnostic Report` | Generate system diagnostic report |
| `AI Insights: Export Usage Data to Wiki`  | Export data as markdown for wiki  |

## Settings

| Setting                                    | Default | Description                  |
| ------------------------------------------ | ------- | ---------------------------- |
| `aiInsights.display.compactNumbers`        | `true`  | Use K/M suffixes for numbers |
| `aiInsights.providers.copilot.enabled`     | `true`  | Enable Copilot tracking      |
| `aiInsights.providers.antigravity.enabled` | `true`  | Enable Antigravity tracking  |
| `aiInsights.providers.claudeCode.enabled`  | `true`  | Enable Claude Code tracking  |
| `aiInsights.providers.codex.enabled`       | `true`  | Enable Codex tracking        |
| `aiInsights.refreshIntervalMinutes`        | `5`     | Auto-refresh interval        |
| `aiInsights.wiki.outputDirectory`          | `""`    | Custom wiki export directory |

## Status Bar

The extension shows token usage in the format:

```
$(pulse) <today> | <30 days>
```

**Hover** for detailed breakdown including:

- Today's tokens, sessions, and cost
- Last 30 days summary
- Per-provider breakdown

**Click** to open the full dashboard.

## Architecture

```
src/
├── extension.ts              # Entry point
├── types.ts                  # Shared type definitions
├── providers/
│   ├── base.ts               # Abstract provider interface
│   ├── copilot.ts            # GitHub Copilot adapter
│   ├── antigravity.ts        # Antigravity adapter
│   ├── claudeCode.ts         # Claude Code adapter
│   └── codex.ts              # Codex adapter
├── core/
│   ├── sessionAggregator.ts  # Multi-provider data merging
│   ├── costEstimation.ts     # Model pricing & cost calc
│   ├── cacheManager.ts       # File modification tracking
│   └── environmentalImpact.ts # CO₂/water/tree estimates
├── data/
│   ├── modelPricing.json     # 30+ model pricing data
│   └── tokenEstimators.json  # Character-to-token ratios
├── webview/
│   ├── dashboard.ts          # Main dashboard webview
│   ├── charts.ts             # Chart.js visualizations
│   └── diagnostics.ts        # Diagnostic report
└── wiki/
    └── exporter.ts           # Markdown wiki export
```

## Build Process

1. **TypeScript** → Strict type checking via `tsc --noEmit`
2. **esbuild** → Single-file bundle to `dist/extension.js` (~40KB minified)
3. **vsce** → Package as `.vsix` for distribution

```bash
# Type check
npm run compile

# Watch mode for development
npm run watch

# Production build
npm run package

# Create VSIX
npx @vscode/vsce package
```

## Session Log Locations

### GitHub Copilot

- **Linux**: `~/.config/Code/User/workspaceStorage/{hash}/chatSessions/`
- **macOS**: `~/Library/Application Support/Code/User/workspaceStorage/{hash}/chatSessions/`
- **Windows**: `%APPDATA%/Code/User/workspaceStorage/{hash}/chatSessions/`

### Antigravity

- **All platforms**: `~/.gemini/antigravity/brain/{conversation-id}/.system_generated/logs/overview.txt`

### Claude Code

- **All platforms**: `~/.claude/projects/{project}/*.jsonl`

## Known Limitations

- Antigravity token counts are **estimated** from text length (no raw token API exposure)
- Copilot sessions without explicit token counts use character-based estimation
- Environmental impact uses industry average estimates, not per-provider data
- Dev Container paths may not resolve if session logs are on the host

## License

MIT
