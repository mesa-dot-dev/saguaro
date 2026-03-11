<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: yaml-quote-special-chars
title: YAML serialization of LLM output must quote special characters
severity: error
globs:
  - src/rules/**/*.ts
  - src/generator/**/*.ts
  - src/adapter/**/*.ts
  - "!src/**/*.test.ts"
tags:
  - correctness
  - yaml
  - llm
---

When serializing LLM-generated content to YAML (rule files, config), values containing YAML-special characters (`!`, `{`, `}`, `[`, `]`, `#`) must be quoted. Unquoted `!` is parsed as a YAML tag, `{}` and `[]` as flow mappings/sequences, and `#` as a comment.

This caused multiple production bugs: glob negation patterns like `!**/*.test.*` broke YAML parsing, and LLM-generated code snippets containing `!!` (JavaScript double-negation) or object literals `{}` caused silent parse failures.

The codebase uses `quoteYamlTagValues()` in `src/rules/saguaro-rules.ts` and `src/rules/generator.ts` to handle this. Any new code path that writes LLM-generated strings into YAML must apply the same quoting, or use `js-yaml` dump with `quotingType: '"'`.

### Violations

```
const yamlContent = `globs:\n  - ${glob}\n`;
// glob could be "!**/*.test.ts" which breaks YAML parsing
```

```
yaml.dump({ examples: { violations: rawLlmSnippets } });
// snippets may contain !{} chars
```

### Compliant

```
const sanitized = quoteYamlTagValues(rawYaml);
yaml.load(sanitized, { schema: yaml.DEFAULT_SCHEMA });
```

```
yaml.dump(obj, { quotingType: '"', forceQuotes: false, lineWidth: -1 });
```
