<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: no-hardcoded-credentials
title: No hardcoded credentials
severity: error
globs:
  - "**/*.ts"
---

Flag hardcoded passwords, API keys, tokens, or connection strings in
source code. Credentials must come from environment variables or secret
management.


### Violations

```
// Credentials must not appear in source code
const apiToken = "sk-live-abc123def456";

```
