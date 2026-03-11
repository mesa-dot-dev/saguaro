<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: maxbuffer-for-git-diff
title: Git diff commands must set maxBuffer to avoid silent truncation
severity: error
globs:
  - src/git/**/*.ts
  - src/daemon/**/*.ts
tags:
  - correctness
  - git
  - buffer
---

When calling `execFileSync` with `git diff` or any git command that may produce large output, the `maxBuffer` option must be set explicitly. Node.js defaults to 1MB which can silently truncate large diffs.

The existing `getDiffs`, `getLocalDiffs`, and `getDiffsForFiles` functions in `src/git/git.ts` all set `maxBuffer: 10 * 1024 * 1024`. New functions that read diff output or any potentially large git output must follow the same pattern.

Flag `execFileSync('git', ['diff', ...], ...)` calls where `maxBuffer` is not specified in the options object.

### Violations

```
execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8' });
```

### Compliant

```
execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
```
