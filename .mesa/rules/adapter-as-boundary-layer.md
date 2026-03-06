<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: adapter-as-boundary-layer
title: CLI and MCP handlers must go through adapter layer
severity: warning
globs:
  - src/cli/**/*.ts
  - src/cli/**/*.tsx
  - src/mcp/**/*.ts
tags:
  - architecture
  - dependency-direction
  - adapter
---

The `src/adapter/` directory serves as the primary API surface for CLI and TUI consumers. CLI command handlers in `src/cli/` and MCP tool handlers in `src/mcp/` should call adapter functions rather than reaching directly into implementation layers like `src/ai/`, `src/daemon/`, or `src/indexer/`.

Common adapter entry points:
- `runReview` from `src/adapter/review.ts`
- `createRuleAdapter`, `listRulesAdapter`, `generateRuleAdapter` from `src/adapter/rules.ts`
- `runInstallHook`, `runUninstallHook` from `src/adapter/hook.ts`
- `buildIndex` from `src/adapter/index-build.ts`

Exceptions:
- `src/cli/` may import `loadValidatedConfig` from `src/config/` for config resolution
- `src/cli/` may import from `src/git/` for branch detection
- `src/mcp/server.ts` may import from `src/config/` for server setup

### Violations

```
// in src/cli/lib/review.ts
import { runSdkReview } from '../../ai/sdk-reviewer.js';
```

```
// in src/mcp/tools/handler.ts
import { buildIndex } from '../../indexer/build.js';
```

### Compliant

```
// in src/cli/lib/review.ts
import { runReview } from '../../adapter/review.js';
```

```
// in src/mcp/tools/handler.ts
import { buildIndexAdapter } from '../../adapter/index-build.js';
```
