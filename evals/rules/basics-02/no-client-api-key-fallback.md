<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: no-client-api-key-fallback
title: No client-side API key fallback
severity: error
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

Flag API keys with hardcoded fallback values in client-side code.
Fallback values get bundled and exposed in the client.


### Violations

```
// Hardcoded fallback gets bundled into client code and exposed to users
const key = process.env.NEXT_PUBLIC_API_KEY || "pk_default_abc123";

```
