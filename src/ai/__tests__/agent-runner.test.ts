/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import {
  buildClaudeArgs,
  buildClaudeEnv,
  buildCodexArgs,
  buildCodexEnv,
  buildGeminiArgs,
  buildGeminiEnv,
  isCliAvailable,
} from '../agent-runner.js';

// ---------------------------------------------------------------------------
// buildClaudeArgs
// ---------------------------------------------------------------------------

describe('buildClaudeArgs', () => {
  test('returns base flags with no optional args', () => {
    const args = buildClaudeArgs({});
    expect(args).toContain('-p');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--output-format');
    expect(args).toContain('text');
    expect(args).toContain('--verbose');
    expect(args).toContain('--no-session-persistence');
    expect(args).toContain('--disable-slash-commands');
    expect(args).toContain('--setting-sources');
    expect(args).toContain('--max-turns');
    expect(args).toContain('--effort');
    expect(args).toContain('low');
  });

  test('includes --model when model is provided', () => {
    const args = buildClaudeArgs({ model: 'claude-sonnet-4-6' });
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4-6');
    const modelIdx = args.indexOf('--model');
    expect(args[modelIdx + 1]).toBe('claude-sonnet-4-6');
  });

  test('includes --tools when allowedTools is provided', () => {
    const args = buildClaudeArgs({ allowedTools: ['Read', 'Glob', 'Grep'] });
    expect(args).toContain('--tools');
    expect(args).toContain('Read,Glob,Grep');
  });

  test('includes --system-prompt when systemPrompt is provided', () => {
    const args = buildClaudeArgs({ systemPrompt: 'You are a helpful assistant.' });
    expect(args).toContain('--system-prompt');
    expect(args).toContain('You are a helpful assistant.');
  });

  test('includes all optional args together', () => {
    const args = buildClaudeArgs({
      model: 'claude-opus-4-6',
      allowedTools: ['Read'],
      systemPrompt: 'Test prompt',
    });

    expect(args).toContain('--model');
    expect(args).toContain('claude-opus-4-6');
    expect(args).toContain('--output-format');
    expect(args).toContain('text');
    expect(args).toContain('--tools');
    expect(args).toContain('Read');
    expect(args).toContain('--system-prompt');
    expect(args).toContain('Test prompt');
  });

  test('uses text output format', () => {
    const args = buildClaudeArgs({});
    const fmtIdx = args.indexOf('--output-format');
    expect(fmtIdx).toBeGreaterThan(-1);
    expect(args[fmtIdx + 1]).toBe('text');
  });

  test('includes --verbose flag', () => {
    const args = buildClaudeArgs({});
    expect(args).toContain('--verbose');
  });
});

// ---------------------------------------------------------------------------
// buildClaudeEnv
// ---------------------------------------------------------------------------

describe('buildClaudeEnv', () => {
  test('strips CLAUDECODE* variables from the base env', () => {
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/test',
      CLAUDECODE_SESSION: 'abc123',
      CLAUDECODEOTHER: 'should-be-stripped',
    };
    const env = buildClaudeEnv(baseEnv);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/test');
    expect(env.CLAUDECODE_SESSION).toBeUndefined();
    expect(env.CLAUDECODEOTHER).toBeUndefined();
  });

  test('sets MESA_REVIEW_AGENT=1', () => {
    const env = buildClaudeEnv({ PATH: '/usr/bin' });
    expect(env.MESA_REVIEW_AGENT).toBe('1');
  });

  test('sets CLAUDE_NO_SOUND=1', () => {
    const env = buildClaudeEnv({ PATH: '/usr/bin' });
    expect(env.CLAUDE_NO_SOUND).toBe('1');
  });

  test('preserves non-CLAUDECODE variables', () => {
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/test',
      ANTHROPIC_API_KEY: 'sk-ant-xxx',
      CLAUDE_NO_SOUND: '0', // should be overwritten
    };
    const env = buildClaudeEnv(baseEnv);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/test');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-xxx');
    expect(env.CLAUDE_NO_SOUND).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// buildCodexArgs
// ---------------------------------------------------------------------------

describe('buildCodexArgs', () => {
  test('returns base flags with cwd', () => {
    const args = buildCodexArgs({ cwd: '/tmp/repo' });
    expect(args).toContain('exec');
    expect(args).toContain('--full-auto');
    expect(args).toContain('--color');
    expect(args).toContain('never');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('-C');
    expect(args).toContain('/tmp/repo');
    // stdin marker must be last arg
    expect(args[args.length - 1]).toBe('-');
  });

  test('includes -m when model is provided', () => {
    const args = buildCodexArgs({ cwd: '/tmp/repo', model: 'o3' });
    expect(args).toContain('-m');
    const mIdx = args.indexOf('-m');
    expect(args[mIdx + 1]).toBe('o3');
  });

  test('omits -m when model is undefined', () => {
    const args = buildCodexArgs({ cwd: '/tmp/repo' });
    expect(args).not.toContain('-m');
  });

  test('-C is followed by cwd value', () => {
    const args = buildCodexArgs({ cwd: '/my/project' });
    const cIdx = args.indexOf('-C');
    expect(cIdx).toBeGreaterThan(-1);
    expect(args[cIdx + 1]).toBe('/my/project');
  });
});

// ---------------------------------------------------------------------------
// buildCodexEnv
// ---------------------------------------------------------------------------

describe('buildCodexEnv', () => {
  test('preserves base env variables', () => {
    const env = buildCodexEnv({ PATH: '/usr/bin', HOME: '/home/test' });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/test');
  });

  test('sets MESA_REVIEW_AGENT=1', () => {
    const env = buildCodexEnv({ PATH: '/usr/bin' });
    expect(env.MESA_REVIEW_AGENT).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// buildGeminiArgs
// ---------------------------------------------------------------------------

describe('buildGeminiArgs', () => {
  test('returns base flags', () => {
    const args = buildGeminiArgs({});
    expect(args).toContain('--approval-mode');
    expect(args).toContain('yolo');
  });

  test('includes -m when model is provided', () => {
    const args = buildGeminiArgs({ model: 'gemini-2.5-pro' });
    expect(args).toContain('-m');
    const mIdx = args.indexOf('-m');
    expect(args[mIdx + 1]).toBe('gemini-2.5-pro');
  });

  test('omits -m when model is undefined', () => {
    const args = buildGeminiArgs({});
    expect(args).not.toContain('-m');
  });
});

// ---------------------------------------------------------------------------
// buildGeminiEnv
// ---------------------------------------------------------------------------

describe('buildGeminiEnv', () => {
  test('preserves base env variables', () => {
    const env = buildGeminiEnv({ PATH: '/usr/bin', HOME: '/home/test' });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/test');
  });

  test('sets MESA_REVIEW_AGENT=1', () => {
    const env = buildGeminiEnv({ PATH: '/usr/bin' });
    expect(env.MESA_REVIEW_AGENT).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// isCliAvailable
// ---------------------------------------------------------------------------

describe('isCliAvailable', () => {
  test('returns false for a nonexistent command', () => {
    expect(isCliAvailable('__mesa_nonexistent_cli_test__')).toBe(false);
  });
});
