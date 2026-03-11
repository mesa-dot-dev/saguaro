<!-- This file is managed by Saguaro. Edit only if you know what you're doing. -->
---
id: agent-env-isolation
title: Agent CLI runners must filter environment variables
severity: warning
globs:
  - src/ai/**/*.ts
  - src/adapter/agents/**/*.ts
  - src/daemon/agent-cli.ts
tags:
  - security
  - agent
  - subprocess
---

When spawning agent CLI processes (Claude, Codex, Gemini), the environment must be explicitly constructed to avoid leaking variables that could interfere with the agent's behavior.

The codebase follows specific patterns:
- `buildClaudeEnv` strips all `CLAUDECODE*` variables and sets `CLAUDE_NO_SOUND=1`
- All agent environments set `SAGUARO_REVIEW_AGENT=1` to let agents detect they're running inside Saguaro

New agent runners must:
1. Not pass `process.env` directly — use a builder function
2. Set `SAGUARO_REVIEW_AGENT=1`
3. Filter out any environment variables that could conflict with the agent's own config

### Violations

```
spawn('claude', args, { env: process.env });
```

```
spawn('codex', args, { env: { ...process.env } });
```

### Compliant

```
spawn('claude', args, { env: buildClaudeEnv(process.env) });
```

```
spawn('codex', args, { env: buildCodexEnv(process.env) });
```
