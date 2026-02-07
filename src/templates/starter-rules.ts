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

  'no-client-api-key-fallback.yaml': `# Rule: No Client API Key Fallback Literals

id: no-client-api-key-fallback
title: "Do not use literal API key fallbacks in client code"
severity: error

globs:
  - "packages/web/src/**/*.ts"
  - "packages/web/src/**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Frontend code must never include a hardcoded API key/token fallback value,
  including fallback literals attached to environment variables.

  Flag any client-side expression that does this pattern:
  - Reads import.meta.env.* (or process.env.*) and falls back to a literal
    secret/token/API-key string with ?? or ||
  - Sets auth headers from literal secrets in browser code

  This applies even if the fallback is marked as temporary or dev-only.

examples:
  violations:
    - "const k = import.meta.env.VITE_X ?? 'sk_live_abc'"
    - "'x-gateway-api-key': 'sk_live_abc'"
  compliant:
    - "const k = import.meta.env.VITE_X"
    - "if (!import.meta.env.VITE_X) throw new Error('missing key')"

tags:
  - security
  - frontend
  - secrets
`,

  'require-sanitized-auth-redirect.yaml': `# Rule: Redirect Targets Must Be Sanitized

id: require-sanitized-auth-redirect
title: "Auth redirects must sanitize dynamic target paths"
severity: error

globs:
  - "packages/web/src/**/*.ts"
  - "packages/web/src/**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Any redirect or navigation target derived from URL/query/user-controlled input
  must pass through the project's redirect sanitizer before being used.

  Flag code where dynamic values are interpolated directly into:
  - window.location.href = ...
  - router navigate({ to: ... })
  - redirect URL builders

  If a helper exists (for this repo: sanitizeRedirect / buildSignInRedirect),
  require that helper and reject ad-hoc string interpolation.

examples:
  violations:
    - "window.location.href = '/sign-in?redirect=' + userValue"
    - "navigate({ to: redirectParam })"
  compliant:
    - "window.location.href = buildSignInRedirect(currentRelativeUrl())"
    - "const safe = sanitizeRedirect(redirectParam)"

tags:
  - security
  - auth
  - redirects
`,

  'guard-percentage-division.yaml': `# Rule: Guard Denominator Before Percentage Division

id: guard-percentage-division
title: "Percentage calculations must guard denominator"
severity: error

globs:
  - "packages/web/src/**/*.ts"
  - "packages/web/src/**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Any percentage calculation that divides by a runtime value must explicitly
  guard denominator zero/invalid cases.

  Flag helpers or inline math like (part / total) * 100 when no local guard
  exists ensuring total > 0 (or equivalent finite check).

  This includes shared utility functions and call sites that can pass
  0, null, undefined, or non-finite denominators.

examples:
  violations:
    - "return Math.round((partial / total) * 100)"
    - "const pct = toPercent(commit.aiLines, commit.added)"
  compliant:
    - "if (total <= 0) return 0"
    - "const pct = total > 0 ? Math.round((partial / total) * 100) : 0"

tags:
  - correctness
  - math
  - analytics
`,

  'react-query-key-matches-inputs.yaml': `# Rule: React Query Key Must Include Query Inputs

id: react-query-key-matches-inputs
title: "useQuery key must include all dynamic query inputs"
severity: error

globs:
  - "packages/web/src/**/*.ts"
  - "packages/web/src/**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  For useQuery, every dynamic input used by queryFn must be represented
  in queryKey to avoid stale or cross-context cache results.

  Flag hooks where queryFn uses values (for example org slug, route params,
  period, filters, repo name) that are missing from queryKey.

  Prioritize auth/org scoped data where omitted keys can leak data between
  organizations or routes.

examples:
  violations:
    - "queryKey: ['org']"
    - "queryFn: () => coreAuthRequest(... orgSlug ...)"
    - "queryKey: ['repo', name]"
  compliant:
    - "queryKey: ['org', orgSlug]"
    - "queryKey: ['repo', org?.slug, name]"

tags:
  - react-query
  - caching
  - correctness
`,
};
