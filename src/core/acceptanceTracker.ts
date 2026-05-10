import * as vscode from 'vscode';
import { AcceptanceMetrics } from '../types';

/**
 * Tracks inline-completion acceptance rate as a quality proxy.
 *
 * "shown"    → times an inline completion was triggered (debounced, via a no-op
 *               InlineCompletionItemProvider registered alongside Copilot et al.)
 * "accepted" → times the user picked an item from the completion popup
 *               (vscode.languages.onDidAcceptCompletionItem)
 *
 * The ratio is a lightweight signal: high acceptance ≈ model is suggesting
 * things the developer actually wants. Resets each VS Code session.
 */
export class AcceptanceTracker {
  private _triggered = 0;
  private _accepted = 0;
  private _lastTrigger = 0;
  /** Debounce window in ms - one "shown" event per typing pause */
  private readonly DEBOUNCE_MS = 750;
  private readonly _since: Date;

  constructor() {
    this._since = new Date();
  }

  register(context: vscode.ExtensionContext): void {
    // ── Accepted: popup completion items ──────────────────────────────────────
    // onDidAcceptCompletionItem is a proposed API; guard so we don't crash on
    // VS Code builds that haven't stabilised it yet.
    const langs = vscode.languages as unknown as Record<string, unknown>;
    if (typeof langs['onDidAcceptCompletionItem'] === 'function') {
      const onAccept = langs['onDidAcceptCompletionItem'] as vscode.Event<unknown>;
      context.subscriptions.push(
        onAccept(() => { this._accepted++; }),
      );
    }

    // ── Shown (proxy): count inline-completion triggers ───────────────────────
    // We register as an inline provider so VS Code calls us each time ghost text
    // could be shown. Returning [] means we never interfere with Copilot/others.
    // The debounce collapses rapid keystrokes into one "shown" event per pause.
    context.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        {
          provideInlineCompletionItems: (): vscode.InlineCompletionList => {
            const now = Date.now();
            if (now - this._lastTrigger >= this.DEBOUNCE_MS) {
              this._triggered++;
              this._lastTrigger = now;
            }
            return { items: [] };
          },
        },
      ),
    );
  }

  getStats(): AcceptanceMetrics {
    return {
      triggered: this._triggered,
      accepted: this._accepted,
      acceptanceRate: this._triggered > 0 ? this._accepted / this._triggered : 0,
      since: new Date(this._since),
    };
  }
}
