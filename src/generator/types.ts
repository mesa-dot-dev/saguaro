import { z } from 'zod';
import type { RulePolicy } from '../types/types.js';

/**
 * Intentionally excludes `examples` and `tags` — the rule adapter does not
 * serialize them to YAML yet, so generating them wastes output tokens.
 * Add them back here once the adapter supports writing them.
 */
export const RuleProposalSchema = z.object({
  id: z.string().describe('Kebab-case rule ID (e.g., "no-raw-sql-interpolation")'),
  title: z.string().describe('Short human-readable title'),
  severity: z.enum(['error', 'warning', 'info']),
  globs: z.array(z.string()).describe('File glob patterns this rule applies to'),
  instructions: z.string().describe('What to flag and why — be specific'),
});

export interface SelectedFile {
  path: string;
  content: string;
  /** Number of files that import this file (from indexer) */
  importedByCount: number;
}

export interface ZoneConfig {
  name: string;
  /** All source files in this zone (repo-relative paths) */
  files: string[];
  /** Files selected for inclusion in the LLM prompt, with contents */
  selectedFiles: SelectedFile[];
}

export interface ScanResult {
  zones: ZoneConfig[];
  /** Total source files across all zones */
  totalSourceFiles: number;
  extensions: Record<string, number>;
  /** Root-level config file contents (package.json, tsconfig, etc.) */
  configs: Record<string, string>;
  /** Root-level documentation (README.md, ARCHITECTURE.md, etc.) */
  docs: Record<string, string>;
}

export interface ZoneAnalysisResult {
  zoneName: string;
  rules: RulePolicy[];
  inputTokens: number;
  outputTokens: number;
}

export interface GeneratorResult {
  rules: RulePolicy[];
  summary: {
    filesScanned: number;
    rulesGenerated: number;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
  };
}

interface GeneratorIndexingEvent {
  type: 'indexing';
}

interface GeneratorScanCompleteEvent {
  type: 'scan_complete';
  totalFiles: number;
  zoneCount: number;
  extensions: Record<string, number>;
}

interface GeneratorZoneStartedEvent {
  type: 'zone_started';
  zoneName: string;
  fileCount: number;
  selectedFileCount: number;
}

interface GeneratorZoneCompletedEvent {
  type: 'zone_completed';
  zoneName: string;
  rulesProposed: number;
  durationMs: number;
}

interface GeneratorSynthesisStartedEvent {
  type: 'synthesis_started';
  candidateCount: number;
}

interface GeneratorSynthesisCompletedEvent {
  type: 'synthesis_completed';
  candidateCount: number;
  finalCount: number;
  durationMs: number;
}

interface GeneratorCompleteEvent {
  type: 'generator_complete';
  totalRules: number;
  durationMs: number;
}

export type GeneratorProgressEvent =
  | GeneratorIndexingEvent
  | GeneratorScanCompleteEvent
  | GeneratorZoneStartedEvent
  | GeneratorZoneCompletedEvent
  | GeneratorSynthesisStartedEvent
  | GeneratorSynthesisCompletedEvent
  | GeneratorCompleteEvent;

export type GeneratorProgressCallback = (event: GeneratorProgressEvent) => void;

export interface GenerateRulesOptions {
  configPath?: string;
  cwd?: string;
  onProgress?: GeneratorProgressCallback;
  abortSignal?: AbortSignal;
}
