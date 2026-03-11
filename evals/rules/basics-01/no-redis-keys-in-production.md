<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: no-redis-keys-in-production
title: Do not use Redis KEYS command in production code
severity: error
globs:
  - "**/*.ts"
---

Flag usage of the Redis KEYS command. KEYS blocks the server while
scanning the entire keyspace. Use SCAN instead.


### Violations

```
// KEYS scans the entire keyspace in O(N), blocking the Redis server
const matches = await redis.keys("session:*");

```
