<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: saguaro-error-subclass-usage
title: Use SaguaroError subclasses for domain-specific errors
severity: warning
globs:
  - src/adapter/**/*.ts
  - src/cli/**/*.ts
  - src/config/**/*.ts
  - src/rules/**/*.ts
  - src/ai/**/*.ts
  - src/daemon/**/*.ts
  - src/git/**/*.ts
  - "!src/**/__tests__/**"
  - "!src/**/*.test.ts"
tags:
  - error-handling
  - consistency
---

The codebase defines specific error subclasses in `src/util/errors.ts`: `ConfigInvalidError`, `ConfigMissingError`, `ApiKeyMissingError`, `GitNotFoundError`, `GitDiffTooLargeError`, `AgentExecutionError`. When throwing errors for these known conditions, use the appropriate subclass rather than a bare `Error` or generic `SaguaroError`.

Each subclass provides a standardized `code`, `suggestion`, and `exitCode`. Throwing `new Error(...)` for config-missing or API-key-missing scenarios loses this structured information.

Exceptions — do NOT flag:
- Exhaustive-check throws in `default` branches (e.g., `const _exhaustive: never = x; throw new Error(...)`) — these are compile-time assertions, not domain errors
- `throw new Error(...)` for genuinely unexpected/unreachable states that don't map to any subclass
- Errors thrown inside test files

Flag:
- `throw new Error(...)` where the message content clearly maps to an existing SaguaroError subclass (e.g., mentions "config not found", "API key", "not a git repo", "unsupported provider")
- `throw new SaguaroError('CONFIG_MISSING', ...)` when `ConfigMissingError` exists as a dedicated subclass

### Violations

```
throw new Error('No Saguaro config found');
```

```
throw new SaguaroError('CONFIG_MISSING', 'No config');
```

### Compliant

```
throw new ConfigMissingError();
```

```
throw new ApiKeyMissingError(provider);
```
