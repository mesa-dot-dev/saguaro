import { isCliAuthenticated } from '../../ai/agent-runner.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import type { AgentAdapter } from './types.js';

/** Ordered by priority: Claude > Codex > Gemini. First detected wins for default provider. */
export const ALL_ADAPTERS: readonly AgentAdapter[] = [new ClaudeAdapter(), new CodexAdapter(), new GeminiAdapter()];

/** Returns adapters for all agents that are currently authenticated/available. */
export function getDetectedAdapters(): AgentAdapter[] {
  return ALL_ADAPTERS.filter((a) => isCliAuthenticated(a.id));
}

/** Get adapter by id. */
export function getAdapter(id: string): AgentAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}
