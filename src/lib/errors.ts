export type MesaErrorCode =
  | 'CONFIG_INVALID'
  | 'CONFIG_MISSING'
  | 'API_KEY_MISSING'
  | 'GIT_NOT_FOUND'
  | 'GIT_DIFF_TOO_LARGE'
  | 'NO_RULES_FOUND'
  | 'AGENT_EXECUTION_FAILED';

export class MesaError extends Error {
  readonly code: MesaErrorCode;
  readonly suggestion?: string;
  /** Process exit code — defaults to 1 */
  readonly exitCode: number;

  constructor(
    code: MesaErrorCode,
    message: string,
    options?: { suggestion?: string; cause?: unknown; exitCode?: number }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MesaError';
    this.code = code;
    this.suggestion = options?.suggestion;
    this.exitCode = options?.exitCode ?? 1;
  }
}

export class ConfigInvalidError extends MesaError {
  constructor(detail: string, options?: { cause?: unknown }) {
    super('CONFIG_INVALID', `Invalid config: ${detail}`, {
      suggestion: 'Check .mesa/config.yaml for typos or run "mesa init" to regenerate.',
      cause: options?.cause,
    });
    this.name = 'ConfigInvalidError';
  }
}

export class ConfigMissingError extends MesaError {
  constructor() {
    super('CONFIG_MISSING', 'No Mesa config found.', {
      suggestion: 'Run "mesa init" to set up, or pass --config.',
    });
    this.name = 'ConfigMissingError';
  }
}

export class ApiKeyMissingError extends MesaError {
  constructor(provider: string) {
    super('API_KEY_MISSING', `No API key found for provider "${provider}".`, {
      suggestion: `Set ${provider.toUpperCase()}_API_KEY in your environment (.env.local, .env) or .mesa/config.yaml.`,
    });
    this.name = 'ApiKeyMissingError';
  }
}

export class GitNotFoundError extends MesaError {
  constructor() {
    super('GIT_NOT_FOUND', 'Not a git repository.', {
      suggestion: 'Run mesa from a git repo root.',
    });
    this.name = 'GitNotFoundError';
  }
}

export class GitDiffTooLargeError extends MesaError {
  constructor() {
    super('GIT_DIFF_TOO_LARGE', 'Diff too large for processing.', {
      suggestion: 'Try narrowing the range with --base to reduce the diff size.',
    });
    this.name = 'GitDiffTooLargeError';
  }
}

export class NoRulesFoundError extends MesaError {
  constructor() {
    super('NO_RULES_FOUND', 'No rules found. Mesa needs rules to know what to check.', {
      suggestion: 'Create rules with "mesa rules create" or run "mesa init" to generate starter rules.',
    });
    this.name = 'NoRulesFoundError';
  }
}

export class AgentExecutionError extends MesaError {
  constructor(message: string, cause?: unknown) {
    super('AGENT_EXECUTION_FAILED', message, { cause, exitCode: 3 });
    this.name = 'AgentExecutionError';
  }
}
