<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: execfilesync-over-execsync
title: Use execFileSync/spawn instead of execSync for shell commands
severity: error
globs:
  - src/**/*.ts
  - src/**/*.tsx
  - "!src/**/__tests__/**"
tags:
  - security
  - injection
  - subprocess
---

The codebase exclusively uses `execFileSync` and `spawn` (array-based argument passing) for invoking external commands, never `execSync` (string-based shell execution). This prevents shell injection vulnerabilities.

Flag:
- Any import or usage of `execSync` from `node:child_process`
- Any usage of `exec` (callback-based string shell execution)
- Passing `{ shell: true }` to `execFileSync` or `spawn`

All git commands in `src/git/git.ts` follow the `execFileSync('git', ['arg1', 'arg2'])` pattern. New subprocess calls must follow the same pattern.

### Violations

```
import { execSync } from 'node:child_process';
```

```
execSync(`git diff ${baseRef}`);
```

```
spawn('git', ['diff'], { shell: true });
```

### Compliant

```
import { execFileSync } from 'node:child_process';
```

```
execFileSync('git', ['diff', baseRef], { encoding: 'utf8' });
```
