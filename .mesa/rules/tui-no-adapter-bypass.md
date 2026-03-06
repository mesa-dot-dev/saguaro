<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: tui-no-adapter-bypass
title: TUI components must not import from layers below adapter
severity: error
globs:
  - src/tui/**/*.ts
  - src/tui/**/*.tsx
tags:
  - architecture
  - dependency-direction
  - tui
---

The `src/tui/` layer imports from `src/adapter/`, `src/core/`, `src/git/`, and `src/types/` only. It must never import directly from `src/ai/`, `src/config/`, `src/daemon/`, `src/generator/`, `src/indexer/`, `src/rules/`, `src/stats/`, or `src/mcp/`. These are internal implementation layers that the adapter wraps.

Flag any import in `src/tui/` that references these forbidden modules. TUI screens should call adapter functions to perform operations, not reach through to implementation details.

### Violations

```
import { loadValidatedConfig } from '../config/model-config.js';
```

```
import { generateRule } from '../rules/generator.js';
```

### Compliant

```
import { runReview } from '../adapter/review.js';
```

```
import type { ReviewEngineOutcome } from '../core/types.js';
```
