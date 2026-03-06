// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export * from './adapter/classic-review.js';
// ---------------------------------------------------------------------------
// Adapters (primary API surface for packages/cli and TUI)
// ---------------------------------------------------------------------------
export * from './adapter/generate.js';
export * from './adapter/hook.js';
export type { HookDecision, HookRunOptions } from './adapter/hook-runner.js';
export { formatViolationsForClaude, runHookReview, runPreToolHook } from './adapter/hook-runner.js';
export * from './adapter/index-build.js';
export * from './adapter/init.js';
export * from './adapter/model.js';
export * from './adapter/review.js';
export * from './adapter/rules.js';
export * from './adapter/stats.js';
// ---------------------------------------------------------------------------
// CLI handlers (re-exported for packages/cli to wrap in yargs)
// ---------------------------------------------------------------------------
export { generateRulesCommand } from './cli/lib/generate.js';
export { installHook, runHook, runNotify, runPreTool, uninstallHook } from './cli/lib/hook.js';
export { default as indexCmdHandler } from './cli/lib/index-cmd.js';
export { default as initHandler } from './cli/lib/init.js';
export { default as modelHandler } from './cli/lib/model.js';
export {
  createRule,
  deleteRule,
  explainRule,
  listRules,
  locateRulesDirectory,
  validateRules,
} from './cli/lib/rules.js';
export { default as serveHandler } from './cli/lib/serve.js';
export { statsCommand } from './cli/lib/stats.js';
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export {
  formatModelForDisplay,
  getCliForProvider,
  loadValidatedConfig,
  resolveApiKey,
  resolveModelForReview,
} from './config/model-config.js';
export type { ModelInfo, ReviewEngineOutcome, ReviewRuntime } from './core/types.js';
// ---------------------------------------------------------------------------
// Daemon
// ---------------------------------------------------------------------------
export { detectInstalledAgent } from './daemon/agent-cli.js';
export {
  checkDaemonForViolations,
  checkDaemonWithPolling,
  formatFindingsForAgent,
  postReviewToDaemon,
} from './daemon/hook-client.js';
export type { StaffEngineerPromptOptions } from './daemon/prompt.js';
export { buildStaffEngineerPrompt, parseFindings, stripDiffContext } from './daemon/prompt.js';
export { MesaDaemon } from './daemon/server.js';
export { DaemonStore } from './daemon/store.js';
// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------
export { findRepoRoot, getCurrentBranch, getDefaultBranch, getRepoRoot, requireGitRepo } from './git/git.js';
// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------
export { createMesaMcpServer, startMcpServer } from './mcp/server.js';
// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
export type { MesaRuleFile, MesaRuleParseError, MesaRulesResult } from './rules/mesa-rules.js';
export {
  buildMesaRuleMarkdown,
  deleteMesaRuleFile,
  getMesaRulesDir,
  loadMesaRules,
  writeMesaRuleFile,
} from './rules/mesa-rules.js';
// ---------------------------------------------------------------------------
// Stats / History
// ---------------------------------------------------------------------------
export { appendReviewEntry, getDefaultHistoryPath, readReviewHistory } from './stats/history.js';
export type {
  ReviewHistoryEntry,
  ReviewProgressCallback,
  ReviewProgressEvent,
  ReviewResult,
  RulePolicy,
  Severity,
  Violation,
} from './types/types.js';

// ---------------------------------------------------------------------------
// Errors and logging
// ---------------------------------------------------------------------------
export type { MesaErrorCode } from './util/errors.js';
export { MesaError } from './util/errors.js';
export type { LogLevel } from './util/logger.js';
export { logger } from './util/logger.js';
