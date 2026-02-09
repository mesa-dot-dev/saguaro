export type ReviewErrorCode = 'AGENT_EXECUTION_FAILED';

export class ReviewError extends Error {
  readonly code: ReviewErrorCode;

  constructor(code: ReviewErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ReviewError';
    this.code = code;
  }
}

export class AgentExecutionError extends ReviewError {
  constructor(message: string, cause?: unknown) {
    super('AGENT_EXECUTION_FAILED', message, cause);
    this.name = 'AgentExecutionError';
  }
}
