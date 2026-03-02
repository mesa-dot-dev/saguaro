import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

/** Tools that never modify files. Any tool NOT in this set that has a file_path is treated as a write. */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Agent',
  'AskUserQuestion',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  'TodoRead',
  'TodoWrite',
]);

/**
 * Parse a Claude Code transcript JSONL file and return the set of
 * repo-relative file paths that this session modified.
 */
export function extractEditedFiles(transcriptPath: string, repoRoot: string): Set<string> {
  const files = new Set<string>();

  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return files;
  }

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;

    let entry: { type?: string; tool_name?: string; tool_input?: Record<string, unknown> };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== 'tool_use' || !entry.tool_name || !entry.tool_input) continue;

    if (READ_ONLY_TOOLS.has(entry.tool_name)) continue;

    // Bash: parse command string for write patterns
    if (entry.tool_name === 'Bash') {
      const command = entry.tool_input.command;
      if (typeof command === 'string') {
        for (const filePath of extractBashWritePaths(command)) {
          addFile(files, filePath, repoRoot);
        }
      }
      continue;
    }

    // Structured tools: check file_path and notebook_path
    const filePath = entry.tool_input.file_path ?? entry.tool_input.notebook_path;
    if (typeof filePath === 'string') {
      addFile(files, filePath, repoRoot);
    }
  }

  return files;
}

/**
 * Filter a list of changed files to only those this session edited.
 * Falls back to the full list when the transcript is missing, empty, or
 * produces no overlap with the git-changed files.
 */
export function filterToSessionFiles(
  allFiles: string[],
  transcriptPath: string | undefined,
  repoRoot: string,
): string[] {
  if (!transcriptPath) return allFiles;
  const sessionFiles = extractEditedFiles(transcriptPath, repoRoot);
  if (!sessionFiles.size) return allFiles;
  const filtered = allFiles.filter((f) => sessionFiles.has(f));
  if (!filtered.length) {
    logger.error(
      `[transcript-filter] Session transcript lists ${sessionFiles.size} edited files but none overlap with git changes — falling back to all files. Possible path normalization bug.`,
    );
    return allFiles;
  }
  return filtered;
}

function addFile(files: Set<string>, filePath: string, repoRoot: string): void {
  const relative = path.normalize(
    path.isAbsolute(filePath) ? path.relative(repoRoot, filePath) : filePath,
  );
  if (relative && !relative.startsWith('..')) {
    files.add(relative);
  }
}

/** Extract file paths from common Bash write patterns. */
function extractBashWritePaths(command: string): string[] {
  const paths: string[] = [];

  // Redirects: > file, >> file (but not 2> or &>)
  for (const match of command.matchAll(/(?:^|[^2&])\s*>{1,2}\s*([^\s;|&]+)/g)) {
    const p = match[1];
    if (!p.includes('"') && !p.includes("'")) {
      paths.push(p);
    }
  }

  // tee [-a] file
  for (const match of command.matchAll(/\btee\s+(?:-[a-zA-Z]\s+)*([^\s;|&]+)/g)) {
    paths.push(match[1]);
  }

  // sed -i / sed --in-place: last non-flag argument is the file
  if (/\bsed\s+(?:.*\s)?(?:-i|--in-place)/.test(command)) {
    const args = command.match(/\bsed\s+(.*)/);
    if (args) {
      const parts = args[1].trim().split(/\s+/);
      const lastArg = parts[parts.length - 1];
      if (lastArg && !lastArg.startsWith('-') && !lastArg.startsWith("'") && !lastArg.startsWith('"')) {
        paths.push(lastArg);
      }
    }
  }

  // mv src dest, cp src dest: destination is always captured; source is also
  // captured for mv since it deletes the original file from the working tree.
  for (const match of command.matchAll(/\b(mv|cp)\s+(?:-[a-zA-Z]+\s+)*([^\s;|&]+)\s+([^\s;|&]+)/g)) {
    paths.push(match[3]);
    if (match[1] === 'mv') {
      paths.push(match[2]);
    }
  }

  // chmod, chown: last argument is the file
  for (const match of command.matchAll(/\b(?:chmod|chown)\s+(?:-[a-zA-Z]+\s+)*\S+\s+([^\s;|&]+)/g)) {
    paths.push(match[1]);
  }

  return paths;
}
