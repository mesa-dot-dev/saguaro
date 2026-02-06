# Local Review Agent

> A rules-first, local-first AI code review tool

## Overview

This directory contains the architectural design and specifications for the Mesa Local Review Agent - a complete rethinking of AI code review that prioritizes:

1. **Silence by default** - No output unless a rule is violated
2. **Rules in code** - `.mesa/rules/*.yaml`, version-controlled with git
3. **Local-first** - CLI tool, user provides own API keys
4. **Agent architecture** - Full codebase access, not just diff
5. **MCP-native** - Server for Claude/Cursor, client for context injection

## Documents

### Architecture

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Main architecture document
- **[MIGRATION.md](./MIGRATION.md)** - Migration guide from current Mesa

### Specifications

- **[specs/rule-schema.md](./specs/rule-schema.md)** - Rule file format specification
- **[specs/cli.md](./specs/cli.md)** - CLI interface specification
- **[specs/mcp-integration.md](./specs/mcp-integration.md)** - MCP server/client spec
- **[specs/session-state.md](./specs/session-state.md)** - Session & memory architecture

### Examples

- **[examples/rules/](./examples/rules/)** - Example rule files
  - `rust-time.yaml` - Ban direct wall clock access
  - `rust-services.yaml` - Service spawn pattern
  - `typescript-no-console.yaml` - No console.log in production
  - `react-error-boundaries.yaml` - Require error boundaries
  - `security-no-secrets.yaml` - No hardcoded secrets

## Quick Start (Future)

```bash
# Install
npm install -g @mesa/cli

# Initialize in repo
mesa init

# Create a rule
cat > .mesa/rules/my-rule.yaml << EOF
id: my-rule
title: "My custom rule"
severity: error
globs: ["**/*.ts"]
instructions: |
  Describe what to check for...
EOF

# Run review
mesa review --base main
```

## Design Principles

### 1. Only Speak When Wrong

```
$ mesa review --base main
$ echo $?
0

# (No output. Silence = success.)
```

### 2. No Default Rules

We don't assume what you want to check. You define the rules.

### 3. Rules Are Code

```
.mesa/
+-- rules/
    +-- no-wall-clock.yaml    # Version controlled
    +-- security.yaml         # Reviewed via PR
    +-- architecture.yaml     # Protected by CODEOWNERS
```

### 4. Full Codebase Access

The agent can read any file, grep for patterns, understand context. Not limited to the diff.

### 5. Extensible via MCP

```yaml
# .mesa/config.yaml
mcp:
  servers:
    linear:
      command: "npx @anthropic/mcp-server-linear"
```

## Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Extract Core | 3 days | Portable types, prompts, rules |
| Local Runtime | 5 days | Git context, session, agent |
| CLI & MCP | 3 days | Working CLI and MCP server |
| Polish | 2 days | Tests, docs, examples |
| **Total** | **13 days** | Production-ready |

## Related

- [Request for Product](https://x.com/evanconrad/status/...) - The vision that inspired this
- [MCP Specification](https://modelcontextprotocol.io/) - Model Context Protocol
- [OpenCode SDK](https://github.com/opencode-ai/sdk) - Agent execution framework
