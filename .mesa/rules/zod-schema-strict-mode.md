<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->
---
id: zod-schema-strict-mode
title: Zod schemas for external input must use .strict()
severity: warning
globs:
  - src/config/**/*.ts
  - src/rules/**/*.ts
  - src/generator/**/*.ts
  - src/daemon/**/*.ts
tags:
  - validation
  - zod
  - config
---

Zod schemas that validate **external or untrusted input** (YAML config files, rule frontmatter, LLM-generated output) must use `.strict()` to reject unknown keys. This catches typos in config keys and ensures LLM output conforms exactly to the expected shape.

The codebase already follows this pattern: `MesaConfigSchema` uses `.strict()`, `RuleFrontmatterSchema` uses `.strict()`, and `RulePolicySchema` uses `.strict()`. New schemas for parsing config, rule files, or LLM responses should do the same.

Exceptions — do NOT flag:
- Schemas used only for internal type validation or function parameter shapes
- Schemas composed into other schemas via `.merge()` or `.extend()` where the parent already uses `.strict()`

Flag any new `z.object({...})` schema in these directories that parses external data (config YAML, rule frontmatter, LLM structured output) but doesn't chain `.strict()`.

### Violations

```
const ConfigSchema = z.object({ model: z.string() });
```

### Compliant

```
const ConfigSchema = z.object({ model: z.string() }).strict();
```
