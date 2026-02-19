import type { RulePolicy } from '../types/types.js';

export const STARTER_RULE_SKILLS: RulePolicy[] = [
  {
    id: 'no-console-log',
    title: 'No console.log in production code',
    severity: 'warning',
    globs: ['**/src/**/*.ts', '**/src/**/*.tsx', '!**/*.test.ts', '!**/*.test.tsx', '!**/*.spec.ts', '!**/*.spec.tsx'],
    instructions:
      "console.log, console.warn, and console.debug statements should not \nappear in production code. Use a proper logging library instead.\n\n## Why This Matters\n\n- Console statements are not structured (can't query/filter)\n- No log levels in production\n- May leak sensitive information\n- Can't be sent to logging services\n- Pollutes browser console in frontend apps\n\n## Exceptions\n\n- Test files (excluded via globs)\n- console.error in error boundaries (acceptable)\n- Explicit debug utilities that check environment\n",
    examples: {
      violations: ['console.log(', 'console.warn(', 'console.debug(', 'console.info('],
      compliant: ['logger.info(', 'logger.warn(', 'logger.error(', 'logger.debug('],
    },
    tags: ['typescript', 'logging', 'production'],
  },
  {
    id: 'no-hardcoded-secrets',
    title: 'No hardcoded secrets or credentials',
    severity: 'error',
    globs: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.rs',
      '**/*.go',
      '!**/*.test.*',
      '!**/*.spec.*',
      '!**/test/**',
      '!**/tests/**',
      '!**/__tests__/**',
    ],
    instructions:
      "Never hardcode secrets, API keys, passwords, or other credentials \nin source code. Use environment variables or secret management \nsystems instead.\n\n## What Counts as a Secret\n\n- API keys (sk-*, pk-*, api_*, etc.)\n- Database passwords\n- JWT secrets\n- OAuth client secrets\n- Encryption keys\n- Service account credentials\n- Webhook secrets\n- Any token used for authentication\n\n## Why This Matters\n\nHardcoded secrets:\n- End up in git history forever\n- Get leaked in logs, error messages\n- Can't be rotated without code changes\n- May be exposed in client bundles\n- Violate security compliance (SOC2, etc.)\n",
    examples: {
      violations: ['sk_live_', 'sk_test_', 'apiKey: "', 'secret: "', 'password: "', 'token: "'],
      compliant: ['process.env.', 'env.get(', 'secretsManager', 'vault.read('],
    },
    tags: ['security', 'secrets', 'compliance'],
  },
  {
    id: 'no-client-api-key-fallback',
    title: 'Do not use literal API key fallbacks in client code',
    severity: 'error',
    globs: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      'Frontend code must never include a hardcoded API key/token fallback value,\nincluding fallback literals attached to environment variables.\n\nFlag any client-side expression that does this pattern:\n- Reads import.meta.env.* (or process.env.*) and falls back to a literal\n  secret/token/API-key string with ?? or ||\n- Sets auth headers from literal secrets in browser code\n\nThis applies even if the fallback is marked as temporary or dev-only.\n',
    examples: {
      violations: ["const k = import.meta.env.VITE_X ?? 'sk_live_abc'", "'x-gateway-api-key': 'sk_live_abc'"],
      compliant: ['const k = import.meta.env.VITE_X', "if (!import.meta.env.VITE_X) throw new Error('missing key')"],
    },
    tags: ['security', 'frontend', 'secrets'],
  },
  {
    id: 'require-sanitized-auth-redirect',
    title: 'Auth redirects must sanitize dynamic target paths',
    severity: 'error',
    globs: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      "Any redirect or navigation target derived from URL/query/user-controlled input\nmust pass through the project's redirect sanitizer before being used.\n\nFlag code where dynamic values are interpolated directly into:\n- window.location.href = ...\n- router navigate({ to: ... })\n- redirect URL builders\n\nIf a helper exists (for this repo: sanitizeRedirect / buildSignInRedirect),\nrequire that helper and reject ad-hoc string interpolation.\n",
    examples: {
      violations: ["window.location.href = '/sign-in?redirect=' + userValue", 'navigate({ to: redirectParam })'],
      compliant: [
        'window.location.href = buildSignInRedirect(currentRelativeUrl())',
        'const safe = sanitizeRedirect(redirectParam)',
      ],
    },
    tags: ['security', 'auth', 'redirects'],
  },
  {
    id: 'guard-percentage-division',
    title: 'Percentage calculations must guard denominator',
    severity: 'error',
    globs: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      'Any percentage calculation that divides by a runtime value must explicitly\nguard denominator zero/invalid cases.\n\nFlag helpers or inline math like (part / total) * 100 when no local guard\nexists ensuring total > 0 (or equivalent finite check).\n\nThis includes shared utility functions and call sites that can pass\n0, null, undefined, or non-finite denominators.\n',
    examples: {
      violations: ['return Math.round((partial / total) * 100)', 'const pct = toPercent(commit.aiLines, commit.added)'],
      compliant: ['if (total <= 0) return 0', 'const pct = total > 0 ? Math.round((partial / total) * 100) : 0'],
    },
    tags: ['correctness', 'math', 'analytics'],
  },
  {
    id: 'react-query-key-matches-inputs',
    title: 'useQuery key must include all dynamic query inputs',
    severity: 'error',
    globs: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      'For useQuery, every dynamic input used by queryFn must be represented\nin queryKey to avoid stale or cross-context cache results.\n\nFlag hooks where queryFn uses values (for example org slug, route params,\nperiod, filters, repo name) that are missing from queryKey.\n\nPrioritize auth/org scoped data where omitted keys can leak data between\norganizations or routes.\n',
    examples: {
      violations: ["queryKey: ['org']", 'queryFn: () => coreAuthRequest(... orgSlug ...)', "queryKey: ['repo', name]"],
      compliant: ["queryKey: ['org', orgSlug]", "queryKey: ['repo', org?.slug, name]"],
    },
    tags: ['react-query', 'caching', 'correctness'],
  },
  {
    id: 'react-hook-dependency-completeness',
    title: 'React hook dependency arrays must include all referenced values',
    severity: 'error',
    globs: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      'Flag React hooks (useMemo, useCallback, useEffect) where the dependency\narray is missing values referenced in the callback body. Missing\ndependencies cause stale closures — the callback captures an old value\nand never updates when it changes.\n\n## What to Look For\n\n- Variables used inside the callback that are not listed in the deps array\n- Props, state, or derived values referenced in the callback but omitted from deps\n- Functions defined outside the hook that close over reactive values\n\n## Why This Matters\n\n- A stale closure silently returns outdated data with no error\n- Bugs only appear under specific timing (state changes between renders)\n- Extremely difficult to reproduce and diagnose in production\n\n## Exceptions\n\n- Refs (useRef values) are stable and do not need to be in deps\n- Dispatch functions from useReducer are stable\n- setState functions are stable\n- Values from useContext that are truly static\n',
    examples: {
      violations: [
        'useMemo(() => items.filter(i => i.score > threshold), [items])',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional code example
        'useCallback(() => fetch(`/api/${orgSlug}`), [])',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional code example
        'useEffect(() => { document.title = `${name} - App` }, [])',
      ],
      compliant: [
        'useMemo(() => items.filter(i => i.score > threshold), [items, threshold])',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional code example
        'useCallback(() => fetch(`/api/${orgSlug}`), [orgSlug])',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional code example
        'useEffect(() => { document.title = `${name} - App` }, [name])',
      ],
    },
    tags: ['react', 'hooks', 'correctness'],
  },
  {
    id: 'no-hardcoded-credentials',
    title: 'No hardcoded database credentials',
    severity: 'error',
    globs: ['**/*.ts', '**/*.tsx', '**/*.js', '!**/*.test.*', '!**/*.spec.*', '!**/test/**', '!**/tests/**'],
    instructions:
      "Database connection strings and credentials must never be hardcoded in source code.\nFlag any string literal that matches a database connection URI pattern containing\nembedded usernames or passwords.\n\n## What to Look For\n\n- Connection URIs with credentials: \\`postgresql://user:pass@host\\`, \\`mysql://user:pass@host\\`, \\`mongodb://user:pass@host\\`\n- Hardcoded passwords in connection config objects (e.g., \\`password: 'mypassword'\\`)\n- Default/fallback connection strings that contain credentials, even behind \\`??\\` or \\`||\\`\n- Comments containing connection strings with real credentials\n\n## Why This Matters\n\n- Credentials in source code end up in git history permanently\n- Fallback connection strings with real credentials can accidentally connect to production\n- Secrets in code cannot be rotated without redeployment\n\n## Exceptions\n\n- Environment variable references (\\`process.env.DATABASE_URL\\`) are fine\n- Placeholder strings in documentation or comments like \\`postgresql://user:password@localhost\\` in README files\n- Test files (excluded via globs)\n",
    examples: {
      violations: [
        'postgresql://admin:secret@prod-db:5432/mydb',
        "password: 'r3f4ct0r_2024'",
        "const url = process.env.DB_URL ?? 'postgres://root:pass@host/db'",
      ],
      compliant: ['process.env.DATABASE_URL', 'Resource.DepotDB.password', "config.get('database.password')"],
    },
    tags: ['security', 'credentials', 'database'],
  },
  {
    id: 'no-security-todos',
    title: 'No unresolved security TODOs',
    severity: 'error',
    globs: ['**/*.ts', '**/*.tsx', '**/*.js', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      'TODO and FIXME comments that reference security-critical settings must not be merged.\nThese indicate known security gaps that are being deferred rather than addressed.\n\n## What to Look For\n\nFlag any \\`TODO\\`, \\`FIXME\\`, \\`HACK\\`, or \\`XXX\\` comment that contains any of these\nsecurity-sensitive terms:\n- SSL, TLS, HTTPS, encryption, certificate\n- auth, authentication, authorization, token, session\n- rate-limit, rate limit, throttle, brute-force\n- sanitize, validate, escape, XSS, injection\n- CORS, CSP, CSRF\n- secret, credential, password, API key\n\n## Why This Matters\n\n- A TODO to "re-enable SSL" means SSL is currently disabled\n- A FIXME for "add rate limiting" means the endpoint is currently unprotected\n- These comments document known vulnerabilities that should block merge\n\n## Exceptions\n\n- TODOs that reference a tracking ticket (e.g., \\`TODO(SEC-123)\\`) and describe future enhancements\n  rather than missing security controls may be acceptable if the current state is still secure\n',
    examples: {
      violations: [
        '// TODO: re-enable SSL',
        '// FIXME: add rate limiting before production',
        '// TODO: validate auth token',
        '// HACK: disabled CORS for testing',
      ],
      compliant: [
        '// TODO: add dark mode support',
        '// FIXME: improve error message formatting',
        '// TODO(SEC-456): upgrade to mTLS when infra supports it',
      ],
    },
    tags: ['security', 'comments', 'review'],
  },
  {
    id: 'no-raw-sql-interpolation',
    title: 'No string interpolation in raw SQL queries',
    severity: 'error',
    globs: ['**/*.ts', '**/*.tsx', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      "Raw SQL queries must use parameterized placeholders, never string interpolation.\nFlag any call to \\`sql.raw()\\`, \\`sql.unsafe()\\`, \\`db.execute()\\`, or similar raw query\nmethods that use template literals with injected runtime values.\n\n## What to Look For\n\n- \\`sql.raw(\\\\\\`...{variable}...\\\\\\`)\\` — template literal with interpolated values\n- \\`sql.unsafe(\\\\\\`...{variable}...\\\\\\`)\\` — same pattern with unsafe variant\n- \\`db.execute(\\\\\\`SELECT ... WHERE x = '{value}'\\\\\\`)\\` — direct execute with interpolation\n- String concatenation in SQL: \\`\"SELECT * FROM \" + table + \" WHERE ...\"\\`\n\n## Why This Matters\n\n- String interpolation in SQL enables SQL injection attacks regardless of the source of the variable\n- Even \"trusted\" internal variables can contain unexpected characters\n- Parameterized queries (\\`$1\\`, \\`$2\\`) are handled by the database driver and are always safe\n\n## Correct Patterns\n\nUse Drizzle's query builder (preferred) or parameterized raw queries:\n\\`\\`\\`typescript\n// Good: Drizzle query builder\ndb.select().from(repos).where(eq(repos.orgId, orgId))\n\n// Good: Parameterized raw SQL\nsql\\\\\\`SELECT * FROM repos WHERE org_id = {orgId}\\\\\\`\n\n// Good: Named placeholders\nsql.raw('SELECT * FROM repos WHERE org_id = $1', [orgId])\n\\`\\`\\`\n\n## Exceptions\n\n- Static SQL strings with no interpolation (e.g., \\`sql.raw('SELECT 1')\\`) are fine\n- Interpolation of table/column names from constants (not user input) may be acceptable\n  in migration scripts, but should still be flagged for review\n",
    examples: {
      violations: [
        "sql.raw(`SELECT * FROM repos WHERE org_id = '{orgId}'`)",
        "sql.unsafe(`DELETE FROM {tableName} WHERE id = '{id}'`)",
        "db.execute(`UPDATE users SET name = '{name}'`)",
      ],
      compliant: [
        'sql`SELECT * FROM repos WHERE org_id = {orgId}`',
        'db.select().from(repos).where(eq(repos.orgId, orgId))',
        "sql.raw('SELECT 1')",
      ],
    },
    tags: ['security', 'sql-injection', 'database'],
  },
  {
    id: 'no-silent-migration-failures',
    title: 'Migration errors must halt execution',
    severity: 'error',
    globs: [
      '**/scripts/**/*.ts',
      '**/migrations/**/*.ts',
      '**/migrations/**/*.sql',
      '**/migrate*.ts',
      '!**/*.test.*',
      '!**/*.spec.*',
    ],
    instructions:
      'Database migration and data backfill scripts must fail loudly. Catch blocks in migration\ncode must re-throw the error or call \\`process.exit(1)\\`. Never catch and continue.\n\n## What to Look For\n\n- \\`try/catch\\` blocks that catch a migration error but only log a warning and continue\n- \\`catch\\` blocks that set a flag or return a partial result instead of stopping execution\n- Error handling that downgrades a migration failure to a warning or info log\n- Sequential migration steps where a failed earlier step would cause a later step to\n  corrupt data (e.g., failed backfill followed by adding NOT NULL constraints)\n\n## Why This Matters\n\n- A migration that silently continues after a partial failure leaves the database in\n  an inconsistent state\n- If step 2 (data backfill) fails and step 3 (add constraints) runs, the constraints\n  will either fail or be applied to un-backfilled rows, corrupting data\n- Unlike application code, migration errors cannot be "retried later" — the database\n  state is already partially modified\n\n## Correct Pattern\n\n\\`\\`\\`typescript\n// Good: let errors propagate\nawait db.execute(sql\\\\\\`ALTER TABLE ...\\\\\\`);\nawait backfillData();\nawait db.execute(sql\\\\\\`ALTER TABLE ... ADD CONSTRAINT ...\\\\\\`);\n\n// Good: explicit halt on failure\ntry {\n  await backfillData();\n} catch (err) {\n  console.error(\'Migration failed:\', err);\n  process.exit(1);\n}\n\\`\\`\\`\n\n## Exceptions\n\n- Idempotent operations that use \\`IF NOT EXISTS\\` or \\`ON CONFLICT DO NOTHING\\` may\n  safely catch specific expected errors\n- Logging before re-throwing is fine: \\`catch (e) { log(e); throw e; }\\`\n',
    examples: {
      violations: [
        "catch (e) { console.warn('Migration step failed:', e.message); }",
        'catch { /* continue to next step */ }',
        'catch (err) { errors.push(err); } // continues execution',
      ],
      compliant: [
        'catch (e) { log.error(e); throw e; }',
        'catch (e) { log.error(e); process.exit(1); }',
        '// No try/catch — errors propagate naturally',
      ],
    },
    tags: ['database', 'migrations', 'reliability'],
  },
  {
    id: 'atomic-cache-operations',
    title: 'Cache operations must be atomic',
    severity: 'warning',
    globs: ['**/*.ts', '**/*.tsx', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      'Cache read-then-write patterns must use atomic operations to prevent race conditions\nunder concurrent access. The gap between a cache read (miss) and a subsequent write\nis a race condition window.\n\n## What to Look For\n\nFlag the "check-then-act" cache pattern:\n1. Read from cache (\\`get\\`, \\`has\\`, \\`exists\\`)\n2. Check if the value is missing (null/undefined check)\n3. Compute or fetch the value\n4. Write to cache (\\`set\\`, \\`put\\`)\n\nThis sequence is NOT atomic — between steps 1 and 4, another concurrent request can:\n- Execute the same expensive computation\n- Write a different (potentially stale) result\n- The last writer wins, which may not be the freshest value\n\n## Why This Matters\n\n- At low concurrency this pattern works fine, masking the bug\n- Under load (exactly when caching matters most), multiple requests compute simultaneously\n- The cache becomes unreliable — stale values can overwrite fresh ones\n- This is the classic "thundering herd" problem for cache misses\n\n## Correct Patterns\n\n\\`\\`\\`typescript\n// Good: Atomic set-if-not-exists\nconst cached = await redis.set(key, computedValue, { NX: true, EX: ttl });\n\n// Good: Lua script for atomic check-and-set\nawait redis.eval(luaScript, [key], [value, ttl]);\n\n// Good: Mutex/lock around computation\nconst result = await cacheLock.acquire(key, async () => {\n  const cached = await redis.get(key);\n  if (cached) return cached;\n  const value = await compute();\n  await redis.set(key, value, { EX: ttl });\n  return value;\n});\n\\`\\`\\`\n',
    examples: {
      violations: [
        'const cached = await redis.get(key);\nif (!cached) {\n  const result = await compute();\n  await redis.set(key, result);\n}\n',
      ],
      compliant: [
        'await redis.set(key, value, { NX: true, EX: ttl })',
        'await cache.getOrSet(key, computeFn, { ttl })',
      ],
    },
    tags: ['concurrency', 'caching', 'race-condition'],
  },
  {
    id: 'no-type-assertions-on-db-results',
    title: 'No type assertions on database query results',
    severity: 'error',
    globs: ['**/*.ts', '**/*.tsx', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      "Database query results must not use TypeScript \\`as\\` type assertions. Use the ORM's\ninferred types or explicit select projections to ensure type safety matches the actual schema.\n\n## What to Look For\n\n- \\`as\\` assertions on values returned from \\`db.query.*\\`, \\`db.select()\\`, \\`db.execute()\\`,\n  or any Drizzle ORM query method\n- Destructuring with \\`as\\` on query results: \\`const { col } = result as { col: Type }\\`\n- Casting query arrays: \\`results as SomeType[]\\`\n- Especially dangerous after schema changes (column renames, type changes) where the\n  assertion hides a mismatch between the code's expected shape and the actual DB result\n\n## Why This Matters\n\n- \\`as\\` assertions tell TypeScript \"trust me\" — they silence errors without fixing them\n- After a schema refactor (column rename, type change), a \\`as\\` assertion on a query result\n  will compile fine but return \\`undefined\\` at runtime for the renamed/removed column\n- The \\`undefined\\` then propagates silently through calculations, producing NaN, null, or\n  wrong values without throwing any error\n- Drizzle's inferred types (\\`typeof table.$inferSelect\\`) automatically reflect schema changes\n\n## Correct Patterns\n\n\\`\\`\\`typescript\n// Good: Drizzle inferred type\nconst repo: typeof repos.$inferSelect = await db.query.repos.findFirst({...});\n\n// Good: Explicit select projection\nconst result = await db.select({ name: repos.name, size: repos.sizeBytes }).from(repos);\n\n// Good: Let TypeScript infer from the query\nconst repo = await db.query.repos.findFirst({...});\n// repo is correctly typed by Drizzle\n\\`\\`\\`\n",
    examples: {
      violations: [
        'const result = await db.query.repos.findFirst({...}) as RepoType',
        'const { sizeBytes } = repo as { sizeBytes: number }',
        '(await db.select().from(repos)) as Repo[]',
      ],
      compliant: [
        'const repo = await db.query.repos.findFirst({...})',
        'db.select({ name: repos.name }).from(repos)',
        'result satisfies typeof repos.$inferSelect',
      ],
    },
    tags: ['typescript', 'type-safety', 'database'],
  },
  {
    id: 'no-env-override-for-infra-config',
    title: 'Environment variables must not override infrastructure config',
    severity: 'error',
    globs: ['**/*.ts', '**/*.tsx', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      'When infrastructure-managed configuration exists (SST Resource bindings, Pulumi outputs,\nCDK constructs), environment variables must not take precedence over them.\n\n## What to Look For\n\nFlag patterns where \\`process.env.*\\` appears BEFORE an infrastructure binding in a\nnullish coalescing or fallback chain:\n- \\`process.env.DB_HOST ?? Resource.DepotDB.host\\` — env var wins over managed config\n- \\`process.env.X || config.infraValue\\` — same problem with logical OR\n- Any pattern where a \\`process.env\\` read is the primary value and an infrastructure\n  binding (Resource.*, Pulumi.*, etc.) is the fallback\n\n## Why This Matters\n\n- Infrastructure bindings (e.g., \\`Resource.DepotDB.host\\` from SST) are the source of truth\n  in deployed environments\n- If \\`process.env.DB_HOST\\` is accidentally set in production (Docker Compose override,\n  CI artifact, debugging env var left behind), it silently overrides the correct infra value\n- This creates a "silent misconfiguration" path — the service connects to the wrong\n  database, cache, or service without any error or warning\n- The correct precedence is: infra binding first, env var as fallback only when infra\n  is unavailable (e.g., local development without SST)\n\n## Correct Pattern\n\n\\`\\`\\`typescript\n// Good: Infrastructure binding is primary\nconst host = Resource.DepotDB.host;\n\n// Good: Env var only when infra is unavailable\nlet host: string;\ntry {\n  host = Resource.DepotDB.host;\n} catch {\n  host = process.env.DB_HOST ?? \'localhost\';\n}\n\\`\\`\\`\n',
    examples: {
      violations: [
        'process.env.DB_HOST ?? Resource.DepotDB.host',
        'process.env.DB_PASSWORD || Resource.DepotDB.password',
        'const port = parseInt(process.env.DB_PORT ?? String(Resource.DepotDB.port))',
      ],
      compliant: [
        'Resource.DepotDB.host',
        'try { Resource.X } catch { process.env.X }',
        'process.env.LOCAL_DEV_ONLY_FLAG',
      ],
    },
    tags: ['infrastructure', 'configuration', 'security'],
  },
  {
    id: 'cascade-delete-review',
    title: 'DELETE on tables with CASCADE children requires blast radius review',
    severity: 'error',
    globs: ['**/*.ts', '**/*.tsx', '**/migrations/**/*.sql', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      "When a migration or script performs DELETE operations on a table, check whether any\nchild tables reference it with \\`onDelete: 'cascade'\\`. If so, the delete will silently\npropagate to all child records — flag this for blast radius review.\n\n## What to Look For\n\n1. **DELETE on parent tables**: Any \\`db.delete(table)\\`, \\`DELETE FROM table\\`, or bulk\n   delete operation in migration scripts or data cleanup code.\n\n2. **CASCADE children exist**: Use the codebase context or schema file to check if other\n   tables reference the deleted table with \\`onDelete: 'cascade'\\`. If they do, every row\n   deleted from the parent will cascade-delete all matching child rows.\n\n3. **The dangerous scenario**: A cleanup query or migration that deletes rows from a parent\n   table (e.g., \\`organization\\`) will silently destroy ALL child records (repos, API keys,\n   webhooks, members) if those tables use cascade deletes on their foreign key.\n\n4. **Amplified by other migration steps**: If the same migration modifies data that changes\n   which rows match the DELETE's WHERE clause (e.g., renaming roles before querying by\n   the old role name), the blast radius can be catastrophically larger than intended.\n\n## Why This Matters\n\n- Cascade deletes are invisible — no error, no warning, no log when child rows are destroyed\n- A query that seems to delete 10 \"orphaned\" parent rows might cascade-delete thousands\n  of child records (repos, webhooks, API keys, etc.)\n- In multi-step migrations, earlier steps can change which rows match a later step's\n  WHERE clause, making the cascade affect far more data than expected\n- Neither the delete nor the cascade is wrong alone — the bug is in their interaction\n\n## Correct Pattern\n\n- Always SELECT COUNT before DELETE on tables with cascade children to verify blast radius\n- Run data cleanup in a separate migration from schema/role changes\n- Consider using \\`onDelete: 'restrict'\\` or \\`onDelete: 'set null'\\` for safer defaults\n- Add explicit logging of how many rows will be affected before executing bulk deletes\n",
    examples: {
      violations: [
        "// migration script deletes from a table that has CASCADE children\nawait db.delete(organization).where(notExists(...))\n// while repos, apiKeys, webhooks all reference organization with onDelete: 'cascade'\n",
      ],
      compliant: [
        "// Verify blast radius before delete\nconst count = await db.select({ count: sql\\`count(*)\\` }).from(repos)\n  .where(eq(repos.orgId, orgId));\nlog.info('cascade-delete-preview', { childRepos: count });\nawait db.delete(organization).where(eq(organization.id, orgId));\n",
      ],
    },
    tags: ['database', 'migrations', 'data-safety', 'cross-file'],
  },
  {
    id: 'constant-time-auth',
    title: 'Authentication must not leak timing information',
    severity: 'error',
    globs: ['**/auth/**/*.ts', '**/auth/**/*.tsx', '!**/*.test.*', '!**/*.spec.*'],
    instructions:
      'Authentication credential validation (API keys, tokens, passwords) must not short-circuit\nor return early based on format checks, cache hits, or other factors that create\ndistinguishable timing profiles.\n\n## What to Look For\n\n1. **Format-based early returns**: Checking key format (regex, prefix, length) and returning\n   early before performing the full validation. This lets attackers learn the valid key format\n   by measuring response times (instant reject vs. slow DB lookup).\n\n2. **Cache-based timing differences**: Caching recently validated keys so that valid cached\n   keys return faster than uncached ones. This lets attackers distinguish recently-used\n   (active) keys from invalid keys via response time.\n\n3. **Short-circuit validation**: Any pattern where the validation code path length differs\n   based on the input, creating measurable timing differences:\n   - Invalid format: ~0ms (instant reject)\n   - Valid format, cached: ~1ms (memory lookup)\n   - Valid format, uncached: ~20-50ms (database query)\n\n## Why This Matters\n\n- Timing side-channels are a well-known attack class (CWE-208)\n- An attacker can determine valid key formats, enumerate active keys, and focus brute-force\n  on the correct format space — all without triggering rate limits\n- The "optimization" (format check + caching) looks like good engineering but creates the\n  vulnerability\n\n## Correct Pattern\n\n\\`\\`\\`typescript\n// Good: All paths hit the same code\nasync function validateApiKey(key: string) {\n  const hash = await hashApiKey(key); // always hash\n  const result = await db.query(...);  // always query\n  return result ?? null;               // same path regardless\n}\n\\`\\`\\`\n\n## Exceptions\n\n- Rate limiting by IP/source (not by key content) is fine\n- Timing differences in non-authentication code paths are acceptable\n',
    examples: {
      violations: [
        'if (!KEY_FORMAT.test(key)) return { valid: false }',
        'const cached = cache.get(key); if (cached) return cached',
        "if (!key.startsWith('dp_')) return null",
      ],
      compliant: [
        'const hash = await hashApiKey(key); const result = await db.query(...)',
        '// Always perform full validation regardless of format',
      ],
    },
    tags: ['security', 'authentication', 'timing-attack', 'cross-file'],
  },
] as const satisfies RulePolicy[];
