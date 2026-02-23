# Indexer

The indexer builds an import graph of a repository's source files so the code review agent can understand **blast radius** — which files are affected when a set of files change.

It extracts imports and exports from source files, resolves import paths to repo-relative file paths, and caches the result as `index.json`. At review time, the cached index is used to compute which files import from the changed files via importers-only BFS traversal. The resulting lightweight context map is injected into the LLM prompt as markdown, serving as a **navigation map** that tells the agent where to look with `read_file` rather than a full dependency dump.

**The LLM never parses files directly. It reads pre-computed context.**

## How It Works

```
  1. DISCOVER         2. PARSE              3. RESOLVE           4. CACHE
  ┌──────────┐      ┌──────────────┐      ┌──────────────┐     ┌──────────┐
  │ Walk repo │─────▶│ SWC (TS/JS)  │─────▶│ oxc-resolver │────▶│          │
  │ find files│      │ tree-sitter  │      │ convention   │     │index.json│
  │ by ext    │      │ (Py/Go/Rust/ │      │ resolvers    │     │          │
  └──────────┘      │  Java/Kotlin)│      │ (Py/Go/Rust/ │     └────┬─────┘
                     └──────────────┘      │  Java/Kotlin)│          │
                                           └──────────────┘          │
                                                                     ▼
  5. QUERY (at review time)                              6. FORMAT
  ┌───────────────────┐                                  ┌──────────────┐
  │ Importers-only BFS│─────────────────────────────────▶│ Navigation   │
  │ + barrel detection│                                  │ map for LLM  │
  └───────────────────┘                                  └──────────────┘
```

## File Map

```
indexer/
├── index.ts              Entry point. getCodebaseContext() orchestrates everything.
│                         Builds lightweight navigation map with token budgeting.
├── build.ts              File discovery, incremental hashing, parse + resolve loop.
├── store.ts              JSON persistence + importers-only blast radius BFS + barrel detection.
├── resolver.ts           Module resolution. oxc-resolver for TS/JS, convention-based
│                         for Python/Go/Rust/Java/Kotlin.
├── types.ts              All shared types: CodebaseIndex, FileEntry, ImportRef,
│                         ExportRef, ParseResult, Language.
└── parsers/
    ├── index.ts           Dispatch layer. Routes files to SWC or tree-sitter by extension.
    ├── swc-parser.ts      TS/JS/TSX/JSX parser using @swc/core.
    └── tree-sitter/
        ├── init.ts        WASM runtime init + grammar loading. Lazy, cached, one-time.
        ├── parser.ts      Thin dispatcher: language string → extractor function.
        ├── types.ts       Shared SyntaxNode type + truncate helper.
        └── languages/
            ├── python.ts  Python import/export extraction.
            ├── go.ts      Go import/export extraction.
            ├── rust.ts    Rust import/export extraction.
            ├── java.ts    Java import/export extraction.
            └── kotlin.ts  Kotlin import/export extraction.
```

## Blast Radius

The blast radius BFS starts from changed files and walks **importers only** (files that import from a changed file). Upstream dependencies are excluded — import statements are already visible in the diff, and the agent uses `read_file` to investigate upstream files when needed.

- **Default depth:** 1 (configurable via `index.blast_radius_depth`)
- **Barrel detection:** Index/barrel files (`index.ts`, `mod.rs`, `__init__.py`, etc.) where >50% of exports are re-exports get one extra level of `importedBy` traversal, so the real consumers behind a barrel are included
- **Labels:** `changed` (directly modified) or `importer` (imports from a changed file)

The context format is a lightweight navigation map:
- **Changed files** show exports (excluding re-exports) and `importedBy` list
- **Importer files** show which changed files they import from and which symbols they use

## Key Interfaces

Every parser (SWC and tree-sitter) returns the same shape:

```typescript
interface ParseResult {
  language: Language;
  imports: Omit<ImportRef, 'resolvedPath'>[];  // no resolved paths yet
  exports: ExportRef[];
}
```

Resolution happens separately in `resolver.ts`, which turns raw specifiers into repo-relative paths (or `null` for external packages).

The full indexed entry per file:

```typescript
interface FileEntry {
  contentHash: string;      // SHA-256 for incremental skip
  language: Language;
  imports: ImportRef[];      // now with resolvedPath filled in
  exports: ExportRef[];
  importedBy: string[];      // reverse index, computed during build
}
```

## Language Support

| Language   | Extension(s)  | Parser       | Resolver Strategy              |
|------------|---------------|--------------|--------------------------------|
| TypeScript | .ts, .tsx     | SWC          | oxc-resolver (tsconfig-aware)  |
| JavaScript | .js, .jsx, .mjs, .cjs | SWC | oxc-resolver                   |
| Python     | .py           | tree-sitter  | Convention: `foo.bar` → `foo/bar.py` or `foo/bar/__init__.py` |
| Go         | .go           | tree-sitter  | `go.mod` module prefix stripping |
| Rust       | .rs           | tree-sitter  | `crate::`/`super::`/`self::` → `src/` paths |
| Java       | .java         | tree-sitter  | FQN → `src/main/java/` path   |
| Kotlin     | .kt           | tree-sitter  | FQN → `src/main/kotlin/` path |

## Adding a New Language

1. **Create the extractor** at `parsers/tree-sitter/languages/<lang>.ts`

   Export a single async function:
   ```typescript
   export async function extractFoo(source: string): Promise<ParseResult> {
     const parser = await createParser('foo');
     const tree = parser.parse(source)!;
     try {
       // extract imports + exports from tree.rootNode
       return { language: 'foo', imports, exports };
     } finally {
       tree.delete();
       parser.delete();
     }
   }
   ```

   Use `console.log(tree.rootNode.toString())` to inspect the actual AST — node type names and field names vary per grammar and the docs are often incomplete.

2. **Register the grammar** in `parsers/tree-sitter/init.ts`:
   ```typescript
   const GRAMMAR_FILES: Record<string, string> = {
     // ... existing
     foo: 'tree-sitter-wasms/out/tree-sitter-foo.wasm',
   };
   ```

3. **Register the extractor** in `parsers/tree-sitter/parser.ts`:
   ```typescript
   import { extractFoo } from './languages/foo.js';
   const EXTRACTORS = { /* existing */, foo: extractFoo };
   ```

4. **Register the extension** in `parsers/index.ts`:
   ```typescript
   const TREE_SITTER_EXTENSIONS = { /* existing */, '.foo': 'foo' };
   ```

5. **Add a resolver** in `resolver.ts` (a `resolveFoo` function + add the case in the switch).

6. **Add `'foo'` to the `Language` union** in `types.ts`.

7. **Install the grammar WASM** if not already present:
   ```bash
   # tree-sitter-wasms ships grammars for ~40 languages. Check if yours is included:
   ls node_modules/tree-sitter-wasms/out/tree-sitter-foo.wasm
   ```

8. **Write tests** in `parsers/tree-sitter/languages/__tests__/<lang>.test.ts`. Pattern:
   ```typescript
   import { afterAll, describe, expect, test } from 'bun:test';
   import { resetTreeSitter } from '../../init.js';
   import { extractFoo } from '../foo.js';

   describe('foo extractor', () => {
     afterAll(() => resetTreeSitter());
     // test imports, exports, edge cases
   });
   ```

9. **Bump `CURRENT_VERSION`** in `store.ts` to force re-indexing.

## Pitfalls

- **tree-sitter AST node types are not standardized.** Every grammar has its own node type names and field names. Always inspect with `tree.rootNode.toString()` or check the grammar's `src/node-types.json` on GitHub. Don't trust the plan or docs blindly.

- **`parser.delete()` and `tree.delete()` are required.** tree-sitter uses WASM memory that isn't GC'd. Always use try/finally.

- **Resolvers return `null` for external packages.** This is intentional — we only care about intra-repo dependencies. stdlib, pip packages, npm packages, crates, etc. all resolve to `null` and are excluded from the dependency graph.

- **`ImportRef` has optional JS-specific fields.** `typeSymbols`, `isTypeOnly`, `defaultAlias`, `namespaceAlias` are only set by the SWC parser. Non-JS language extractors don't set them. Any code reading `ImportRef` must handle these being `undefined`.

- **Go exports are capitalization-based, not keyword-based.** `func Serve()` is exported, `func helper()` is not. There's no `pub` or `export` keyword.

- **Rust exports require `pub` visibility.** The extractor checks for a `visibility_modifier` child node.

- **Python treats all top-level definitions as exports.** There's no access modifier — everything at module scope is importable.

- **Incremental indexing uses content hashing.** If a file's SHA-256 hash matches the cached index, it's skipped entirely. Changing the parser logic won't re-parse existing files unless you bump `CURRENT_VERSION` in `store.ts`.

- **The version number in `store.ts` must match `types.ts`.** `CURRENT_VERSION` and the `version` literal type in `CodebaseIndex` must agree. Mismatches cause the index to be silently discarded and rebuilt.

## Running Tests

```bash
# All indexer tests
bun run test src/indexer/

# Specific language
bun run test src/indexer/parsers/tree-sitter/languages/__tests__/python.test.ts

# Dispatch routing
bun run test src/indexer/parsers/__tests__/dispatch.test.ts

# Integration (builds a temp repo and indexes it)
bun run test src/indexer/__tests__/integration.test.ts
```
