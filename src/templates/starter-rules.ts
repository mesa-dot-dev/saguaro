// Starter rules bundled with Mesa CLI
// These are copied to .mesa/rules/ during `mesa init`

export const STARTER_RULES: Record<string, string> = {
  'no-console-log.yaml': `# Rule: No Console.log in Production Code

id: no-console-log
title: "No console.log in production code"
severity: warning

globs:
  - "**/src/**/*.ts"
  - "**/src/**/*.tsx"
  - "!**/*.test.ts"
  - "!**/*.test.tsx"
  - "!**/*.spec.ts"
  - "!**/*.spec.tsx"

instructions: |
  console.log, console.warn, and console.debug statements should not 
  appear in production code. Use a proper logging library instead.
  
  ## Why This Matters
  
  - Console statements are not structured (can't query/filter)
  - No log levels in production
  - May leak sensitive information
  - Can't be sent to logging services
  - Pollutes browser console in frontend apps
  
  ## Exceptions
  
  - Test files (excluded via globs)
  - console.error in error boundaries (acceptable)
  - Explicit debug utilities that check environment

examples:
  violations:
    - "console.log("
    - "console.warn("
    - "console.debug("
    - "console.info("
  compliant:
    - "logger.info("
    - "logger.warn("
    - "logger.error("
    - "logger.debug("

tags:
  - typescript
  - logging
  - production
`,

  'no-hardcoded-secrets.yaml': `# Rule: No Hardcoded Secrets

id: no-hardcoded-secrets
title: "No hardcoded secrets or credentials"
severity: error

globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.py"
  - "**/*.rs"
  - "**/*.go"
  - "!**/*.test.*"
  - "!**/*.spec.*"
  - "!**/test/**"
  - "!**/tests/**"
  - "!**/__tests__/**"

instructions: |
  Never hardcode secrets, API keys, passwords, or other credentials 
  in source code. Use environment variables or secret management 
  systems instead.
  
  ## What Counts as a Secret
  
  - API keys (sk-*, pk-*, api_*, etc.)
  - Database passwords
  - JWT secrets
  - OAuth client secrets
  - Encryption keys
  - Service account credentials
  - Webhook secrets
  - Any token used for authentication
  
  ## Why This Matters
  
  Hardcoded secrets:
  - End up in git history forever
  - Get leaked in logs, error messages
  - Can't be rotated without code changes
  - May be exposed in client bundles
  - Violate security compliance (SOC2, etc.)

examples:
  violations:
    - 'sk_live_'
    - 'sk_test_'
    - 'apiKey: "'
    - 'secret: "'
    - 'password: "'
    - 'token: "'
  compliant:
    - "process.env."
    - "env.get("
    - "secretsManager"
    - "vault.read("

tags:
  - security
  - secrets
  - compliance
`,
};
