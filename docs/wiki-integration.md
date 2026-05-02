# AI Insights Extension - Wiki Integration Guide

## Overview

The AI Insights extension can export usage data as markdown files for integration with your `llm-wiki` system. This allows you to maintain a persistent, searchable record of your AI tool usage across providers.

## How It Works

1. **Command**: Run `AI Insights: Export Usage Data to Wiki` from the Command Palette
2. **Output**: Creates/updates markdown files in your configured wiki directory:
   - `ai-usage-summary.md` - Overall usage dashboard
   - `copilot-usage.md` - GitHub Copilot detailed report
   - `antigravity-usage.md` - Antigravity detailed report
   - `claudeCode-usage.md` - Claude Code detailed report
   - `sessions/*.md` - Individual session logs (last 50)

## Configuration

Set the wiki output directory in VS Code settings:

```json
{
  "aiInsights.wiki.outputDirectory": "/path/to/your/wiki"
}
```

If unset, defaults to `{workspace}/wiki/`.

## Exported Data Format

### Usage Summary (`ai-usage-summary.md`)

Contains:

- Period-based metrics table (Today, 30 Days, Month, Projected Year)
- Provider breakdown with token counts and models
- Model usage ranking

### Provider Reports (`{provider}-usage.md`)

Contains:

- Total tokens, sessions, interactions, cost
- Average tokens per session
- Models used with token breakdown
- Recent session list with dates

### Session Logs (`sessions/{id}.md`)

Contains:

- Provider, timestamps, workspace
- Total tokens with input/output/thinking/cache breakdown
- Model list and interaction count

## Automation

To auto-export on each refresh cycle, you can create a VS Code task:

```json
{
  "label": "Export AI Usage to Wiki",
  "type": "shell",
  "command": "${workspaceFolder}/scripts/export-wiki.sh",
  "group": "none",
  "presentation": { "reveal": "silent" }
}
```

## Data Privacy

All exported data is generated from local session log files. No API calls are made during export. The exported markdown files contain:

- ✅ Token counts and cost estimates
- ✅ Model names and session metadata
- ✅ Timestamps and workspace identifiers
- ❌ No conversation content
- ❌ No code snippets
- ❌ No personal data
