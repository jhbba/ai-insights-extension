# AI Insights - Token Tracker for VS Code

Track token usage, costs, and AI metrics across **GitHub Copilot**, **Antigravity**, **Claude Code**, and **Codex** - all from your VS Code status bar.

All data is read from local session logs - **nothing leaves your machine**.

![alt text](https://github.com/milan-holes/ai-insights-extension/blob/main/screenshots/screenshot-2.png?raw=true "AI Insights Dashboard")
![alt text](https://github.com/milan-holes/ai-insights-extension/blob/main/screenshots/screenshot-3.png?raw=true "AI Insights Dashboard")
![alt text](https://github.com/milan-holes/ai-insights-extension/blob/main/screenshots/screenshot-1.png?raw=true "Token Usage")
![alt text](https://github.com/milan-holes/ai-insights-extension/blob/main/screenshots/screenshot-4.png?raw=true "Sessions")

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

## Install

### From Source

```bash
git clone https://github.com/milan-holes/ai-insights-extension
cd ai-insights-extension
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

## Settings

| Setting                                    | Default | Description                  |
| ------------------------------------------ | ------- | ---------------------------- |
| `aiInsights.display.compactNumbers`        | `true`  | Use K/M suffixes for numbers |
| `aiInsights.providers.copilot.enabled`     | `true`  | Enable Copilot tracking      |
| `aiInsights.providers.antigravity.enabled` | `true`  | Enable Antigravity tracking  |
| `aiInsights.providers.claudeCode.enabled`  | `true`  | Enable Claude Code tracking  |
| `aiInsights.providers.codex.enabled`       | `true`  | Enable Codex tracking        |
| `aiInsights.refreshIntervalMinutes`        | `5`     | Auto-refresh interval        |

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

## License

MIT
