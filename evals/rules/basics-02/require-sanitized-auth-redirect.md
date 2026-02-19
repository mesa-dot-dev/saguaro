<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: require-sanitized-auth-redirect
title: Require sanitized auth redirect URLs
severity: error
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

Flag auth redirects using unsanitized URLs from query parameters or
user input. Open redirects enable phishing.


### Violations

```
// Redirect URL from query param can be manipulated for phishing
const next = searchParams.get("redirect");
window.location.href = next;

```
