<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: no-security-todos
title: No TODO comments indicating disabled security
severity: error
globs:
  - "**/*.ts"
---

Flag TODO or FIXME comments indicating security features are
intentionally disabled or deferred.


### Violations

```
// TODO comment indicates a security feature is intentionally disabled
// TODO: re-enable rate limiting after load test
const rateLimitEnabled = false;

```
