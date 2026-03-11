import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../git/git.js';
import type { ReviewHistoryEntry } from '../types/types.js';

export function getDefaultHistoryPath(): string {
  return path.join(findRepoRoot(), '.saguaro', 'history', 'reviews.jsonl');
}

export function appendReviewEntry(entry: ReviewHistoryEntry, filePath?: string): void {
  const target = filePath ?? getDefaultHistoryPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function readReviewHistory(filePath?: string): ReviewHistoryEntry[] {
  const target = filePath ?? getDefaultHistoryPath();

  if (!fs.existsSync(target)) {
    return [];
  }

  const content = fs.readFileSync(target, 'utf8');
  const entries: ReviewHistoryEntry[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as ReviewHistoryEntry);
    } catch {
      // Skip malformed lines — never block stats over a corrupt entry
    }
  }

  return entries;
}
