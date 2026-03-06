import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractEditedFiles } from './transcript.js';

/**
 * Build a Claude Code transcript JSONL entry in the real format:
 * {type: "assistant", message: {content: [{type: "tool_use", name, input}]}}
 */
function makeAssistantEntry(tools: Array<{ name: string; input: Record<string, unknown> }>): object {
  return {
    type: 'assistant',
    message: {
      content: tools.map((t) => ({
        type: 'tool_use',
        id: `toolu_${Math.random().toString(36).slice(2)}`,
        name: t.name,
        input: t.input,
      })),
    },
  };
}

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
      makeAssistantEntry([{ name: 'Edit', input: { file_path: '/home/user/project/src/foo.ts' } }]),
      makeAssistantEntry([{ name: 'Write', input: { file_path: '/home/user/project/src/bar.ts' } }]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/foo.ts', 'src/bar.ts']));
  });

  test('extracts NotebookEdit via notebook_path', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        {
          name: 'NotebookEdit',
          input: { notebook_path: '/home/user/project/nb.ipynb' },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['nb.ipynb']));
  });

  test('excludes read-only tools', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        { name: 'Read', input: { file_path: '/home/user/project/src/foo.ts' } },
        { name: 'Glob', input: { pattern: '**/*.ts' } },
        { name: 'Grep', input: { pattern: 'foo' } },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set());
  });

  test('deduplicates paths', () => {
    const file = makeTranscript([
      makeAssistantEntry([{ name: 'Edit', input: { file_path: '/home/user/project/src/foo.ts' } }]),
      makeAssistantEntry([{ name: 'Edit', input: { file_path: '/home/user/project/src/foo.ts' } }]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/foo.ts']));
  });

  test('handles already-relative paths', () => {
    const file = makeTranscript([makeAssistantEntry([{ name: 'Edit', input: { file_path: 'src/foo.ts' } }])]);
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
        JSON.stringify(
          makeAssistantEntry([
            {
              name: 'Edit',
              input: { file_path: '/home/user/project/src/foo.ts' },
            },
          ])
        ),
        '{broken',
      ].join('\n')
    );
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/foo.ts']));
  });

  test('includes unknown tools with file_path (deny-list approach)', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        {
          name: 'MultiEdit',
          input: { file_path: '/home/user/project/src/new.ts' },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/new.ts']));
  });

  test('extracts file from Bash redirect (>)', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        {
          name: 'Bash',
          input: { command: 'echo "hello" > /home/user/project/out.txt' },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['out.txt']));
  });

  test('extracts file from Bash append redirect (>>)', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        {
          name: 'Bash',
          input: { command: 'echo "hello" >> /home/user/project/log.txt' },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['log.txt']));
  });

  test('extracts file from Bash sed -i', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        {
          name: 'Bash',
          input: {
            command: "sed -i 's/foo/bar/g' /home/user/project/src/config.ts",
          },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/config.ts']));
  });

  test('extracts file from Bash sed --in-place', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        {
          name: 'Bash',
          input: {
            command: "sed --in-place 's/old/new/' /home/user/project/file.txt",
          },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['file.txt']));
  });

  test('extracts source and destination from Bash mv', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        {
          name: 'Bash',
          input: {
            command: 'mv /home/user/project/old.ts /home/user/project/new.ts',
          },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['old.ts', 'new.ts']));
  });

  test('extracts destination from Bash cp', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        {
          name: 'Bash',
          input: {
            command: 'cp /home/user/project/src.ts /home/user/project/dest.ts',
          },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['dest.ts']));
  });

  test('extracts file from Bash tee', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        {
          name: 'Bash',
          input: {
            command: 'echo "data" | tee /home/user/project/output.txt',
          },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['output.txt']));
  });

  test('extracts file from Bash chmod', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        {
          name: 'Bash',
          input: { command: 'chmod +x /home/user/project/script.sh' },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['script.sh']));
  });

  test('excludes files outside the repo root', () => {
    const file = makeTranscript([makeAssistantEntry([{ name: 'Edit', input: { file_path: '/tmp/outside.ts' } }])]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set());
  });

  test('normalizes ./ prefix so paths match git output', () => {
    const file = makeTranscript([
      makeAssistantEntry([{ name: 'Edit', input: { file_path: './src/foo.ts' } }]),
      makeAssistantEntry([{ name: 'Write', input: { file_path: './src/bar/baz.ts' } }]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/foo.ts', 'src/bar/baz.ts']));
  });

  test('extracts nothing from read-only Bash commands', () => {
    const file = makeTranscript([
      makeAssistantEntry([{ name: 'Bash', input: { command: 'ls -la' } }]),
      makeAssistantEntry([{ name: 'Bash', input: { command: 'git status' } }]),
      makeAssistantEntry([
        {
          name: 'Bash',
          input: { command: 'cat /home/user/project/foo.ts' },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set());
  });

  test('handles multiple tool uses in a single assistant message', () => {
    const file = makeTranscript([
      makeAssistantEntry([
        { name: 'Edit', input: { file_path: '/home/user/project/src/a.ts' } },
        {
          name: 'Write',
          input: { file_path: '/home/user/project/src/b.ts' },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/a.ts', 'src/b.ts']));
  });

  test('ignores non-assistant entry types', () => {
    const file = makeTranscript([
      { type: 'progress', content: 'thinking...' },
      { type: 'user', message: 'fix it' },
      { type: 'system', content: 'context' },
      makeAssistantEntry([
        {
          name: 'Edit',
          input: { file_path: '/home/user/project/src/real.ts' },
        },
      ]),
    ]);
    const result = extractEditedFiles(file, REPO_ROOT);
    expect(result).toEqual(new Set(['src/real.ts']));
  });
});
