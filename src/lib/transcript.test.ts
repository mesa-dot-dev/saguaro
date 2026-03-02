import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractEditedFiles } from './transcript.js';

function writeTmpTranscript(lines: object[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
  return file;
}

const REPO_ROOT = '/home/user/project';

describe('extractEditedFiles', () => {
  const tmpFiles: string[] = [];

  function makeTranscript(lines: object[]): string {
    const f = writeTmpTranscript(lines);
    tmpFiles.push(path.dirname(f));
    return f;
  }

  afterEach(() => {
    for (const dir of tmpFiles) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpFiles.length = 0;
  });

  test('extracts Edit and Write file paths', () => {
    const file = makeTranscript([
      { type: 'tool_use', tool_name: 'Edit', tool_input: { file_path: '/home/user/project/src/foo.ts' } },
      { type: 'tool_use', tool_name: 'Write', tool_input: { file_path: '/home/user/project/src/bar.ts' } },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/foo.ts', 'src/bar.ts']));
  });

  test('extracts NotebookEdit via notebook_path', () => {
    const file = makeTranscript([
      { type: 'tool_use', tool_name: 'NotebookEdit', tool_input: { notebook_path: '/home/user/project/nb.ipynb' } },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['nb.ipynb']));
  });

  test('excludes read-only tools', () => {
    const file = makeTranscript([
      { type: 'tool_use', tool_name: 'Read', tool_input: { file_path: '/home/user/project/src/foo.ts' } },
      { type: 'tool_use', tool_name: 'Glob', tool_input: { pattern: '**/*.ts' } },
      { type: 'tool_use', tool_name: 'Grep', tool_input: { pattern: 'foo' } },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set());
  });

  test('deduplicates paths', () => {
    const file = makeTranscript([
      { type: 'tool_use', tool_name: 'Edit', tool_input: { file_path: '/home/user/project/src/foo.ts' } },
      { type: 'tool_use', tool_name: 'Edit', tool_input: { file_path: '/home/user/project/src/foo.ts' } },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/foo.ts']));
  });

  test('handles already-relative paths', () => {
    const file = makeTranscript([{ type: 'tool_use', tool_name: 'Edit', tool_input: { file_path: 'src/foo.ts' } }]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/foo.ts']));
  });

  test('returns empty set for nonexistent transcript', () => {
    const result = extractEditedFiles('/nonexistent/transcript.jsonl', REPO_ROOT);
    expect(result).toEqual(new Set());
  });

  test('skips malformed JSONL lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-'));
    tmpFiles.push(dir);
    const file = path.join(dir, 'transcript.jsonl');
    fs.writeFileSync(
      file,
      [
        'not json',
        JSON.stringify({
          type: 'tool_use',
          tool_name: 'Edit',
          tool_input: { file_path: '/home/user/project/src/foo.ts' },
        }),
        '{broken',
      ].join('\n')
    );
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/foo.ts']));
  });

  test('includes unknown tools with file_path (deny-list approach)', () => {
    const file = makeTranscript([
      { type: 'tool_use', tool_name: 'MultiEdit', tool_input: { file_path: '/home/user/project/src/new.ts' } },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/new.ts']));
  });

  // Bash heuristic tests

  test('extracts file from Bash redirect (>)', () => {
    const file = makeTranscript([
      { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'echo "hello" > /home/user/project/out.txt' } },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['out.txt']));
  });

  test('extracts file from Bash append redirect (>>)', () => {
    const file = makeTranscript([
      { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'echo "hello" >> /home/user/project/log.txt' } },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['log.txt']));
  });

  test('extracts file from Bash sed -i', () => {
    const file = makeTranscript([
      {
        type: 'tool_use',
        tool_name: 'Bash',
        tool_input: { command: "sed -i 's/foo/bar/g' /home/user/project/src/config.ts" },
      },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/config.ts']));
  });

  test('extracts file from Bash sed --in-place', () => {
    const file = makeTranscript([
      {
        type: 'tool_use',
        tool_name: 'Bash',
        tool_input: { command: "sed --in-place 's/old/new/' /home/user/project/file.txt" },
      },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['file.txt']));
  });

  test('extracts source and destination from Bash mv', () => {
    const file = makeTranscript([
      {
        type: 'tool_use',
        tool_name: 'Bash',
        tool_input: { command: 'mv /home/user/project/old.ts /home/user/project/new.ts' },
      },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['old.ts', 'new.ts']));
  });

  test('extracts destination from Bash cp', () => {
    const file = makeTranscript([
      {
        type: 'tool_use',
        tool_name: 'Bash',
        tool_input: { command: 'cp /home/user/project/src.ts /home/user/project/dest.ts' },
      },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['dest.ts']));
  });

  test('extracts file from Bash tee', () => {
    const file = makeTranscript([
      {
        type: 'tool_use',
        tool_name: 'Bash',
        tool_input: { command: 'echo "data" | tee /home/user/project/output.txt' },
      },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['output.txt']));
  });

  test('extracts file from Bash chmod', () => {
    const file = makeTranscript([
      { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'chmod +x /home/user/project/script.sh' } },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['script.sh']));
  });

  test('excludes files outside the repo root', () => {
    const file = makeTranscript([
      { type: 'tool_use', tool_name: 'Edit', tool_input: { file_path: '/tmp/outside.ts' } },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set());
  });

  test('normalizes ./ prefix so paths match git output', () => {
    const file = makeTranscript([
      { type: 'tool_use', tool_name: 'Edit', tool_input: { file_path: './src/foo.ts' } },
      { type: 'tool_use', tool_name: 'Write', tool_input: { file_path: './src/bar/baz.ts' } },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/foo.ts', 'src/bar/baz.ts']));
  });

  test('extracts nothing from read-only Bash commands', () => {
    const file = makeTranscript([
      { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'ls -la' } },
      { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'git status' } },
      { type: 'tool_use', tool_name: 'Bash', tool_input: { command: 'cat /home/user/project/foo.ts' } },
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set());
  });
});
