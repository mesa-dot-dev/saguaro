export type SaguaroErrorCode =
  | 'CONFIG_INVALID'
  | 'CONFIG_MISSING'
  | 'API_KEY_MISSING'
  | 'GIT_NOT_FOUND'
  | 'GIT_DIFF_TOO_LARGE'
  | 'RULES_NOT_LOADED'
  | 'AGENT_EXECUTION_FAILED';

export class SaguaroError extends Error {
  readonly code: SaguaroErrorCode;
  readonly suggestion?: string;
  /** Process exit code — defaults to 1 */
  readonly exitCode: number;

  constructor(
    code: SaguaroErrorCode,
    message: string,
    options?: { suggestion?: string; cause?: unknown; exitCode?: number }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SaguaroError';
    this.code = code;
    this.suggestion = options?.suggestion;
    this.exitCode = options?.exitCode ?? 1;
  }
}

export class ConfigInvalidError extends SaguaroError {
  constructor(detail: string, options?: { cause?: unknown }) {
    super('CONFIG_INVALID', `Invalid config: ${detail}`, {
      suggestion: 'Check .saguaro/config.yaml for typos or run "sag init" to regenerate.',
      cause: options?.cause,
    });
    this.name = 'ConfigInvalidError';
  }
}

export class ConfigMissingError extends SaguaroError {
  constructor() {
    super('CONFIG_MISSING', 'No Saguaro config found.', {
      suggestion: 'Run "sag init" to set up, or pass --config.',
    });
    this.name = 'ConfigMissingError';
  }
}

export class ApiKeyMissingError extends SaguaroError {
  constructor(provider: string) {
    super('API_KEY_MISSING', `No API key found for provider "${provider}".`, {
      suggestion: `Set ${provider.toUpperCase()}_API_KEY in your environment (.env.local, .env) or .saguaro/config.yaml.`,
    });
    this.name = 'ApiKeyMissingError';
  }
}

export class GitNotFoundError extends SaguaroError {
  constructor() {
    super('GIT_NOT_FOUND', 'Not a git repository.', {
      suggestion: 'Run sag from a git repo root.',
    });
    this.name = 'GitNotFoundError';
  }
}

export class GitDiffTooLargeError extends SaguaroError {
  constructor() {
    super('GIT_DIFF_TOO_LARGE', 'Diff too large for processing.', {
      suggestion: 'Try narrowing the range with --base to reduce the diff size.',
    });
    this.name = 'GitDiffTooLargeError';
  }
}

export class AgentExecutionError extends SaguaroError {
  constructor(message: string, cause?: unknown) {
    super('AGENT_EXECUTION_FAILED', message, { cause, exitCode: 3 });
    this.name = 'AgentExecutionError';
  }
}
