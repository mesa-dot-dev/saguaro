import type { RulePolicy } from '../types/types.js';

export interface StarterRule extends RulePolicy {
  /** Ecosystem IDs this rule belongs to. Rule is selected if ALL are present. */
  ecosystems: string[];
  /** Optional fine-grained file check — rule only applies if these globs match files. */
  requires?: { files: string[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Starter Rules Catalog
//
// 19 curated rules organized by ecosystem. Rules with ecosystems: [] are
// universal and always included. Rules with one or more ecosystem IDs are
// only selected when ALL listed ecosystems are detected in the target codebase.
// ─────────────────────────────────────────────────────────────────────────────

export const STARTER_RULES: StarterRule[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // Universal Rules (ecosystems: [])
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'no-secrets-in-error-responses',
    title: 'Error responses must not expose internal details',
    severity: 'error',
    globs: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.go',
      '**/*.rs',
      '!**/*.test.*',
      '!**/*.spec.*',
      '!**/test/**',
      '!**/tests/**',
      '!**/__tests__/**',
    ],
    instructions: `Error responses at API boundaries must not expose stack traces, SQL query text, internal file paths, or raw exception messages to clients.

Look for:
- \`catch (e) { res.json({ error: e.message }) }\` — \`e.message\` may contain SQL syntax, file paths, or library internals
- Returning \`error.stack\` or full exception objects in HTTP responses
- Forwarding ORM/database errors directly to the client (e.g., Prisma, Drizzle, SQLAlchemy errors)
- GraphQL resolvers that propagate raw error messages to the response

Exceptions:
- 4xx errors with user-actionable messages (e.g., "Email already registered")
- Development-mode error pages that are disabled in production`,
    examples: {
      violations: ['catch (e) { res.json({ error: e.message }) }', 'res.status(500).json({ error: error.stack })'],
      compliant: ['catch (e) { logger.error(e); res.status(500).json({ error: "Internal server error" }) }'],
    },
    tags: ['security', 'api', 'error-handling'],
    ecosystems: [],
  },
  {
    id: 'n-plus-one-query',
    title: 'No database queries inside loops',
    severity: 'warning',
    globs: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.go',
      '**/*.rs',
      '!**/*.test.*',
      '!**/*.spec.*',
      '!**/test/**',
      '!**/tests/**',
      '!**/__tests__/**',
    ],
    instructions: `Database queries must not be executed inside loops (the N+1 query problem).

Look for:
- \`for (const item of items) { await db.query(...item.id) }\` — N queries instead of 1
- \`items.map(async (item) => await prisma.related.findMany({ where: { parentId: item.id } }))\`
- \`for item in items: Model.objects.get(id=item.related_id)\` (Python/Django)
- \`for _, item := range items { db.Query("SELECT ... WHERE id = ?", item.ID) }\` (Go)
- Any ORM \`.find()\`, \`.get()\`, \`.findUnique()\`, \`.query()\` call inside a loop or \`.map()\`/\`.forEach()\`

Exceptions:
- Loops with a known small upper bound (e.g., 3-5 items max) with a comment explaining the bound`,
    examples: {
      violations: [
        'for (const id of ids) { await db.query("SELECT * FROM users WHERE id = ?", [id]) }',
        'items.map(async (item) => await prisma.detail.findUnique({ where: { id: item.detailId } }))',
      ],
      compliant: [
        'await db.query("SELECT * FROM users WHERE id IN (?)", [ids])',
        'await prisma.item.findMany({ include: { detail: true } })',
      ],
    },
    tags: ['performance', 'database', 'n-plus-one'],
    ecosystems: [],
  },
  {
    id: 'unbounded-list-endpoint',
    title: 'List endpoints must have pagination or a default limit',
    severity: 'warning',
    globs: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.go',
      '**/*.rs',
      '!**/*.test.*',
      '!**/*.spec.*',
      '!**/test/**',
      '!**/tests/**',
      '!**/__tests__/**',
    ],
    instructions: `API endpoints that return lists of records must include a LIMIT, pagination, or cursor mechanism.

Look for:
- \`SELECT * FROM table\` without a LIMIT clause
- ORM \`.findMany()\`, \`.all()\`, \`.filter()\` without \`take\`/\`limit\`/\`[:N]\`
- Returning the raw result of a "get all" query directly in a response
- Missing default page size when no pagination params are provided

Exceptions:
- Internal batch processing endpoints that deliberately load all records (must have a comment explaining the use case)`,
    examples: {
      violations: [
        'const users = await db.query("SELECT * FROM users");',
        'const items = await prisma.item.findMany();',
      ],
      compliant: [
        'const users = await db.query("SELECT * FROM users LIMIT ? OFFSET ?", [pageSize, offset]);',
        'const items = await prisma.item.findMany({ take: limit, skip: offset });',
      ],
    },
    tags: ['performance', 'api', 'pagination'],
    ecosystems: [],
  },
  {
    id: 'inefficient-nested-iteration',
    title: 'Avoid nested iterations when a hash lookup would work',
    severity: 'warning',
    globs: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.go',
      '**/*.rs',
      '!**/*.test.*',
      '!**/*.spec.*',
      '!**/test/**',
      '!**/tests/**',
      '!**/__tests__/**',
    ],
    instructions: `Nested iterations where the inner operation is a lookup by key or value should use a hash-based data structure (Set, Map, dict, HashMap) instead.

Look for:
- \`.find()\` or \`.findIndex()\` inside \`.map()\`, \`.filter()\`, \`.forEach()\`, or \`for\` loops
- \`.includes()\` called on an array inside a loop
- Nested \`for\` loops where the inner loop searches for a matching element by ID or key
- \`.some()\` or \`.every()\` inside \`.filter()\`
- Python: \`if x in list\` inside a loop (should be \`if x in set\`)
- Go: linear scan of a slice inside a loop

Exceptions:
- Arrays with a known small upper bound (< 20 items) where readability outweighs performance
- One-time operations in startup/initialization code`,
    examples: {
      violations: [
        'orders.map(order => users.find(u => u.id === order.userId))',
        'items.filter(item => excludeIds.includes(item.id))',
      ],
      compliant: [
        'const userMap = new Map(users.map(u => [u.id, u]));\norders.map(order => userMap.get(order.userId))',
        'const excludeSet = new Set(excludeIds);\nitems.filter(item => !excludeSet.has(item.id))',
      ],
    },
    tags: ['performance', 'complexity', 'algorithms'],
    ecosystems: [],
  },
  {
    id: 'missing-error-handling-on-external-call',
    title: 'External calls must have error handling',
    severity: 'warning',
    globs: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.go',
      '**/*.rs',
      '!**/*.test.*',
      '!**/*.spec.*',
      '!**/test/**',
      '!**/tests/**',
      '!**/__tests__/**',
    ],
    instructions: `External calls (HTTP requests, database queries, file I/O) must have error handling at the call site or within an enclosing error boundary.

Look for:
- \`fetch(url).then(res => res.json()).then(setData)\` — no \`.catch()\` and no enclosing try/catch
- \`await db.query(...)\` outside of a try/catch block and not in a route handler with error middleware
- \`fs.readFile(...)\` callbacks without error parameter checks
- \`requests.get(url)\` in Python without try/except for \`RequestException\`
- \`http.Get(url)\` in Go where the returned error is assigned to \`_\`

Exceptions:
- Calls inside frameworks that provide automatic error handling (e.g., Next.js server actions, tRPC procedures with error formatters)
- Intentional fire-and-forget calls explicitly marked with \`void\` or \`.catch(logError)\``,
    examples: {
      violations: ['fetch("/api/data").then(r => r.json()).then(setData)', 'resp, _ := http.Get(url)'],
      compliant: [
        'try {\n  const res = await fetch("/api/data");\n  setData(await res.json());\n} catch (e) {\n  setError("Failed to load data");\n}',
        'resp, err := http.Get(url)\nif err != nil {\n  return fmt.Errorf("fetch failed: %w", err)\n}',
      ],
    },
    tags: ['reliability', 'error-handling', 'resilience'],
    ecosystems: [],
  },
  {
    id: 'hardcoded-env-specific-value',
    title: 'Environment-specific values must come from configuration',
    severity: 'warning',
    globs: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.go',
      '**/*.rs',
      '!**/*.test.*',
      '!**/*.spec.*',
      '!**/test/**',
      '!**/tests/**',
      '!**/__tests__/**',
      '!**/*.config.*',
      '!**/config/**',
      '!**/.env*',
      '!**/docker-compose*',
    ],
    instructions: `URLs, ports, API endpoints, and connection strings must not be hardcoded in source files. These values change between environments and should come from environment variables or configuration files.

Look for:
- \`http://localhost:3000\` or \`http://127.0.0.1\` URLs in application code
- Hardcoded API base URLs: \`https://api.myapp.com/v1\`
- Hardcoded port numbers in application logic: \`const PORT = 3000\`
- Database connection strings: \`postgres://user:pass@localhost:5432/db\`
- Hardcoded WebSocket URLs: \`ws://localhost:8080\`

Exceptions:
- Test files and fixtures (excluded by globs)
- Configuration files, docker-compose files, and .env files (excluded by globs)
- Constants that are genuinely the same across all environments (e.g., well-known public API URLs)`,
    examples: {
      violations: [
        'const API_URL = "http://localhost:3000/api"',
        'const db = new Database("postgres://admin:secret@localhost:5432/mydb")',
      ],
      compliant: [
        'const API_URL = process.env.API_URL ?? "http://localhost:3000/api"',
        'const db = new Database(process.env.DATABASE_URL)',
      ],
    },
    tags: ['deployment', 'configuration', 'environment'],
    ecosystems: [],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // JavaScript / TypeScript Rules
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'no-floating-promises',
    title: 'Promises must be awaited, returned, or caught',
    severity: 'error',
    globs: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '!**/*.test.*',
      '!**/*.spec.*',
      '!**/test/**',
      '!**/tests/**',
      '!**/__tests__/**',
    ],
    instructions: `Every Promise must be \`await\`ed, returned, or have a \`.catch()\` handler attached. A floating (unhandled) Promise silently swallows errors and causes execution to continue before the async operation completes.

Look for:
- \`saveToDatabase(data);\` — calling an async function without \`await\` or \`return\`
- \`fetch(url);\` — fire-and-forget fetch calls
- \`promise.then(handler)\` without a \`.catch()\` or a subsequent \`await\`
- \`.forEach(async (item) => { await ... })\` — the promises from each iteration are not collected

Exceptions:
- Intentional fire-and-forget with \`void promise\` or \`promise.catch(logError)\` to explicitly acknowledge the pattern`,
    examples: {
      violations: ['saveToDatabase(data);', 'items.forEach(async (item) => { await processItem(item); });'],
      compliant: ['await saveToDatabase(data);', 'await Promise.all(items.map((item) => processItem(item)));'],
    },
    tags: ['correctness', 'async', 'error-handling'],
    ecosystems: ['javascript'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // React Rules
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'missing-effect-cleanup',
    title: 'useEffect with subscriptions must return a cleanup function',
    severity: 'warning',
    globs: ['**/*.tsx', '**/*.jsx', '!**/*.test.*', '!**/*.spec.*', '!**/test/**', '!**/tests/**', '!**/__tests__/**'],
    instructions: `\`useEffect\` hooks that set up intervals, event listeners, subscriptions, WebSocket connections, or fetch requests must return a cleanup function to tear them down.

Look for:
- \`useEffect(() => { setInterval(...) }, [])\` — interval runs forever, even after unmount
- \`useEffect(() => { window.addEventListener("resize", handler) }, [])\` — listener never removed
- \`useEffect(() => { const ws = new WebSocket(url) }, [])\` — connection never closed
- \`useEffect(() => { fetch(url).then(setData) }, [url])\` — stale fetch updates state after unmount

Exceptions:
- Effects that only run synchronous setup with no teardown needed (e.g., setting document.title)`,
    examples: {
      violations: [
        'useEffect(() => {\n  setInterval(tick, 1000);\n}, []);',
        'useEffect(() => {\n  window.addEventListener("resize", handler);\n}, []);',
      ],
      compliant: [
        'useEffect(() => {\n  const id = setInterval(tick, 1000);\n  return () => clearInterval(id);\n}, []);',
      ],
    },
    tags: ['react', 'memory-leak', 'hooks'],
    ecosystems: ['react'],
  },
  {
    id: 'react-query-key-matches-inputs',
    title: 'Query keys must include all dynamic inputs used by queryFn',
    severity: 'error',
    globs: [
      '**/*.tsx',
      '**/*.jsx',
      '**/*.ts',
      '**/*.js',
      '!**/*.test.*',
      '!**/*.spec.*',
      '!**/test/**',
      '!**/tests/**',
      '!**/__tests__/**',
    ],
    instructions: `Every dynamic value used inside a \`queryFn\` must be represented in the \`queryKey\`. Missing a value means the cache serves stale data from a different context.

Look for:
- \`useQuery({ queryKey: ["docs"], queryFn: () => fetchDocs(orgId) })\` — \`orgId\` is missing from the key
- \`queryKey: ["users"]\` with \`queryFn\` that uses \`filters\`, \`page\`, \`sortBy\`, or any other dynamic input
- Variables from component props or state used in \`queryFn\` but absent from \`queryKey\`

Exceptions:
- Static query functions with no dynamic inputs (e.g., fetching app-wide config)`,
    examples: {
      violations: [
        'useQuery({ queryKey: ["docs"], queryFn: () => fetchDocs(orgId) })',
        'useQuery({ queryKey: ["users", page], queryFn: () => getUsers(page, filters) })',
      ],
      compliant: [
        'useQuery({ queryKey: ["docs", orgId], queryFn: () => fetchDocs(orgId) })',
        'useQuery({ queryKey: ["users", page, filters], queryFn: () => getUsers(page, filters) })',
      ],
    },
    tags: ['react', 'caching', 'correctness'],
    ecosystems: ['react'],
    requires: { files: ['**/*query*', '**/*Query*'] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Node.js Rules
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'missing-request-validation',
    title: 'Request inputs must be validated with a schema',
    severity: 'error',
    globs: ['**/*.ts', '**/*.js', '!**/*.test.*', '!**/*.spec.*', '!**/test/**', '!**/tests/**', '!**/__tests__/**'],
    instructions: `Request body, query params, and path params must be validated with a runtime schema (Zod, Joi, ArkType, Valibot, etc.) before use in business logic or database queries. TypeScript types are erased at runtime.

Look for:
- \`const { email, name } = req.body\` — destructuring without validation
- \`req.query.page\` used directly in a database query without parsing/validating
- \`req.params.id\` used without validating format
- Type annotations on \`req.body\` (\`req.body as CreateUserInput\`) providing false safety

Exceptions:
- Endpoints behind a gateway or middleware that already validates the schema
- Internal service-to-service calls with established contracts (should have a comment noting where validation happens)`,
    examples: {
      violations: [
        'const { email, name } = req.body;\nawait createUser(email, name);',
        'const page = req.query.page;\nawait db.query("SELECT * FROM items OFFSET ?", [page]);',
      ],
      compliant: ['const { email, name } = CreateUserSchema.parse(req.body);\nawait createUser(email, name);'],
    },
    tags: ['security', 'validation', 'api'],
    ecosystems: ['node'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Go Rules
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'no-goroutine-leak',
    title: 'Goroutines must have a termination path',
    severity: 'error',
    globs: ['**/*.go', '!**/*_test.go'],
    instructions: `Goroutines started with \`go func()\` must have a clear termination path via context cancellation or a done channel.

Look for:
- \`go func() { for { ... } }()\` — infinite loop with no exit condition
- \`go func() { select { case msg := <-ch: ... } }()\` — no \`ctx.Done()\` or done channel case
- \`go func() { for range ticker.C { ... } }()\` — ticker never stopped, goroutine never exits
- Any goroutine without a \`context.Context\` cancellation check or done channel

Exceptions:
- Goroutines in \`main()\` that are intended to run for the process lifetime
- Goroutines with a bounded channel that will close and terminate the range loop`,
    examples: {
      violations: ['go func() {\n  for {\n    msg := <-ch\n    process(msg)\n  }\n}()'],
      compliant: [
        'go func() {\n  for {\n    select {\n    case <-ctx.Done():\n      return\n    case msg := <-ch:\n      process(msg)\n    }\n  }\n}()',
      ],
    },
    tags: ['go', 'concurrency', 'memory-leak'],
    ecosystems: ['go'],
  },
  {
    id: 'go-defer-in-loop',
    title: 'Do not use defer inside a loop',
    severity: 'warning',
    globs: ['**/*.go', '!**/*_test.go'],
    instructions: `\`defer\` inside a \`for\` loop defers execution until the enclosing *function* returns, not until the end of the loop iteration. Resources pile up until the function exits.

Look for:
- \`for _, f := range files { f, _ := os.Open(f); defer f.Close() }\` — all files stay open until function return
- \`for rows.Next() { defer rows.Close() }\` — defer called on every iteration but none execute until function exits
- Any \`defer\` call (Close, Unlock, Cancel) inside a for/range loop

Exceptions:
- Loops with a known small upper bound where resource accumulation is acceptable`,
    examples: {
      violations: ['for _, name := range files {\n  f, _ := os.Open(name)\n  defer f.Close()\n  process(f)\n}'],
      compliant: [
        'for _, name := range files {\n  func() {\n    f, err := os.Open(name)\n    if err != nil { return }\n    defer f.Close()\n    process(f)\n  }()\n}',
      ],
    },
    tags: ['go', 'resources', 'correctness'],
    ecosystems: ['go'],
  },
  {
    id: 'go-http-client-no-timeout',
    title: 'HTTP clients must have a Timeout configured',
    severity: 'warning',
    globs: ['**/*.go', '!**/*_test.go'],
    instructions: `\`http.DefaultClient\` and \`&http.Client{}\` have no timeout by default. A slow or unresponsive upstream will hang the goroutine indefinitely.

Look for:
- \`http.Get(url)\` — uses \`http.DefaultClient\` which has no timeout
- \`http.Post(url, ...)\` — same problem
- \`client := &http.Client{}\` — no Timeout field set
- \`http.DefaultClient.Do(req)\` — explicitly using the default client

Exceptions:
- Long-polling or streaming endpoints where indefinite wait is intentional (should use context cancellation instead)`,
    examples: {
      violations: ['resp, err := http.Get(url)'],
      compliant: ['client := &http.Client{Timeout: 30 * time.Second}\nresp, err := client.Do(req)'],
    },
    tags: ['go', 'reliability', 'timeout'],
    ecosystems: ['go'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Python Rules
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'python-http-no-timeout',
    title: 'HTTP requests must specify a timeout',
    severity: 'warning',
    globs: ['**/*.py', '!**/*test*', '!**/tests/**', '!**/test_*'],
    instructions: `Python's \`requests\` library and \`urllib\` default to no timeout (\`timeout=None\`). A slow or unresponsive server will hang the process indefinitely.

Look for:
- \`requests.get(url)\` / \`requests.post(url, ...)\` without \`timeout=\` parameter
- \`requests.Session()\` calls without a default timeout configured
- \`urllib.request.urlopen(url)\` without \`timeout=\` parameter
- \`httpx.get(url)\` or \`httpx.Client()\` without \`timeout=\` parameter

Exceptions:
- Long-running downloads where a high timeout is explicitly set and documented
- WebSocket or streaming connections that are intentionally long-lived`,
    examples: {
      violations: ['response = requests.get(url)', 'requests.post(url, json=payload)'],
      compliant: ['response = requests.get(url, timeout=30)', 'requests.post(url, json=payload, timeout=30)'],
    },
    tags: ['python', 'reliability', 'timeout'],
    ecosystems: ['python'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Rust Rules
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'rust-blocking-in-async',
    title: 'Do not use blocking std calls in async functions',
    severity: 'warning',
    globs: ['**/*.rs', '!**/tests/**'],
    instructions: `Standard library blocking calls (\`std::fs\`, \`std::net\`, \`std::thread::sleep\`) must not be used inside async functions. They block the async runtime's thread pool, stalling all other tasks on that thread.

Look for:
- \`std::fs::read\`, \`std::fs::write\`, \`std::fs::read_to_string\` inside \`async fn\`
- \`std::thread::sleep\` inside \`async fn\` (should be \`tokio::time::sleep\`)
- \`std::net::TcpStream::connect\` inside async context (should be \`tokio::net::TcpStream\`)
- Any \`std::io::Read\` or \`std::io::Write\` operations in async functions
- \`std::process::Command\` without \`tokio::process::Command\`

Exceptions:
- Application startup code that runs before the async runtime starts
- \`tokio::task::spawn_blocking\` wrapping intentional blocking work`,
    examples: {
      violations: [
        'async fn read_config() -> String {\n    std::fs::read_to_string("config.toml").unwrap()\n}',
        'async fn delay() {\n    std::thread::sleep(Duration::from_secs(1));\n}',
      ],
      compliant: ['async fn read_config() -> String {\n    tokio::fs::read_to_string("config.toml").await.unwrap()\n}'],
    },
    tags: ['rust', 'async', 'performance'],
    ecosystems: ['rust'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SQL / Database Rules
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'missing-transaction-for-multi-write',
    title: 'Multiple writes must be wrapped in a transaction',
    severity: 'error',
    globs: [
      '**/*.ts',
      '**/*.js',
      '**/*.py',
      '**/*.go',
      '**/*.sql',
      '!**/*.test.*',
      '!**/*.spec.*',
      '!**/test/**',
      '!**/tests/**',
    ],
    instructions: `Multiple sequential INSERT, UPDATE, or DELETE operations must be wrapped in a database transaction. Without a transaction, a failure partway through leaves data in an inconsistent state with no automatic rollback.

Look for:
- Two or more sequential write queries without \`BEGIN/COMMIT\` or a transaction wrapper
- \`await db.insert(orders, ...); await db.insert(orderItems, ...);\` — if the second fails, the order exists without items
- \`await db.update(balance, ...); await db.insert(transaction, ...);\` — balance updated but no audit trail
- ORM calls: multiple \`.save()\`, \`.create()\`, \`.update()\` calls without a transaction block

Exceptions:
- Writes that are intentionally independent (e.g., logging + business logic)
- Idempotent operations where partial completion is safe`,
    examples: {
      violations: ['await db.insert(orders).values(order);\nawait db.insert(orderItems).values(items);'],
      compliant: [
        'await db.transaction(async (tx) => {\n  await tx.insert(orders).values(order);\n  await tx.insert(orderItems).values(items);\n});',
      ],
    },
    tags: ['database', 'transactions', 'data-integrity'],
    ecosystems: ['sql'],
  },
  {
    id: 'no-raw-sql-interpolation',
    title: 'Do not interpolate values into raw SQL strings',
    severity: 'error',
    globs: ['**/*.ts', '**/*.tsx', '!**/*.test.*', '!**/*.spec.*', '!**/test/**', '!**/tests/**', '!**/__tests__/**'],
    instructions: `String interpolation in SQL queries creates SQL injection vulnerabilities. Watch for confusion between safe tagged templates and unsafe raw variants.

Look for:
- \`sql.raw(\\\`SELECT * FROM \${table} WHERE id = \${id}\\\`)\` — \`sql.raw\` is explicitly unescaped
- \`Prisma.raw(\\\`...\${userInput}...\\\`)\` — same problem
- \`db.execute(\\\`SELECT * FROM users WHERE name = '\${name}'\\\`)\` — classic template literal injection
- \`"SELECT * FROM users WHERE id = " + id\` — string concatenation

Note: \`sql\\\`SELECT * FROM users WHERE id = \${id}\\\`\` (tagged template without \`.raw\`) IS safe — the tag parameterizes the values.

Exceptions:
- \`sql.raw()\` with hardcoded string literals (no interpolation)
- Dynamic identifiers validated against an explicit allowlist`,
    examples: {
      violations: [
        // biome-ignore lint/suspicious/noTemplateCurlyInString: example code showing template literal patterns
        'sql.raw(`SELECT * FROM ${table} WHERE id = ${id}`)',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: example code showing template literal patterns
        "db.execute(`SELECT * FROM users WHERE name = '${name}'`)",
      ],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: example code showing template literal patterns
      compliant: ['sql`SELECT * FROM users WHERE id = ${id}`', 'db.select().from(users).where(eq(users.id, id))'],
    },
    tags: ['security', 'sql-injection', 'database'],
    ecosystems: ['typescript', 'sql'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Docker Rules
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'pin-docker-base-images',
    title: 'Docker base images must be pinned to a specific version',
    severity: 'warning',
    globs: ['**/Dockerfile*', '**/*.dockerfile', '**/docker-compose*.yml', '**/docker-compose*.yaml'],
    instructions: `\`FROM\` instructions must use a specific version tag or SHA digest, not \`:latest\` or untagged images. Floating tags make builds non-reproducible.

Look for:
- \`FROM node\` — no tag, defaults to \`:latest\`
- \`FROM node:latest\` — explicitly latest, still floating
- \`FROM python:3\` — major version only, minor/patch float
- \`FROM ubuntu:noble\` — codename aliases are also mutable

Exceptions:
- Local development Dockerfiles where latest is intentional and documented`,
    examples: {
      violations: ['FROM node', 'FROM node:latest'],
      compliant: ['FROM node:22.12-alpine', 'FROM python:3.12.1-slim'],
    },
    tags: ['docker', 'reproducibility', 'supply-chain'],
    ecosystems: ['docker'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CI Rules
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'pin-ci-action-versions',
    title: 'CI actions must be pinned to a SHA, not a floating tag',
    severity: 'error',
    globs: ['.github/workflows/**/*.yml', '.github/workflows/**/*.yaml', '.gitlab-ci.yml', '.gitlab-ci/**/*.yml'],
    instructions: `GitHub Actions \`uses\` declarations must reference a full commit SHA, not a floating tag like \`@v4\` or \`@main\`. Floating tags are mutable and represent a supply chain attack vector — a compromised maintainer can force-push to a tag.

Look for:
- \`uses: actions/checkout@v4\` — \`v4\` is a mutable git tag
- \`uses: actions/setup-node@main\` — branch reference, changes constantly
- \`uses: third-party/action@latest\` — explicitly floating
- Any \`uses:\` without a 40-character SHA

Exceptions:
- Actions owned by the same organization as the repository (internal actions)
- Workflow templates or documentation examples`,
    examples: {
      violations: ['uses: actions/checkout@v4', 'uses: actions/setup-node@main'],
      compliant: ['uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1'],
    },
    tags: ['ci', 'supply-chain', 'security'],
    ecosystems: ['ci'],
  },
] as const satisfies StarterRule[];
