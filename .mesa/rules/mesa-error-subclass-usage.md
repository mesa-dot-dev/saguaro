<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: mesa-error-subclass-usage
title: Use MesaError subclasses for domain-specific errors
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

The codebase defines specific error subclasses in `src/util/errors.ts`: `ConfigInvalidError`, `ConfigMissingError`, `ApiKeyMissingError`, `GitNotFoundError`, `GitDiffTooLargeError`, `AgentExecutionError`. When throwing errors for these known conditions, use the appropriate subclass rather than a bare `Error` or generic `MesaError`.

Each subclass provides a standardized `code`, `suggestion`, and `exitCode`. Throwing `new Error(...)` for config-missing or API-key-missing scenarios loses this structured information.

Exceptions — do NOT flag:
- Exhaustive-check throws in `default` branches (e.g., `const _exhaustive: never = x; throw new Error(...)`) — these are compile-time assertions, not domain errors
- `throw new Error(...)` for genuinely unexpected/unreachable states that don't map to any subclass
- Errors thrown inside test files

Flag:
- `throw new Error(...)` where the message content clearly maps to an existing MesaError subclass (e.g., mentions "config not found", "API key", "not a git repo", "unsupported provider")
- `throw new MesaError('CONFIG_MISSING', ...)` when `ConfigMissingError` exists as a dedicated subclass

### Violations

```
throw new Error('No Mesa config found');
```

```
throw new MesaError('CONFIG_MISSING', 'No config');
```

### Compliant

```
throw new ConfigMissingError();
```

```
throw new ApiKeyMissingError(provider);
```
