<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: react-hook-dependency-completeness
title: React hook dependency arrays must include all referenced values
severity: error
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

Flag React hooks (useMemo, useCallback, useEffect) where the
dependency array is missing values referenced in the callback. Missing
dependencies cause stale closures.


### Violations

```
// 'threshold' is referenced inside the callback but missing from deps
const filtered = useMemo(() => items.filter(i => i.score > threshold), [items]);

```
