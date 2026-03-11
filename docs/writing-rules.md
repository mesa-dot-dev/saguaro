# Writing Rules

Rules are the core of Saguaro. A rule is a markdown file in `.saguaro/rules/` that tells the AI reviewer what to check for. This guide covers how to create, generate, and manage rules effectively.

## Rule Format

Every rule is a `.md` file with YAML frontmatter and a markdown body:

````markdown
---
id: no-raw-sql-interpolation
title: No string interpolation in raw SQL queries
severity: error
globs:
  - "**/*.ts"
  - "!**/*.test.ts"
---

Raw SQL queries must use parameterized placeholders, never string
interpolation. Flag any call to `sql.raw()`, `sql.unsafe()`, or
`db.execute()` that uses template literals with injected runtime values.

### Why This Matters

- String interpolation in SQL enables SQL injection attacks
- Even "trusted" internal variables can contain unexpected characters
- Parameterized queries are handled by the database driver and are always safe

### Violations

```typescript
sql.raw(`SELECT * FROM repos WHERE org_id = '${orgId}'`)
db.execute(`UPDATE users SET name = '${name}'`)
```

### Compliant

```typescript
sql`SELECT * FROM repos WHERE org_id = ${orgId}`
db.select().from(repos).where(eq(repos.orgId, orgId))
```
````

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier, kebab-case (e.g., `no-raw-sql-interpolation`) |
| `title` | Yes | Short human-readable name |
| `severity` | Yes | `error` (exit 1), `warning` (logged, won't fail), or `info` |
| `globs` | No | File patterns. Default: all files. Use `!` prefix to exclude. Paths are relative to repo root. |

### Markdown Body

The body is the instructions the AI reviewer uses to evaluate the rule. It should include:

1. **What to check for** — Clear description of the pattern to flag
2. **Why it matters** — Context helps the AI make better judgment calls on edge cases
3. **`### Violations` section** — Code examples showing what should be flagged
4. **`### Compliant` section** — Code examples showing acceptable alternatives

The `### Violations` and `### Compliant` sections with fenced code blocks are parsed by Saguaro and provided to the AI as concrete examples.

## Getting Rules Into Your Repo

There are three ways, and you can mix them.

### 1. Auto-generate rules from your codebase

```bash
sag rules generate
```

This scans your entire codebase:
1. Discovers source files and partitions them into zones (packages, directories)
2. Builds an import graph to understand code relationships
3. Uses AI to identify patterns, conventions, architecture and invariants
4. Proposes rules you can accept, skip, or edit individually

This is the best starting point for an existing codebase. It discovers rules you might not think to write; things like "this directory always uses dependency injection" or "API handlers in this package never import the database layer directly."

Always double check the AI-generated rules, this is a Work In Progress feature. There will be some generated rules that can and should be discarded.

### 2. Create a rule with AI assistance

```bash
sag rules create
```

### 3. Write a rule by hand

Create a `.md` file in `.saguaro/rules/`:

```bash
touch .saguaro/rules/my-rule.md
```

Fill it in with the frontmatter and body. Run `sag rules validate` to check structure.

Use this when you have a very specific rule in mind and know exactly how to describe it.

## What Makes a Good Rule

### Be specific about what to flag

The AI reviewer uses your instructions to decide what counts as a violation. Vague instructions produce vague results.

**Bad:**
```markdown
Make sure the code is well-structured and follows best practices.
```

**Good:**
```markdown
Flag any React component that uses `useEffect` with an empty dependency
array to fetch data on mount. Use the router's `loader` function instead,
which runs on the server and provides data before the component renders.
```

### Scope with globs

Don't apply rules where they don't belong. A rule about React hooks shouldn't match Python files. A rule about production code shouldn't match test files.

```yaml
globs:
  - "packages/web/src/**/*.tsx"     # Only React components in the web package
  - "!**/*.test.tsx"                # Exclude tests
  - "!**/*.stories.tsx"             # Exclude Storybook stories
```

Globs are relative to the repo root, which matters in monorepos.

### Include violation and compliant examples

Examples are the most effective way to communicate what you want. The AI uses them as few-shot demonstrations.

````markdown
### Violations

```typescript
// Direct database import in a route handler
import { db } from '../db';

app.get('/users', async (c) => {
  const users = await db.select().from(usersTable);
  return c.json(users);
});
```

### Compliant

```typescript
// Database access goes through a service layer
import { UserService } from '../services/user';

app.get('/users', async (c) => {
  const users = await UserService.list();
  return c.json(users);
});
```
````

### Explain why the rule exists

"Why" context helps the AI handle edge cases intelligently. If the AI knows *why* `console.log` is banned (it leaks sensitive data in production), it can make reasonable decisions about edge cases like error boundaries or debug utilities.

### Choose the right severity

- **`error`** — This must be fixed. Causes `sag review` to exit 1. Use for security issues, correctness bugs, architectural violations.
- **`warning`** — Should be fixed but won't block CI. Use for code quality, style consistency, minor concerns.

## What Makes a Bad Rule

### Kitchen-sink rules

A single rule that tries to check 10 different things. Split it into focused rules instead.

**Bad:** "Check for security issues: no eval, no innerHTML, no hardcoded secrets, no SQL injection, no XSS..."

**Good:** One rule per concern — `no-eval`, `no-innerhtml`, `no-hardcoded-secrets`, `no-raw-sql-interpolation`.

### Rules that duplicate linters

If ESLint, Biome, or your type checker already catches it, don't add a Saguaro rule for it. Saguaro's value is in catching things that static analysis can't — patterns that require understanding intent, architecture, or cross-file context.

**Bad:** "Variables must use camelCase" (your linter handles this)

**Good:** "API route handlers must not import from the database layer directly" (requires understanding architecture)

### Overly broad globs

Matching every file in the repo when the rule only applies to a specific area creates false positives and wastes API tokens.

**Bad:**
```yaml
globs:
  - "**/*"
```

**Good:**
```yaml
globs:
  - "packages/api/src/routes/**/*.ts"
```

### Rules without examples

The AI performs better with concrete examples. Always include at least one violation and one compliant example.

## Managing Rules

```bash
# List all rules
sag rules list

# See full details for a rule
sag rules explain no-raw-sql-interpolation

# Check all rules for structural errors
sag rules validate

# Delete a rule
sag rules delete no-raw-sql-interpolation

# See which rules apply to specific files
sag rules for src/api/routes/users.ts

# Regenerate Claude Code skills from rules
sag rules sync
```

## Tips

### Start with `sag rules generate`, then edit

Auto-generation gives you a solid baseline. Review the generated rules, delete the ones that don't apply, and edit the ones that are close but not quite right.

### One rule per file

Easier to review in PRs, clearer ownership, simpler to enable/disable.

```
.saguaro/rules/
  no-console-log.md
  no-raw-sql-interpolation.md
  require-error-boundary.md
```

### Protect rules with CODEOWNERS

Rules define your team's standards. Protect them the same way you'd protect CI configuration.

```
# CODEOWNERS
.saguaro/ @platform-team @tech-leads
```

### Version control your rules

Rules are just files. They show up in diffs, go through code review, and have history. This is intentional — changing what your team enforces should be a deliberate, reviewable decision.

### Test your rules

After writing a rule, run `sag review` against a branch that you know contains violations. Verify it catches what you expect and doesn't flag things it shouldn't.

## Example Rules

Run `sag init` and choose "Use Saguaro starter rules" to get a set of battle-tested rules covering security (hardcoded credentials, SQL injection, timing attacks), correctness (division by zero, React hook deps), database safety (migration failures, cascade deletes), and more. These are a good starting point to read, edit, and learn the format from.
