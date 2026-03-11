# Saguaro Rebrand Design Spec

**Date:** 2026-03-11
**Status:** Approved

## Context

The `mesa-dot-dev/code-review` repository contains an AI-powered code review CLI tool currently branded as "Mesa". Before open-sourcing, the product is being rebranded to **Saguaro**. Mesa remains the company name; Saguaro is the product name.

## Naming Convention

| Context | Old Value | New Value |
|---|---|---|
| Product name (prose) | Mesa / Mesa CLI | Saguaro |
| CLI binary | `mesa` | `sag` |
| npm package | `@mesadev/code-review` | `@mesadev/saguaro` |
| Config directory | `.mesa/` | `.saguaro/` |
| MCP server name | `mesa` | `saguaro` |
| MCP tools | `mesa_*` | `saguaro_*` |
| Slash commands | `/mesa-*` | `/saguaro-*` |
| Env vars | `MESA_*` | `SAGUARO_*` |
| TypeScript types | `Mesa*` | `Saguaro*` |
| Homebrew formula | `brew install mesa-dot-dev/homebrew-tap/code-review` | `brew install mesa-dot-dev/homebrew-tap/saguaro` |
| GitHub repo | `mesa-dot-dev/code-review` | `mesa-dot-dev/saguaro` |
| Log prefixes | `[mesa-daemon]`, `[Mesa]`, `[mesa-mcp]` | `[saguaro-daemon]`, `[Saguaro]`, `[saguaro-mcp]` |
| Error class | `MesaError` | `SaguaroError` |
| Build define | `__MESA_VERSION__` | `__SAGUARO_VERSION__` |

### What stays the same

- GitHub org: `mesa-dot-dev` (company name)
- npm scope: `@mesadev` (company name)
- Domain: `mesa.dev` (company domain)
- `docs/launch/` content (will be rewritten separately — note: these files DO contain "Mesa" product references that are intentionally deferred)
- Eval fixture data: `MESA-` ticket patterns in `evals/rubrics/discipline-01.json` are test data simulating a hypothetical team's ticket prefix — do NOT rename

## Scope

~400+ references across ~90+ files. The changes are mechanical find-and-replace with the following categories:

### 1. Package Identity

- `package.json`: name (`@mesadev/saguaro`), binary (`sag`), homepage, keywords
- Homebrew formula template (`formula-code-review.rb.tmpl`): description, binary name, symlinks
- `install.sh`: repo name, binary name, install paths
- `.github/workflows/release.yml`: tag names, tarball names, binary names, `--define __MESA_VERSION__`, Homebrew tap references, CI bot email/name
- `scripts/brew-verify.sh`: package name, `__MESA_VERSION__` reference
- `scripts/postinstall.cjs`: "Mesa post-install warnings" and "Mesa will still work" messages

### 2. Core Constants & Paths

- Config directory: `.mesa/` → `.saguaro/` (hardcoded in ~60 places)
- Env vars:
  - `MESA_CONFIG` → `SAGUARO_CONFIG`
  - `MESA_INSTALL_DIR` → `SAGUARO_INSTALL_DIR`
  - `MESA_REVIEW_AGENT` → `SAGUARO_REVIEW_AGENT` (used in agent-runner.ts, hook.ts, agent-cli.ts + tests — prevents recursive review loops)
- Build-time define: `__MESA_VERSION__` → `__SAGUARO_VERSION__` (declared in cli/commands/index.ts, injected in release.yml and brew-verify.sh)
- Database path: `~/.mesa/reviews.db` → `~/.saguaro/reviews.db`
- Daemon paths: `~/.mesa/daemon.pid`, `~/.mesa/daemon.lock` → `~/.saguaro/` equivalents (server.ts, hook-client.ts)
- History path: `.mesa/history/` → `.saguaro/history/`
- Cache path: `.mesa/cache/` → `.saguaro/cache/`
- Rules path: `.mesa/rules/` → `.saguaro/rules/`
- `.gitignore`: `.mesa/.tmp/`, `.mesa/history/`, `.mesa/config.yaml` → `.saguaro/` equivalents
- `.npmignore`: `.mesa/` → `.saguaro/`
- `REVIEW_NOISE_DIRS` in hook.ts: `.mesa` → `.saguaro`
- `SKIP_DIRS` in indexer/constants.ts: `.mesa` → `.saguaro`

### 3. Source Code (~50+ TypeScript files)

- Rename `src/rules/mesa-rules.ts` → `src/rules/saguaro-rules.ts`
- Update all types: `MesaRuleFile` → `SaguaroRuleFile`, `MesaRuleParseError` → `SaguaroRuleParseError`, `MesaRulesResult` → `SaguaroRulesResult`, `MesaConfig` → `SaguaroConfig` (Zod-inferred type — also rename `MesaConfigSchema`), `MesaError` → `SaguaroError`, `MesaErrorCode` → `SaguaroErrorCode`
- Update functions (complete list):
  - `getMesaRulesDir()` → `getSaguaroRulesDir()`
  - `writeMesaRuleFile()` → `writeSaguaroRuleFile()`
  - `deleteMesaRuleFile()` → `deleteSaguaroRuleFile()`
  - `parseMesaRuleFile()` → `parseSaguaroRuleFile()`
  - `loadMesaRulesFromDir()` → `loadSaguaroRulesFromDir()`
  - `buildMesaRuleMarkdown()` → `buildSaguaroRuleMarkdown()`
  - `isMesaOnPath()` → `isSaguaroOnPath()`
  - `resolveMesaConfigPath()` → `resolveSaguaroConfigPath()`
  - `resolveMesaSubcommand()` → `resolveSaguaroSubcommand()`
  - `resolveMesaSubcommandParts()` → `resolveSaguaroSubcommandParts()`
  - `isMesaHookEntry()` → `isSaguaroHookEntry()`
  - `isMesaPreToolEntry()` → `isSaguaroPreToolEntry()`
  - `ensureMesaGitignore()` → `ensureSaguaroGitignore()`
  - `createMesaMcpServer()` → `createSaguaroMcpServer()`
- Update constants: `MESA_RULES_DIR` → `SAGUARO_RULES_DIR`, `MESA_DIR` → `SAGUARO_DIR`, `MESA_NOTIFY_RE` → `SAGUARO_NOTIFY_RE`
- Update variables: `mesaDir` → `saguaroDir`, `mesaCacheDir` → `saguaroCacheDir`
- MCP server name: `'mesa'` → `'saguaro'`
- MCP tool names: all 10 `mesa_*` tools → `saguaro_*`
- ASCII art banner in cli/commands/index.ts: replace "Mesa" banner with "Saguaro" banner
- Log prefixes: `[mesa-daemon]` → `[saguaro-daemon]`, `[Mesa]` → `[Saguaro]`, `[mesa-mcp]` → `[saguaro-mcp]` (20+ locations)
- Debug log filename: `'mesa-mcp-debug.log'` → `'saguaro-mcp-debug.log'`
- User-facing strings: `'Mesa review -- fix valid issues...'` → `'Saguaro review...'`, `'This file is managed by Mesa.'` → `'This file is managed by Saguaro.'`
- Error class: `this.name = 'MesaError'` → `this.name = 'SaguaroError'` in errors.ts
- `ensureMesaGitignore()` output: writes `.mesa/config.yaml` and `.mesa/history/` into user gitignores — must write `.saguaro/` equivalents
- Binary detection: `execFileSync('which', ['mesa'])` → `execFileSync('which', ['sag'])` in resolve-bin.ts and related files
- All string literals, comments, and debug log references

### 4. CLI Command

- Binary name in `package.json`: `mesa` → `sag`
- All CLI help text, usage examples, error messages
- CLI command references in source and docs
- Hook commands: `"mesa hook pre-tool"` → `"sag hook pre-tool"`, `"mesa hook run"` → `"sag hook run"`

### 5. Slash Commands & Skills (8 directories)

- Rename `.claude/skills/mesa-review/` → `.claude/skills/saguaro-review/`
- Rename `.claude/skills/mesa-createrule/` → `.claude/skills/saguaro-createrule/`
- Rename `.claude/skills/mesa-generaterules/` → `.claude/skills/saguaro-generaterules/`
- Rename `.claude/skills/mesa-model/` → `.claude/skills/saguaro-model/`
- Same for `.gemini/skills/` equivalents
- Update SKILL.md content in each
- Update `.claude/settings.json`: hook commands (`mesa` → `sag`), status message (`"Mesa: reviewing changes..."` → `"Saguaro: reviewing changes..."`)
- Update `.gemini/settings.json`: same hook command updates

### 6. Documentation (skip `docs/launch/`)

- README.md
- CHANGELOG.md
- CONTRIBUTING.md
- RELEASING.md
- docs/ARCHITECTURE.md
- docs/writing-rules.md
- src/daemon/ARCHITECTURE.md

### 7. Silent Migration

Add a utility that runs early in CLI startup:

1. **Stop running daemon** — check if daemon is running (via pid file) and stop it before renaming to avoid corruption
2. **Rename home directory** — if `~/.mesa/` exists and `~/.saguaro/` does not, rename it
3. **Rename project directory** — if `.mesa/` exists in project root and `.saguaro/` does not, rename it
4. **Update user .gitignore** — replace `.mesa/` entries with `.saguaro/` equivalents
5. **Update .claude/settings.json** — replace `mesa` binary references with `sag`
6. **Update .gemini/settings.json** — same
7. **Update .mcp.json** — replace `"command": "mesa"` with `"command": "sag"`
8. **Idempotency** — if `.saguaro/` already exists, skip directory rename (do not clobber). If both `.mesa/` and `.saguaro/` exist, skip and log a warning.
9. **Logging** — print a message for each action taken (e.g., "Migrated .mesa/ to .saguaro/")

### 8. Tests

- Update all test files with mesa references
- Rename any test fixtures using mesa naming
- Ensure all tests pass after rebrand

### 9. Evals

- Update `evals/run.ts`: "Mesa Eval Runner" → "Saguaro Eval Runner"
- Update `<!-- This file is managed by Mesa. -->` comments in eval rule markdown files
- Do NOT rename `MESA-` ticket patterns in eval fixture/rubric data (these are intentional test data)

### 10. Config Directory `.mesa/rules/`

- Rename the rule file `.mesa/rules/mesa-error-subclass-usage.md` → `.saguaro/rules/saguaro-error-subclass-usage.md`
- Rename `.mesa/` → `.saguaro/` at the repo root
- Update `.mesa/config.yaml` header comment
- Update `<!-- This file is managed by Mesa. -->` comments in all 14 rule files

### 11. Public API Exports

`src/index.ts` exports all `Mesa*` types and functions. Since the npm package name is also changing (`@mesadev/code-review` → `@mesadev/saguaro`), all consumers must update imports anyway. No compatibility re-exports needed — clean break.

## Out of Scope

- `docs/launch/` — left as-is, will be rewritten separately
- `MESA-` ticket patterns in eval test fixtures — intentional test data
- No backwards compatibility shims beyond the silent migration
- No deprecation period — clean cut
