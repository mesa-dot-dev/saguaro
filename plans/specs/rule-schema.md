# Rule Schema Specification

**Version:** 1.0  
**Status:** Draft

---

## Overview

Rules are the core of the Mesa local review agent. This document specifies the schema for rule definition files.

---

## File Location

Rules are stored in `.mesa/rules/` at the repository root:

```
.mesa/
+-- config.yaml          # Global configuration
+-- rules/
    +-- <rule-name>.yaml # One file per rule (recommended)
    +-- <category>.yaml  # Or multiple rules per file
```

---

## Rule Schema

### YAML Format

```yaml
# Required fields
id: string           # Unique identifier (kebab-case)
title: string        # Human-readable title (< 100 chars)
severity: string     # "error" | "warning" | "info"
instructions: string # Natural language instructions for the AI

# Optional fields
globs: string[]      # File patterns to match (default: ["**/*"])
examples:            # Concrete examples to guide the AI
  violations: string[]
  compliant: string[]
tags: string[]       # For organization/filtering
enabled: boolean     # Default: true
```

### Field Definitions

#### `id` (required)
- Unique identifier for the rule
- Must be kebab-case (lowercase with hyphens)
- Used to cite violations
- Examples: `no-wall-clock`, `require-error-boundary`, `ban-console-log`

#### `title` (required)
- Human-readable name
- Should be concise (< 100 characters)
- Displayed in violation output
- Examples: "Ban direct wall clock access", "Require error boundaries"

#### `severity` (required)
- Determines exit code behavior
- Values:
  - `error` - Causes exit code 1
  - `warning` - Logged but doesn't fail
  - `info` - Informational only

#### `instructions` (required)
- Natural language instructions for the AI reviewer
- Should include:
  - What to look for
  - Why it matters
  - Good and bad examples (inline)
  - Edge cases to consider
- Supports multi-line YAML strings

#### `globs` (optional)
- Array of glob patterns
- Rules only applied to matching files
- Supports negation with `!` prefix
- Default: `["**/*"]` (all files)
- Examples:
  ```yaml
  globs:
    - "**/*.rs"           # All Rust files
    - "!**/tests/**"      # Exclude tests
    - "src/api/**/*.ts"   # Specific directory
  ```

#### `examples` (optional)
- Concrete code examples
- Helps AI understand pattern matching
- Structure:
  ```yaml
  examples:
    violations:
      - "Utc::now()"
      - "SystemTime::now()"
    compliant:
      - "clock.now()"
      - "self.clock.utc_now()"
  ```

#### `tags` (optional)
- Array of strings for categorization
- Useful for filtering rules
- Examples: `["security", "rust", "performance"]`

#### `enabled` (optional)
- Boolean to enable/disable rule
- Default: `true`
- Useful for temporarily disabling without deleting

---

## JSON Schema

For validation tooling, here's the JSON Schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Mesa Rule",
  "type": "object",
  "required": ["id", "title", "severity", "instructions"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]*$",
      "description": "Unique rule identifier (kebab-case)"
    },
    "title": {
      "type": "string",
      "maxLength": 100,
      "description": "Human-readable rule title"
    },
    "severity": {
      "type": "string",
      "enum": ["error", "warning", "info"],
      "description": "Rule severity level"
    },
    "instructions": {
      "type": "string",
      "minLength": 10,
      "description": "Natural language instructions for the AI"
    },
    "globs": {
      "type": "array",
      "items": { "type": "string" },
      "default": ["**/*"],
      "description": "File patterns to match"
    },
    "examples": {
      "type": "object",
      "properties": {
        "violations": {
          "type": "array",
          "items": { "type": "string" }
        },
        "compliant": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    },
    "enabled": {
      "type": "boolean",
      "default": true
    }
  }
}
```

---

## TypeScript Types

```typescript
type RuleSeverity = 'error' | 'warning' | 'info';

interface RuleExamples {
  violations?: string[];
  compliant?: string[];
}

interface Rule {
  // Required
  id: string;
  title: string;
  severity: RuleSeverity;
  instructions: string;
  
  // Optional
  globs?: string[];
  examples?: RuleExamples;
  tags?: string[];
  enabled?: boolean;
}

// Validated rule with defaults applied
interface ResolvedRule extends Rule {
  globs: string[];      // Default: ["**/*"]
  enabled: boolean;     // Default: true
}
```

---

## Example Rules

### Rust: Ban Wall Clock Access

```yaml
id: no-wall-clock
title: "Ban direct wall clock access"
severity: error

globs:
  - "**/*.rs"
  - "!**/tests/**"
  - "!**/benches/**"

instructions: |
  Utc::now() or any analogous "get wall clock time" function should be 
  banned from Rust services. Use a Clock trait instead. Always dependency 
  inject time.
  
  This enables:
  - Deterministic testing
  - Time travel in tests
  - Consistent behavior across environments
  
  VIOLATION:
    fn process() {
        let now = Utc::now();  // Direct wall clock access
    }
  
  CORRECT:
    fn process(clock: &dyn Clock) {
        let now = clock.now();  // Injected dependency
    }

examples:
  violations:
    - "Utc::now()"
    - "SystemTime::now()"
    - "Instant::now()"
    - "chrono::Local::now()"
  compliant:
    - "clock.now()"
    - "self.clock.utc_now()"
    - "time_provider.current_time()"

tags:
  - rust
  - testing
  - architecture
```

### Rust: Service Spawn Pattern

```yaml
id: service-spawn-pattern
title: "Web services must use spawn pattern"
severity: error

globs:
  - "**/lib.rs"
  - "**/main.rs"

instructions: |
  Every Rust web service MUST be exposed as lib.rs with a single 
  spawn_thing(...all_dependencies, cancellation_token) function that 
  spawns the service into tokio.
  
  This pattern ensures:
  - All dependencies are explicit
  - Graceful shutdown via cancellation token
  - Easy testing and composition
  
  REQUIRED SIGNATURE:
    pub async fn spawn_api_server(
        db: Pool<Postgres>,
        config: Config,
        cancellation_token: CancellationToken,
    ) -> JoinHandle<Result<()>>

examples:
  compliant:
    - "pub async fn spawn_"
    - "cancellation_token: CancellationToken"

tags:
  - rust
  - architecture
  - services
```

### TypeScript: No Console in Production

```yaml
id: no-console-log
title: "No console.log in production code"
severity: warning

globs:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "!src/**/*.test.ts"
  - "!src/**/*.spec.ts"

instructions: |
  console.log statements should not appear in production code. 
  Use a proper logging library instead.
  
  Exceptions:
  - Test files (excluded via globs)
  - Explicit debug utilities
  - Error boundaries (console.error acceptable)
  
  VIOLATION:
    console.log("User logged in:", userId);
  
  CORRECT:
    logger.info("User logged in", { userId });

examples:
  violations:
    - "console.log("
    - "console.warn("
    - "console.debug("
  compliant:
    - "logger.info("
    - "logger.warn("
    - "logger.error("

tags:
  - typescript
  - logging
  - production
```

---

## Multiple Rules Per File

You can define multiple rules in a single file using YAML document separators:

```yaml
# .mesa/rules/security.yaml

id: no-eval
title: "No eval() usage"
severity: error
globs: ["**/*.ts", "**/*.js"]
instructions: |
  Never use eval() or Function() constructor with dynamic strings.
  This is a security vulnerability.

---

id: no-innerhtml
title: "No innerHTML assignment"
severity: error
globs: ["**/*.tsx", "**/*.jsx"]
instructions: |
  Never assign to innerHTML directly. Use proper React patterns
  or sanitization libraries.
```

---

## Glob Pattern Reference

| Pattern | Matches |
|---------|---------|
| `*` | Any file in current directory |
| `**` | Any file in any subdirectory |
| `*.ts` | All .ts files in current directory |
| `**/*.ts` | All .ts files anywhere |
| `src/**` | Everything under src/ |
| `!**/tests/**` | Exclude tests directory |
| `{src,lib}/**/*.ts` | .ts files in src/ or lib/ |

---

## Best Practices

### 1. One Rule Per File (Recommended)

Easier to review changes, clearer ownership:
```
.mesa/rules/
+-- no-wall-clock.yaml
+-- service-spawn-pattern.yaml
+-- no-console-log.yaml
```

### 2. Use CODEOWNERS

Protect rules with code review:
```
# CODEOWNERS
.mesa/ @senior-engineers @platform-team
```

### 3. Write Clear Instructions

The AI only knows what you tell it:
- Explain WHY the rule exists
- Provide concrete GOOD and BAD examples
- Mention edge cases and exceptions

### 4. Use Appropriate Severity

- `error` - Must be fixed before merge
- `warning` - Should be fixed, won't block
- `info` - Nice to know, no action required

### 5. Scope with Globs

Don't apply rules where they don't belong:
```yaml
globs:
  - "**/*.rs"
  - "!**/tests/**"      # Tests can break rules
  - "!**/examples/**"   # Examples might demonstrate anti-patterns
```

---

## Validation

Rules are validated at load time. Invalid rules cause exit code 2.

Common validation errors:
- Missing required fields
- Invalid severity value
- Invalid glob pattern syntax
- Duplicate rule IDs
