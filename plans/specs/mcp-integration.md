# MCP Integration Specification

**Version:** 1.0  
**Status:** Draft

---

## Overview

Mesa integrates with the Model Context Protocol (MCP) in two ways:

1. **As an MCP Server** - Exposes tools for Claude, Cursor, and other MCP clients
2. **As an MCP Client** - Connects to external context providers (Linear, Notion, etc.)

This enables:
- Claude/Cursor to invoke Mesa reviews as a tool
- Mesa to fetch context from project management tools during review

---

## Mesa as MCP Server

### Purpose

Allow AI coding assistants (Claude, Cursor, etc.) to:
- Run code reviews on demand
- Check specific rules
- Query available rules

### Starting the Server

```bash
# HTTP transport (for remote/network access)
mesa serve --port 3000

# stdio transport (for direct integration)
mesa serve --stdio
```

### Available Tools

#### `mesa_review`

Run a full code review against defined rules.

**Parameters:**
```typescript
{
  base_branch?: string;  // Default: "main"
  output?: "json" | "text";  // Default: "json"
}
```

**Returns:**
```typescript
{
  violations: Violation[];
  summary: {
    files_reviewed: number;
    rules_checked: number;
    errors: number;
    warnings: number;
  };
}
```

**Example invocation (from Claude):**
```
"Review my current changes against our team's rules"

-> Calls mesa_review({ base_branch: "main" })
-> Returns violations or empty array
```

---

#### `mesa_check_rule`

Check if specific code violates a rule.

**Parameters:**
```typescript
{
  rule_id: string;   // Required
  code: string;      // Required - code to check
  file_path?: string;  // Optional - for context
}
```

**Returns:**
```typescript
{
  violates: boolean;
  message?: string;
  suggestion?: string;
}
```

**Example:**
```
"Does this code violate our no-wall-clock rule?"
let now = Utc::now();

-> Calls mesa_check_rule({ 
     rule_id: "no-wall-clock", 
     code: "let now = Utc::now();" 
   })
-> Returns { violates: true, message: "Direct wall clock access...", suggestion: "..." }
```

---

#### `mesa_list_rules`

List all available rules.

**Parameters:**
```typescript
{
  tags?: string[];  // Optional - filter by tags
}
```

**Returns:**
```typescript
{
  rules: Array<{
    id: string;
    title: string;
    severity: "error" | "warning" | "info";
    tags: string[];
  }>;
}
```

---

#### `mesa_explain_rule`

Get detailed information about a specific rule.

**Parameters:**
```typescript
{
  rule_id: string;  // Required
}
```

**Returns:**
```typescript
{
  id: string;
  title: string;
  severity: string;
  instructions: string;
  globs: string[];
  examples?: {
    violations?: string[];
    compliant?: string[];
  };
}
```

---

### MCP Server Configuration

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mesa": {
      "command": "npx",
      "args": ["mesa", "serve", "--stdio"],
      "env": {
        "ANTHROPIC_API_KEY": "your-key-here"
      }
    }
  }
}
```

For Cursor, configure in settings.

---

## Mesa as MCP Client

### Purpose

Allow the Mesa review agent to fetch external context during reviews:
- Linear issues linked to PRs
- Notion RFCs and ADRs
- Custom documentation

### Configuration

MCP servers are configured in `.mesa/config.yaml`:

```yaml
mcp:
  servers:
    # Linear integration
    linear:
      command: "npx"
      args: ["@anthropic/mcp-server-linear"]
      env:
        LINEAR_API_KEY: "${LINEAR_API_KEY}"
    
    # Notion integration  
    notion:
      command: "npx"
      args: ["@anthropic/mcp-server-notion"]
      env:
        NOTION_API_KEY: "${NOTION_API_KEY}"
    
    # Custom MCP server
    internal-docs:
      command: "/usr/local/bin/docs-mcp-server"
      args: ["--config", "/etc/docs-mcp.yaml"]
```

### How Context is Used

During review, the agent can call MCP tools to gather context:

```
Agent thinking:
  "The branch name mentions LIN-1234. Let me look up that Linear issue
   to understand the requirements..."
  
  -> Calls linear.get_issue({ id: "LIN-1234" })
  -> Gets issue description, acceptance criteria
  
  "Now I understand what this change is supposed to do. Let me review
   against the rules with this context..."
```

### Available Context (Examples)

#### Linear MCP Server

```typescript
// Tools available when Linear MCP is configured
linear.get_issue({ id: string })
linear.get_project({ id: string })
linear.search_issues({ query: string })
```

#### Notion MCP Server

```typescript
// Tools available when Notion MCP is configured
notion.get_page({ id: string })
notion.search({ query: string })
notion.get_database({ id: string })
```

---

## Tool Schemas

### Mesa Server Tools (JSON Schema)

```json
{
  "tools": [
    {
      "name": "mesa_review",
      "description": "Run a code review against defined rules. Returns violations found in the current changes.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "base_branch": {
            "type": "string",
            "description": "Branch to diff against",
            "default": "main"
          },
          "output": {
            "type": "string",
            "enum": ["json", "text"],
            "default": "json"
          }
        }
      }
    },
    {
      "name": "mesa_check_rule",
      "description": "Check if specific code violates a rule",
      "inputSchema": {
        "type": "object",
        "required": ["rule_id", "code"],
        "properties": {
          "rule_id": {
            "type": "string",
            "description": "ID of the rule to check"
          },
          "code": {
            "type": "string",
            "description": "Code snippet to check"
          },
          "file_path": {
            "type": "string",
            "description": "Optional file path for context"
          }
        }
      }
    },
    {
      "name": "mesa_list_rules",
      "description": "List all available rules",
      "inputSchema": {
        "type": "object",
        "properties": {
          "tags": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Filter rules by tags"
          }
        }
      }
    },
    {
      "name": "mesa_explain_rule",
      "description": "Get detailed information about a specific rule",
      "inputSchema": {
        "type": "object",
        "required": ["rule_id"],
        "properties": {
          "rule_id": {
            "type": "string",
            "description": "ID of the rule to explain"
          }
        }
      }
    }
  ]
}
```

---

## Agent Workflow with MCP

```
+-------------------+     +-------------------+     +-------------------+
|   User Request    |     |   Mesa Agent      |     |  External MCP     |
|                   |     |                   |     |  Servers          |
+--------+----------+     +--------+----------+     +--------+----------+
         |                         |                         |
         | "Review my changes"     |                         |
         +------------------------>|                         |
         |                         |                         |
         |                         | Get branch info         |
         |                         | (mentions LIN-1234)     |
         |                         |                         |
         |                         | linear.get_issue()      |
         |                         +------------------------>|
         |                         |                         |
         |                         |<------------------------+
         |                         | Issue: "Add rate limit  |
         |                         |         to /api/users"  |
         |                         |                         |
         |                         | Load rules              |
         |                         | View diff               |
         |                         | Check each rule         |
         |                         |                         |
         |                         | Found violation:        |
         |                         | rate-limit rule not     |
         |                         | satisfied               |
         |                         |                         |
         |<------------------------+                         |
         | Violation: Missing      |                         |
         | rate limiting per       |                         |
         | LIN-1234 requirements   |                         |
         |                         |                         |
```

---

## Security Considerations

### API Keys

- Never commit API keys to the repository
- Use environment variables: `${VAR_NAME}` syntax in config
- Keys are resolved at runtime

```yaml
# .mesa/config.yaml - Safe
mcp:
  servers:
    linear:
      env:
        LINEAR_API_KEY: "${LINEAR_API_KEY}"  # Resolved from environment
```

### MCP Server Trust

- Only configure MCP servers you trust
- MCP servers have access to information the agent requests
- Review what tools each MCP server provides

### Network Access

- Mesa as MCP server: Consider firewall rules for --port mode
- Mesa as MCP client: Servers run as subprocesses with configured commands

---

## Example: Full Integration

### Scenario

A developer working in Cursor wants to:
1. Have Claude review their changes
2. With context from Linear (linked issue)
3. Against team-defined rules

### Setup

**1. Configure Mesa rules:**
```yaml
# .mesa/rules/rate-limiting.yaml
id: require-rate-limiting
title: "API endpoints must have rate limiting"
severity: error
globs: ["**/routes/**/*.ts", "**/api/**/*.ts"]
instructions: |
  All API endpoints must implement rate limiting.
  Check for rateLimit middleware or similar.
```

**2. Configure MCP context:**
```yaml
# .mesa/config.yaml
model:
  provider: anthropic
  name: claude-sonnet-4-20250514

mcp:
  servers:
    linear:
      command: "npx"
      args: ["@anthropic/mcp-server-linear"]
      env:
        LINEAR_API_KEY: "${LINEAR_API_KEY}"
```

**3. Configure Claude Desktop:**
```json
{
  "mcpServers": {
    "mesa": {
      "command": "npx",
      "args": ["mesa", "serve", "--stdio"],
      "env": {
        "ANTHROPIC_API_KEY": "...",
        "LINEAR_API_KEY": "..."
      }
    }
  }
}
```

### Usage

In Cursor/Claude:

```
User: "Review my changes for the rate limiting feature (LIN-1234)"

Claude:
  1. Calls mesa_review({ base_branch: "main" })
  2. Mesa agent internally:
     - Sees branch: feature/rate-limiting-LIN-1234
     - Calls linear.get_issue({ id: "LIN-1234" })
     - Gets requirements: "Add rate limit of 100 req/min to /api/users"
     - Loads rules (require-rate-limiting matches)
     - Checks diff against rules
     - Finds: rate limiting implemented but limit is 1000 not 100
  3. Returns violation with context

Claude to User:
  "I found one issue. The rate limit is set to 1000 requests/minute,
   but LIN-1234 specifies it should be 100 requests/minute."
```

---

## Implementation Notes

### MCP SDK

Use the official MCP SDK:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'mesa',
  version: '1.0.0',
});

// Register tools
server.tool('mesa_review', reviewSchema, async (params) => {
  // Implementation
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Client Connection

For connecting to external MCP servers:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

// Spawn MCP server process
const proc = spawn('npx', ['@anthropic/mcp-server-linear']);

const transport = new StdioClientTransport({
  reader: proc.stdout,
  writer: proc.stdin,
});

const client = new Client({ name: 'mesa', version: '1.0.0' });
await client.connect(transport);

// Call tools
const result = await client.callTool('get_issue', { id: 'LIN-1234' });
```
