<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: react-query-key-matches-inputs
title: React Query cache key must include all query inputs
severity: error
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

Flag React Query hooks where queryKey doesn't include all dynamic
values used in the queryFn. Missing inputs cause stale or cross-entity
cache.


### Violations

```
// 'status' affects query results but is missing from queryKey — stale cache
useQuery({ queryKey: ["orders", userId], queryFn: () => fetchOrders(userId, status) });

```
