import * as fs from 'fs';
import * as path from 'path';

export class SessionTagsStore {
  private readonly filePath: string;
  private data: Record<string, string[]> = {};

  constructor(storageDir: string) {
    this.filePath = path.join(storageDir, 'session-tags.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch { /* ignore write errors */ }
  }

  getAll(): Record<string, string[]> {
    return { ...this.data };
  }

  getTags(sessionId: string): string[] {
    return this.data[sessionId] ? [...this.data[sessionId]] : [];
  }

  addTag(sessionId: string, tag: string): void {
    const t = tag.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32);
    if (!t) { return; }
    if (!this.data[sessionId]) { this.data[sessionId] = []; }
    if (!this.data[sessionId].includes(t)) {
      this.data[sessionId] = [...this.data[sessionId], t];
      this.save();
    }
  }

  removeTag(sessionId: string, tag: string): void {
    if (!this.data[sessionId]) { return; }
    this.data[sessionId] = this.data[sessionId].filter(t => t !== tag);
    if (this.data[sessionId].length === 0) { delete this.data[sessionId]; }
    this.save();
  }

  allTags(): string[] {
    const set = new Set<string>();
    for (const tags of Object.values(this.data)) {
      for (const t of tags) { set.add(t); }
    }
    return [...set].sort();
  }
}
