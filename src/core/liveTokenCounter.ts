import * as vscode from 'vscode';

export type TokenFamily = 'claude' | 'gpt' | 'gemini';

const FAMILY_LABELS: Record<TokenFamily, string> = {
  claude: 'Claude',
  gpt: 'GPT',
  gemini: 'Gemini',
};

const CHARS_PER_TOKEN: Record<TokenFamily, number> = {
  claude: 3.5,
  gpt: 4.0,
  gemini: 3.8,
};

const FAMILIES: TokenFamily[] = ['claude', 'gpt', 'gemini'];

export class LiveTokenCounter implements vscode.Disposable {
  private readonly statusBar: vscode.StatusBarItem;
  private family: TokenFamily;
  private highlightEnabled: boolean;
  private decorEven: vscode.TextEditorDecorationType | undefined;
  private decorOdd: vscode.TextEditorDecorationType | undefined;
  private readonly disposeables: vscode.Disposable[] = [];

  constructor() {
    const cfg = vscode.workspace.getConfiguration('aiInsights.tokenCounter');
    this.family = (cfg.get<string>('defaultFamily', 'claude') as TokenFamily);
    this.highlightEnabled = cfg.get<boolean>('highlightEnabled', false);

    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      1000,
    );
    this.statusBar.command = 'aiInsights.changeTokenModel';
  }

  start(subscriptions: vscode.Disposable[]): void {
    subscriptions.push(this.statusBar);
    subscriptions.push(this);

    this.disposeables.push(
      vscode.window.onDidChangeTextEditorSelection(e => this.onSelectionChange(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor(e => {
        if (e) { this.onSelectionChange(e); }
        else { this.statusBar.hide(); this.clearDecorations(vscode.window.activeTextEditor); }
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('aiInsights.tokenCounter')) { this.reload(); }
      }),
    );

    const editor = vscode.window.activeTextEditor;
    if (editor) { this.onSelectionChange(editor); }
  }

  cycleFamily(): void {
    const idx = FAMILIES.indexOf(this.family);
    this.family = FAMILIES[(idx + 1) % FAMILIES.length];
    const editor = vscode.window.activeTextEditor;
    if (editor) { this.onSelectionChange(editor); }
  }

  toggleHighlight(): void {
    this.highlightEnabled = !this.highlightEnabled;
    const editor = vscode.window.activeTextEditor;
    if (editor) { this.onSelectionChange(editor); }
    else { this.clearDecorations(undefined); }
    vscode.window.setStatusBarMessage(
      `Token highlighting ${this.highlightEnabled ? 'on' : 'off'}`,
      2000,
    );
  }

  dispose(): void {
    this.clearDecorations(vscode.window.activeTextEditor);
    this.disposeDecoTypes();
    for (const d of this.disposeables) { d.dispose(); }
  }

  private reload(): void {
    const cfg = vscode.workspace.getConfiguration('aiInsights.tokenCounter');
    this.family = (cfg.get<string>('defaultFamily', this.family) as TokenFamily);
    this.highlightEnabled = cfg.get<boolean>('highlightEnabled', this.highlightEnabled);
    this.disposeDecoTypes();
    const editor = vscode.window.activeTextEditor;
    if (editor) { this.onSelectionChange(editor); }
  }

  private getDecoTypes(): [vscode.TextEditorDecorationType, vscode.TextEditorDecorationType] {
    if (!this.decorEven || !this.decorOdd) {
      const cfg = vscode.workspace.getConfiguration('aiInsights.tokenCounter');
      const c1 = cfg.get<string>('highlightColorEven', '#FF8C0030');
      const c2 = cfg.get<string>('highlightColorOdd', '#4169E130');
      this.decorEven = vscode.window.createTextEditorDecorationType({ backgroundColor: c1, borderRadius: '2px' });
      this.decorOdd  = vscode.window.createTextEditorDecorationType({ backgroundColor: c2, borderRadius: '2px' });
    }
    return [this.decorEven, this.decorOdd];
  }

  private disposeDecoTypes(): void {
    this.decorEven?.dispose(); this.decorEven = undefined;
    this.decorOdd?.dispose();  this.decorOdd  = undefined;
  }

  private onSelectionChange(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme === 'output' || editor.document.uri.scheme === 'debug') {
      this.statusBar.hide();
      return;
    }

    const sel = editor.selection;
    const hasSelection = !sel.isEmpty;
    const text = hasSelection
      ? editor.document.getText(sel)
      : editor.document.getText();

    const cpt = CHARS_PER_TOKEN[this.family];
    const count = Math.round(text.length / cpt);
    const label = FAMILY_LABELS[this.family];
    const hlIcon = this.highlightEnabled ? '$(color-mode) ' : '';
    const selTag = hasSelection ? ' sel' : '';

    const cfg = vscode.workspace.getConfiguration('aiInsights.tokenCounter');
    const template = cfg.get<string>('statusBarTemplate', '$(symbol-numeric) {count}{sel} | {model}');

    this.statusBar.text = template
      .replace('{count}', fmtN(count))
      .replace('{sel}', selTag)
      .replace('{model}', label)
      .replace('{family}', label)
      .replace('{provider}', label)
      .replace('$(symbol-numeric)', `${hlIcon}$(symbol-numeric)`);

    const tooltip = new vscode.MarkdownString(
      [
        `**${fmtN(count)} tokens** (${hasSelection ? 'selection' : 'document'})`,
        `Model family: **${label}** · ~${cpt} chars/token`,
        ``,
        `_Click to cycle model · Use command palette to toggle highlights_`,
      ].join('\n\n'),
    );
    tooltip.isTrusted = true;
    this.statusBar.tooltip = tooltip;
    this.statusBar.show();

    if (this.highlightEnabled && hasSelection) {
      this.applyHighlights(editor, sel, text, cpt);
    } else {
      this.clearDecorations(editor);
    }
  }

  private applyHighlights(
    editor: vscode.TextEditor,
    sel: vscode.Selection,
    text: string,
    cpt: number,
  ): void {
    const cappedText = text.length > 200_000 ? text.slice(0, 200_000) : text;
    const tokenRanges = approximateTokenRanges(cappedText, cpt);
    const [decoEven, decoOdd] = this.getDecoTypes();
    const startOffset = editor.document.offsetAt(sel.start);

    const even: vscode.Range[] = [];
    const odd: vscode.Range[] = [];
    let tokenIdx = 0;

    for (const [s, e] of tokenRanges) {
      if (/^\s+$/.test(cappedText.slice(s, e))) { continue; }
      const start = editor.document.positionAt(startOffset + s);
      const end   = editor.document.positionAt(startOffset + e);
      const range = new vscode.Range(start, end);
      if (tokenIdx % 2 === 0) { even.push(range); } else { odd.push(range); }
      tokenIdx++;
    }

    editor.setDecorations(decoEven, even);
    editor.setDecorations(decoOdd, odd);
  }

  private clearDecorations(editor: vscode.TextEditor | undefined): void {
    if (!editor || !this.decorEven || !this.decorOdd) { return; }
    editor.setDecorations(this.decorEven, []);
    editor.setDecorations(this.decorOdd, []);
  }
}

function fmtN(n: number): string {
  if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1)}M`; }
  if (n >= 1_000)     { return `${(n / 1_000).toFixed(1)}K`; }
  return String(n);
}

/**
 * Approximate BPE-style tokenization. Splits on whitespace, operators, and
 * long identifiers (>maxChars). Returns character offset pairs [start, end].
 */
export function approximateTokenRanges(text: string, charsPerToken: number): Array<[number, number]> {
  const tokens: Array<[number, number]> = [];
  const maxChars = Math.max(3, Math.round(charsPerToken));
  const re = /\r?\n|[ \t]+|[a-zA-Z_$][a-zA-Z0-9_$]*|[0-9]+(?:\.[0-9]+)?|[^a-zA-Z0-9_$\s]/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const s = match.index;
    const chunk = match[0];
    const e = s + chunk.length;

    if (chunk.length > maxChars + 1 && /^[a-zA-Z_$]/.test(chunk)) {
      let j = s;
      while (j < e) {
        tokens.push([j, Math.min(j + maxChars, e)]);
        j += maxChars;
      }
    } else {
      tokens.push([s, e]);
    }
  }

  return tokens;
}
