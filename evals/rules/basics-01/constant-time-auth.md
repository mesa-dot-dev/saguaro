<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: constant-time-auth
title: Use constant-time operations in authentication
severity: error
globs:
  - "**/auth/**/*.ts"
---

Flag authentication code where response timing varies based on input.
Early returns for format checks or cache lookups create timing
side-channels that leak information about credential validity.


### Violations

```
// Early return leaks whether the token format is valid via response timing
if (!token.startsWith("sk_")) return unauthorized();
const record = await db.lookup(token);

```
