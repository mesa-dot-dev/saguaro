<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: tree-sitter-parser-cleanup
title: Tree-sitter parsers must be deleted after use
severity: warning
globs:
  - src/indexer/**/*.ts
tags:
  - memory
  - wasm
  - cleanup
---

The `createParser` function in `src/indexer/parsers/tree-sitter/init.ts` creates WASM-backed parser instances that allocate native memory. The JSDoc explicitly states: "Caller is responsible for cleanup (parser.delete())". Every call to `createParser()` must have a corresponding `parser.delete()` call, ideally in a `finally` block.

Flag:
- `createParser(lang)` calls where the result is not eventually `.delete()`d
- Missing `finally` blocks around parser usage that could leak on exceptions

### Violations

```
const parser = await createParser('python');
const tree = parser.parse(source);
// no parser.delete()
```

### Compliant

```
const parser = await createParser('python');
try {
  const tree = parser.parse(source);
} finally {
  parser.delete();
}
```
