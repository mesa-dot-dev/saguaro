<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: git-ref-validation
title: Git refs must be validated before use in shell commands
severity: error
globs:
  - src/git/**/*.ts
  - src/daemon/**/*.ts
  - src/ai/**/*.ts
  - src/cli/**/*.ts
tags:
  - security
  - injection
  - git
---

Any function that passes a user-supplied git ref (branch name, commit hash) to `execFileSync` or `spawn` with git commands must validate the ref using `assertValidGitRef()` (or the `VALID_GIT_REF` regex pattern `/^[a-zA-Z0-9][a-zA-Z0-9/_\.\-^~]*$/`) before use.

The `assertValidGitRef` function is defined in `src/git/git.ts`. Functions like `listChangedFilesFromGit`, `getDiffs`, and `getFileAtRef` already follow this pattern. Any new function that accepts ref parameters and passes them to git subprocesses must do the same.

Also flag `getFileAtRef`-style functions that accept file paths without checking for path traversal (`..` or absolute paths starting with `/`).

### Violations

```
execFileSync('git', ['show', `${ref}:${filePath}`]);
```

```
execFileSync('git', ['diff', userRef]);
```

### Compliant

```
assertValidGitRef(ref, 'base branch');
execFileSync('git', ['diff', ref]);
```

```
if (filePath.startsWith('/') || filePath.includes('..')) return null;
```
