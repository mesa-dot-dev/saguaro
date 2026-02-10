// Starter rules bundled with Mesa CLI
// These are copied to .mesa/rules/ during `mesa init`

export const STARTER_RULES: Record<string, string> = {
  'no-console-log.yaml': `# Rule: No Console.log in Production Code

id: no-console-log
title: "No console.log in production code"
severity: warning

globs:
  - "**/src/**/*.ts"
  - "**/src/**/*.tsx"
  - "!**/*.test.ts"
  - "!**/*.test.tsx"
  - "!**/*.spec.ts"
  - "!**/*.spec.tsx"

instructions: |
  console.log, console.warn, and console.debug statements should not 
  appear in production code. Use a proper logging library instead.
  
  ## Why This Matters
  
  - Console statements are not structured (can't query/filter)
  - No log levels in production
  - May leak sensitive information
  - Can't be sent to logging services
  - Pollutes browser console in frontend apps
  
  ## Exceptions
  
  - Test files (excluded via globs)
  - console.error in error boundaries (acceptable)
  - Explicit debug utilities that check environment

examples:
  violations:
    - "console.log("
    - "console.warn("
    - "console.debug("
    - "console.info("
  compliant:
    - "logger.info("
    - "logger.warn("
    - "logger.error("
    - "logger.debug("

tags:
  - typescript
  - logging
  - production
`,

  'no-hardcoded-secrets.yaml': `# Rule: No Hardcoded Secrets

id: no-hardcoded-secrets
title: "No hardcoded secrets or credentials"
severity: error

globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.py"
  - "**/*.rs"
  - "**/*.go"
  - "!**/*.test.*"
  - "!**/*.spec.*"
  - "!**/test/**"
  - "!**/tests/**"
  - "!**/__tests__/**"

instructions: |
  Never hardcode secrets, API keys, passwords, or other credentials 
  in source code. Use environment variables or secret management 
  systems instead.
  
  ## What Counts as a Secret
  
  - API keys (sk-*, pk-*, api_*, etc.)
  - Database passwords
  - JWT secrets
  - OAuth client secrets
  - Encryption keys
  - Service account credentials
  - Webhook secrets
  - Any token used for authentication
  
  ## Why This Matters
  
  Hardcoded secrets:
  - End up in git history forever
  - Get leaked in logs, error messages
  - Can't be rotated without code changes
  - May be exposed in client bundles
  - Violate security compliance (SOC2, etc.)

examples:
  violations:
    - 'sk_live_'
    - 'sk_test_'
    - 'apiKey: "'
    - 'secret: "'
    - 'password: "'
    - 'token: "'
  compliant:
    - "process.env."
    - "env.get("
    - "secretsManager"
    - "vault.read("

tags:
  - security
  - secrets
  - compliance
`,

  'no-client-api-key-fallback.yaml': `# Rule: No Client API Key Fallback Literals

id: no-client-api-key-fallback
title: "Do not use literal API key fallbacks in client code"
severity: error

globs:
  - "packages/web/src/**/*.ts"
  - "packages/web/src/**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Frontend code must never include a hardcoded API key/token fallback value,
  including fallback literals attached to environment variables.

  Flag any client-side expression that does this pattern:
  - Reads import.meta.env.* (or process.env.*) and falls back to a literal
    secret/token/API-key string with ?? or ||
  - Sets auth headers from literal secrets in browser code

  This applies even if the fallback is marked as temporary or dev-only.

examples:
  violations:
    - "const k = import.meta.env.VITE_X ?? 'sk_live_abc'"
    - "'x-gateway-api-key': 'sk_live_abc'"
  compliant:
    - "const k = import.meta.env.VITE_X"
    - "if (!import.meta.env.VITE_X) throw new Error('missing key')"

tags:
  - security
  - frontend
  - secrets
`,

  'require-sanitized-auth-redirect.yaml': `# Rule: Redirect Targets Must Be Sanitized

id: require-sanitized-auth-redirect
title: "Auth redirects must sanitize dynamic target paths"
severity: error

globs:
  - "packages/web/src/**/*.ts"
  - "packages/web/src/**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Any redirect or navigation target derived from URL/query/user-controlled input
  must pass through the project's redirect sanitizer before being used.

  Flag code where dynamic values are interpolated directly into:
  - window.location.href = ...
  - router navigate({ to: ... })
  - redirect URL builders

  If a helper exists (for this repo: sanitizeRedirect / buildSignInRedirect),
  require that helper and reject ad-hoc string interpolation.

examples:
  violations:
    - "window.location.href = '/sign-in?redirect=' + userValue"
    - "navigate({ to: redirectParam })"
  compliant:
    - "window.location.href = buildSignInRedirect(currentRelativeUrl())"
    - "const safe = sanitizeRedirect(redirectParam)"

tags:
  - security
  - auth
  - redirects
`,

  'guard-percentage-division.yaml': `# Rule: Guard Denominator Before Percentage Division

id: guard-percentage-division
title: "Percentage calculations must guard denominator"
severity: error

globs:
  - "packages/web/src/**/*.ts"
  - "packages/web/src/**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Any percentage calculation that divides by a runtime value must explicitly
  guard denominator zero/invalid cases.

  Flag helpers or inline math like (part / total) * 100 when no local guard
  exists ensuring total > 0 (or equivalent finite check).

  This includes shared utility functions and call sites that can pass
  0, null, undefined, or non-finite denominators.

examples:
  violations:
    - "return Math.round((partial / total) * 100)"
    - "const pct = toPercent(commit.aiLines, commit.added)"
  compliant:
    - "if (total <= 0) return 0"
    - "const pct = total > 0 ? Math.round((partial / total) * 100) : 0"

tags:
  - correctness
  - math
  - analytics
`,

  'react-query-key-matches-inputs.yaml': `# Rule: React Query Key Must Include Query Inputs

id: react-query-key-matches-inputs
title: "useQuery key must include all dynamic query inputs"
severity: error

globs:
  - "packages/web/src/**/*.ts"
  - "packages/web/src/**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  For useQuery, every dynamic input used by queryFn must be represented
  in queryKey to avoid stale or cross-context cache results.

  Flag hooks where queryFn uses values (for example org slug, route params,
  period, filters, repo name) that are missing from queryKey.

  Prioritize auth/org scoped data where omitted keys can leak data between
  organizations or routes.

examples:
  violations:
    - "queryKey: ['org']"
    - "queryFn: () => coreAuthRequest(... orgSlug ...)"
    - "queryKey: ['repo', name]"
  compliant:
    - "queryKey: ['org', orgSlug]"
    - "queryKey: ['repo', org?.slug, name]"

tags:
  - react-query
  - caching
  - correctness
`,

  // =========================================================================
  // Eval rules: core-db-refactor-perf scenario
  // =========================================================================

  'no-hardcoded-credentials.yaml': `id: no-hardcoded-credentials
title: "No hardcoded database credentials"
severity: error

globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "!**/*.test.*"
  - "!**/*.spec.*"
  - "!**/test/**"
  - "!**/tests/**"

instructions: |
  Database connection strings and credentials must never be hardcoded in source code.
  Flag any string literal that matches a database connection URI pattern containing
  embedded usernames or passwords.

  ## What to Look For

  - Connection URIs with credentials: \\\`postgresql://user:pass@host\\\`, \\\`mysql://user:pass@host\\\`, \\\`mongodb://user:pass@host\\\`
  - Hardcoded passwords in connection config objects (e.g., \\\`password: 'mypassword'\\\`)
  - Default/fallback connection strings that contain credentials, even behind \\\`??\\\` or \\\`||\\\`
  - Comments containing connection strings with real credentials

  ## Why This Matters

  - Credentials in source code end up in git history permanently
  - Fallback connection strings with real credentials can accidentally connect to production
  - Secrets in code cannot be rotated without redeployment

  ## Exceptions

  - Environment variable references (\\\`process.env.DATABASE_URL\\\`) are fine
  - Placeholder strings in documentation or comments like \\\`postgresql://user:password@localhost\\\` in README files
  - Test files (excluded via globs)

examples:
  violations:
    - "postgresql://admin:secret@prod-db:5432/mydb"
    - "password: 'r3f4ct0r_2024'"
    - "const url = process.env.DB_URL ?? 'postgres://root:pass@host/db'"
  compliant:
    - "process.env.DATABASE_URL"
    - "Resource.DepotDB.password"
    - "config.get('database.password')"

tags:
  - security
  - credentials
  - database
`,

  'no-console-in-production.yaml': `id: no-console-in-production
title: "No console statements in production code"
severity: warning

globs:
  - "**/src/**/*.ts"
  - "**/src/**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Production code must use structured logging instead of console statements.
  Flag any \\\`console.log\\\`, \\\`console.warn\\\`, \\\`console.debug\\\`, or \\\`console.info\\\` calls.

  ## Why This Matters

  - Console output is unstructured and cannot be queried or filtered in log aggregation
  - Console statements may inadvertently log sensitive data (query parameters, user info, tokens)
  - No log level control in production environments

  ## Exceptions

  - \\\`console.error\\\` in top-level error boundaries is acceptable
  - Test files (excluded via globs)
  - CLI entry points that intentionally write to stdout

examples:
  violations:
    - "console.log("
    - "console.warn("
    - "console.debug("
    - "console.info("
  compliant:
    - "log.info("
    - "log.warn("
    - "log.error("
    - "logger.debug("

tags:
  - logging
  - production
  - typescript
`,

  'no-security-todos.yaml': `id: no-security-todos
title: "No unresolved security TODOs"
severity: error

globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  TODO and FIXME comments that reference security-critical settings must not be merged.
  These indicate known security gaps that are being deferred rather than addressed.

  ## What to Look For

  Flag any \\\`TODO\\\`, \\\`FIXME\\\`, \\\`HACK\\\`, or \\\`XXX\\\` comment that contains any of these
  security-sensitive terms:
  - SSL, TLS, HTTPS, encryption, certificate
  - auth, authentication, authorization, token, session
  - rate-limit, rate limit, throttle, brute-force
  - sanitize, validate, escape, XSS, injection
  - CORS, CSP, CSRF
  - secret, credential, password, API key

  ## Why This Matters

  - A TODO to "re-enable SSL" means SSL is currently disabled
  - A FIXME for "add rate limiting" means the endpoint is currently unprotected
  - These comments document known vulnerabilities that should block merge

  ## Exceptions

  - TODOs that reference a tracking ticket (e.g., \\\`TODO(SEC-123)\\\`) and describe future enhancements
    rather than missing security controls may be acceptable if the current state is still secure

examples:
  violations:
    - "// TODO: re-enable SSL"
    - "// FIXME: add rate limiting before production"
    - "// TODO: validate auth token"
    - "// HACK: disabled CORS for testing"
  compliant:
    - "// TODO: add dark mode support"
    - "// FIXME: improve error message formatting"
    - "// TODO(SEC-456): upgrade to mTLS when infra supports it"

tags:
  - security
  - comments
  - review
`,

  'no-raw-sql-interpolation.yaml': `id: no-raw-sql-interpolation
title: "No string interpolation in raw SQL queries"
severity: error

globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Raw SQL queries must use parameterized placeholders, never string interpolation.
  Flag any call to \\\`sql.raw()\\\`, \\\`sql.unsafe()\\\`, \\\`db.execute()\\\`, or similar raw query
  methods that use template literals with \\\`\${}\\\` interpolations.

  ## What to Look For

  - \\\`sql.raw(\\\\\\\`...\${variable}...\\\\\\\`)\\\` — template literal with interpolated values
  - \\\`sql.unsafe(\\\\\\\`...\${variable}...\\\\\\\`)\\\` — same pattern with unsafe variant
  - \\\`db.execute(\\\\\\\`SELECT ... WHERE x = '\${value}'\\\\\\\`)\\\` — direct execute with interpolation
  - String concatenation in SQL: \\\`"SELECT * FROM " + table + " WHERE ..."\\\`

  ## Why This Matters

  - String interpolation in SQL enables SQL injection attacks regardless of the source of the variable
  - Even "trusted" internal variables can contain unexpected characters
  - Parameterized queries (\\\`$1\\\`, \\\`$2\\\`) are handled by the database driver and are always safe

  ## Correct Patterns

  Use Drizzle's query builder (preferred) or parameterized raw queries:
  \\\`\\\`\\\`typescript
  // Good: Drizzle query builder
  db.select().from(repos).where(eq(repos.orgId, orgId))

  // Good: Parameterized raw SQL
  sql\\\\\\\`SELECT * FROM repos WHERE org_id = \${orgId}\\\\\\\`

  // Good: Named placeholders
  sql.raw('SELECT * FROM repos WHERE org_id = $1', [orgId])
  \\\`\\\`\\\`

  ## Exceptions

  - Static SQL strings with no interpolation (e.g., \\\`sql.raw('SELECT 1')\\\`) are fine
  - Interpolation of table/column names from constants (not user input) may be acceptable
    in migration scripts, but should still be flagged for review

examples:
  violations:
    - sql.raw(\`SELECT * FROM repos WHERE org_id = '\${orgId}'\`)
    - sql.unsafe(\`DELETE FROM \${tableName} WHERE id = '\${id}'\`)
    - db.execute(\`UPDATE users SET name = '\${name}'\`)
  compliant:
    - sql\`SELECT * FROM repos WHERE org_id = \${orgId}\`
    - "db.select().from(repos).where(eq(repos.orgId, orgId))"
    - "sql.raw('SELECT 1')"

tags:
  - security
  - sql-injection
  - database
`,

  'no-silent-migration-failures.yaml': `id: no-silent-migration-failures
title: "Migration errors must halt execution"
severity: error

globs:
  - "**/scripts/**/*.ts"
  - "**/migrations/**/*.ts"
  - "**/migrations/**/*.sql"
  - "**/migrate*.ts"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Database migration and data backfill scripts must fail loudly. Catch blocks in migration
  code must re-throw the error or call \\\`process.exit(1)\\\`. Never catch and continue.

  ## What to Look For

  - \\\`try/catch\\\` blocks that catch a migration error but only log a warning and continue
  - \\\`catch\\\` blocks that set a flag or return a partial result instead of stopping execution
  - Error handling that downgrades a migration failure to a warning or info log
  - Sequential migration steps where a failed earlier step would cause a later step to
    corrupt data (e.g., failed backfill followed by adding NOT NULL constraints)

  ## Why This Matters

  - A migration that silently continues after a partial failure leaves the database in
    an inconsistent state
  - If step 2 (data backfill) fails and step 3 (add constraints) runs, the constraints
    will either fail or be applied to un-backfilled rows, corrupting data
  - Unlike application code, migration errors cannot be "retried later" — the database
    state is already partially modified

  ## Correct Pattern

  \\\`\\\`\\\`typescript
  // Good: let errors propagate
  await db.execute(sql\\\\\\\`ALTER TABLE ...\\\\\\\`);
  await backfillData();
  await db.execute(sql\\\\\\\`ALTER TABLE ... ADD CONSTRAINT ...\\\\\\\`);

  // Good: explicit halt on failure
  try {
    await backfillData();
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
  \\\`\\\`\\\`

  ## Exceptions

  - Idempotent operations that use \\\`IF NOT EXISTS\\\` or \\\`ON CONFLICT DO NOTHING\\\` may
    safely catch specific expected errors
  - Logging before re-throwing is fine: \\\`catch (e) { log(e); throw e; }\\\`

examples:
  violations:
    - "catch (e) { console.warn('Migration step failed:', e.message); }"
    - "catch { /* continue to next step */ }"
    - "catch (err) { errors.push(err); } // continues execution"
  compliant:
    - "catch (e) { log.error(e); throw e; }"
    - "catch (e) { log.error(e); process.exit(1); }"
    - "// No try/catch — errors propagate naturally"

tags:
  - database
  - migrations
  - reliability
`,

  'atomic-cache-operations.yaml': `id: atomic-cache-operations
title: "Cache operations must be atomic"
severity: warning

globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Cache read-then-write patterns must use atomic operations to prevent race conditions
  under concurrent access. The gap between a cache read (miss) and a subsequent write
  is a race condition window.

  ## What to Look For

  Flag the "check-then-act" cache pattern:
  1. Read from cache (\\\`get\\\`, \\\`has\\\`, \\\`exists\\\`)
  2. Check if the value is missing (null/undefined check)
  3. Compute or fetch the value
  4. Write to cache (\\\`set\\\`, \\\`put\\\`)

  This sequence is NOT atomic — between steps 1 and 4, another concurrent request can:
  - Execute the same expensive computation
  - Write a different (potentially stale) result
  - The last writer wins, which may not be the freshest value

  ## Why This Matters

  - At low concurrency this pattern works fine, masking the bug
  - Under load (exactly when caching matters most), multiple requests compute simultaneously
  - The cache becomes unreliable — stale values can overwrite fresh ones
  - This is the classic "thundering herd" problem for cache misses

  ## Correct Patterns

  \\\`\\\`\\\`typescript
  // Good: Atomic set-if-not-exists
  const cached = await redis.set(key, computedValue, { NX: true, EX: ttl });

  // Good: Lua script for atomic check-and-set
  await redis.eval(luaScript, [key], [value, ttl]);

  // Good: Mutex/lock around computation
  const result = await cacheLock.acquire(key, async () => {
    const cached = await redis.get(key);
    if (cached) return cached;
    const value = await compute();
    await redis.set(key, value, { EX: ttl });
    return value;
  });
  \\\`\\\`\\\`

examples:
  violations:
    - |
      const cached = await redis.get(key);
      if (!cached) {
        const result = await compute();
        await redis.set(key, result);
      }
  compliant:
    - "await redis.set(key, value, { NX: true, EX: ttl })"
    - "await cache.getOrSet(key, computeFn, { ttl })"

tags:
  - concurrency
  - caching
  - race-condition
`,

  'no-type-assertions-on-db-results.yaml': `id: no-type-assertions-on-db-results
title: "No type assertions on database query results"
severity: error

globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Database query results must not use TypeScript \\\`as\\\` type assertions. Use the ORM's
  inferred types or explicit select projections to ensure type safety matches the actual schema.

  ## What to Look For

  - \\\`as\\\` assertions on values returned from \\\`db.query.*\\\`, \\\`db.select()\\\`, \\\`db.execute()\\\`,
    or any Drizzle ORM query method
  - Destructuring with \\\`as\\\` on query results: \\\`const { col } = result as { col: Type }\\\`
  - Casting query arrays: \\\`results as SomeType[]\\\`
  - Especially dangerous after schema changes (column renames, type changes) where the
    assertion hides a mismatch between the code's expected shape and the actual DB result

  ## Why This Matters

  - \\\`as\\\` assertions tell TypeScript "trust me" — they silence errors without fixing them
  - After a schema refactor (column rename, type change), a \\\`as\\\` assertion on a query result
    will compile fine but return \\\`undefined\\\` at runtime for the renamed/removed column
  - The \\\`undefined\\\` then propagates silently through calculations, producing NaN, null, or
    wrong values without throwing any error
  - Drizzle's inferred types (\\\`typeof table.$inferSelect\\\`) automatically reflect schema changes

  ## Correct Patterns

  \\\`\\\`\\\`typescript
  // Good: Drizzle inferred type
  const repo: typeof repos.$inferSelect = await db.query.repos.findFirst({...});

  // Good: Explicit select projection
  const result = await db.select({ name: repos.name, size: repos.sizeBytes }).from(repos);

  // Good: Let TypeScript infer from the query
  const repo = await db.query.repos.findFirst({...});
  // repo is correctly typed by Drizzle
  \\\`\\\`\\\`

examples:
  violations:
    - "const result = await db.query.repos.findFirst({...}) as RepoType"
    - "const { sizeBytes } = repo as { sizeBytes: number }"
    - "(await db.select().from(repos)) as Repo[]"
  compliant:
    - "const repo = await db.query.repos.findFirst({...})"
    - "db.select({ name: repos.name }).from(repos)"
    - "result satisfies typeof repos.$inferSelect"

tags:
  - typescript
  - type-safety
  - database
`,

  'no-env-override-for-infra-config.yaml': `id: no-env-override-for-infra-config
title: "Environment variables must not override infrastructure config"
severity: error

globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  When infrastructure-managed configuration exists (SST Resource bindings, Pulumi outputs,
  CDK constructs), environment variables must not take precedence over them.

  ## What to Look For

  Flag patterns where \\\`process.env.*\\\` appears BEFORE an infrastructure binding in a
  nullish coalescing or fallback chain:
  - \\\`process.env.DB_HOST ?? Resource.DepotDB.host\\\` — env var wins over managed config
  - \\\`process.env.X || config.infraValue\\\` — same problem with logical OR
  - Any pattern where a \\\`process.env\\\` read is the primary value and an infrastructure
    binding (Resource.*, Pulumi.*, etc.) is the fallback

  ## Why This Matters

  - Infrastructure bindings (e.g., \\\`Resource.DepotDB.host\\\` from SST) are the source of truth
    in deployed environments
  - If \\\`process.env.DB_HOST\\\` is accidentally set in production (Docker Compose override,
    CI artifact, debugging env var left behind), it silently overrides the correct infra value
  - This creates a "silent misconfiguration" path — the service connects to the wrong
    database, cache, or service without any error or warning
  - The correct precedence is: infra binding first, env var as fallback only when infra
    is unavailable (e.g., local development without SST)

  ## Correct Pattern

  \\\`\\\`\\\`typescript
  // Good: Infrastructure binding is primary
  const host = Resource.DepotDB.host;

  // Good: Env var only when infra is unavailable
  let host: string;
  try {
    host = Resource.DepotDB.host;
  } catch {
    host = process.env.DB_HOST ?? 'localhost';
  }
  \\\`\\\`\\\`

examples:
  violations:
    - "process.env.DB_HOST ?? Resource.DepotDB.host"
    - "process.env.DB_PASSWORD || Resource.DepotDB.password"
    - "const port = parseInt(process.env.DB_PORT ?? String(Resource.DepotDB.port))"
  compliant:
    - "Resource.DepotDB.host"
    - "try { Resource.X } catch { process.env.X }"
    - "process.env.LOCAL_DEV_ONLY_FLAG"

tags:
  - infrastructure
  - configuration
  - security
`,

  'cascade-delete-review.yaml': `id: cascade-delete-review
title: "DELETE on tables with CASCADE children requires blast radius review"
severity: error

globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/migrations/**/*.sql"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  When a migration or script performs DELETE operations on a table, check whether any
  child tables reference it with \\\`onDelete: 'cascade'\\\`. If so, the delete will silently
  propagate to all child records — flag this for blast radius review.

  ## What to Look For

  1. **DELETE on parent tables**: Any \\\`db.delete(table)\\\`, \\\`DELETE FROM table\\\`, or bulk
     delete operation in migration scripts or data cleanup code.

  2. **CASCADE children exist**: Use the codebase context or schema file to check if other
     tables reference the deleted table with \\\`onDelete: 'cascade'\\\`. If they do, every row
     deleted from the parent will cascade-delete all matching child rows.

  3. **The dangerous scenario**: A cleanup query or migration that deletes rows from a parent
     table (e.g., \\\`organization\\\`) will silently destroy ALL child records (repos, API keys,
     webhooks, members) if those tables use cascade deletes on their foreign key.

  4. **Amplified by other migration steps**: If the same migration modifies data that changes
     which rows match the DELETE's WHERE clause (e.g., renaming roles before querying by
     the old role name), the blast radius can be catastrophically larger than intended.

  ## Why This Matters

  - Cascade deletes are invisible — no error, no warning, no log when child rows are destroyed
  - A query that seems to delete 10 "orphaned" parent rows might cascade-delete thousands
    of child records (repos, webhooks, API keys, etc.)
  - In multi-step migrations, earlier steps can change which rows match a later step's
    WHERE clause, making the cascade affect far more data than expected
  - Neither the delete nor the cascade is wrong alone — the bug is in their interaction

  ## Correct Pattern

  - Always SELECT COUNT before DELETE on tables with cascade children to verify blast radius
  - Run data cleanup in a separate migration from schema/role changes
  - Consider using \\\`onDelete: 'restrict'\\\` or \\\`onDelete: 'set null'\\\` for safer defaults
  - Add explicit logging of how many rows will be affected before executing bulk deletes

examples:
  violations:
    - |
      // migration script deletes from a table that has CASCADE children
      await db.delete(organization).where(notExists(...))
      // while repos, apiKeys, webhooks all reference organization with onDelete: 'cascade'
  compliant:
    - |
      // Verify blast radius before delete
      const count = await db.select({ count: sql\\\`count(*)\\\` }).from(repos)
        .where(eq(repos.orgId, orgId));
      log.info('cascade-delete-preview', { childRepos: count });
      await db.delete(organization).where(eq(organization.id, orgId));

tags:
  - database
  - migrations
  - data-safety
  - cross-file
`,

  'constant-time-auth.yaml': `id: constant-time-auth
title: "Authentication must not leak timing information"
severity: error

globs:
  - "**/auth/**/*.ts"
  - "**/auth/**/*.tsx"
  - "!**/*.test.*"
  - "!**/*.spec.*"

instructions: |
  Authentication credential validation (API keys, tokens, passwords) must not short-circuit
  or return early based on format checks, cache hits, or other factors that create
  distinguishable timing profiles.

  ## What to Look For

  1. **Format-based early returns**: Checking key format (regex, prefix, length) and returning
     early before performing the full validation. This lets attackers learn the valid key format
     by measuring response times (instant reject vs. slow DB lookup).

  2. **Cache-based timing differences**: Caching recently validated keys so that valid cached
     keys return faster than uncached ones. This lets attackers distinguish recently-used
     (active) keys from invalid keys via response time.

  3. **Short-circuit validation**: Any pattern where the validation code path length differs
     based on the input, creating measurable timing differences:
     - Invalid format: ~0ms (instant reject)
     - Valid format, cached: ~1ms (memory lookup)
     - Valid format, uncached: ~20-50ms (database query)

  ## Why This Matters

  - Timing side-channels are a well-known attack class (CWE-208)
  - An attacker can determine valid key formats, enumerate active keys, and focus brute-force
    on the correct format space — all without triggering rate limits
  - The "optimization" (format check + caching) looks like good engineering but creates the
    vulnerability

  ## Correct Pattern

  \\\`\\\`\\\`typescript
  // Good: All paths hit the same code
  async function validateApiKey(key: string) {
    const hash = await hashApiKey(key); // always hash
    const result = await db.query(...);  // always query
    return result ?? null;               // same path regardless
  }
  \\\`\\\`\\\`

  ## Exceptions

  - Rate limiting by IP/source (not by key content) is fine
  - Timing differences in non-authentication code paths are acceptable

examples:
  violations:
    - "if (!KEY_FORMAT.test(key)) return { valid: false }"
    - "const cached = cache.get(key); if (cached) return cached"
    - "if (!key.startsWith('dp_')) return null"
  compliant:
    - "const hash = await hashApiKey(key); const result = await db.query(...)"
    - "// Always perform full validation regardless of format"

tags:
  - security
  - authentication
  - timing-attack
  - cross-file
`,
};
