/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { detectInstalledAgent } from '../agent-cli.js';

describe('detectInstalledAgent', () => {
  test('should return null for non-existent agent preference', () => {
    const result = detectInstalledAgent('nonexistent-agent-xyz');
    expect(result).toBeNull();
  });

  test('should return an agent or null when set to auto', () => {
    const result = detectInstalledAgent('auto');
    // In auto mode, either an installed agent is found or null is returned
    if (result !== null) {
      expect(['claude', 'codex', 'gemini', 'copilot', 'opencode', 'cursor']).toContain(result);
    } else {
      expect(result).toBeNull();
    }
  });

  test('should detect claude if installed', () => {
    const result = detectInstalledAgent('claude');
    // On CI or machines without claude, this may return null
    // On machines with claude installed, it should return 'claude'
    if (result !== null) {
      expect(result).toBe('claude');
    } else {
      expect(result).toBeNull();
    }
  });

  test('should return null when preference is an unknown agent name', () => {
    const result = detectInstalledAgent('not-a-real-agent');
    expect(result).toBeNull();
  });

  test('should return an agent or null with no preference (auto scan)', () => {
    const result = detectInstalledAgent();
    if (result !== null) {
      expect(['claude', 'codex', 'gemini', 'copilot', 'opencode', 'cursor']).toContain(result);
    } else {
      expect(result).toBeNull();
    }
  });
});
