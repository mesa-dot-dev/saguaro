# AI Agents Don't Need Pull Requests. They Need Feedback Loops.

A few months ago, we published a piece arguing that GitHub's pull request model is breaking under AI-generated code. It struck a nerve. The responses fell into two camps. The first: "This is exactly what's happening on my team." The second: "Okay, so what's the alternative?"

This post is our answer to the second camp.

---

## The Review Gap

Anthropic reports that 70-90% of its code is AI-generated. Google is at 25%. Microsoft is at 30% and climbing. These aren't projections. These are earnings calls.

The code is fine. It compiles, it passes tests, it handles edge cases. But it also introduces logic errors that a second pair of eyes would catch. It misses security implications that aren't in the prompt. It creates subtle regressions because it doesn't know the full history of why things are the way they are.

Today, the tools that review AI-generated code — CodeRabbit, Greptile, and the rest — all operate at the pull request level. The agent writes code. It gets merged. A reviewer comments. A human reads the comments. The human makes the fixes.

The problem with this model isn't speed. It's that the agent that wrote the code never sees the critique. By the time findings surface in a PR review, the agent's session is over. The context window that held the reasoning — why it chose that approach, what tradeoffs it considered, what it was trying to accomplish — is gone.

The human reviewer is now looking at a diff without the reasoning that produced it. And the volume of AI-generated changes has already outpaced the volume of human attention available to review them.

---

## The Insight

What if the code review didn't happen after the PR? What if it happened during the agent's session — while the context window still held the reasoning?

And what if the findings didn't go to a human? What if they went back to the same agent that wrote the code?

Think about what that agent can do with a code review that a human can't: it knows *why* it made every decision. When it sees "potential SQL injection on line 42," it can evaluate: "I made this choice because the input is already sanitized upstream — wait, actually, it isn't in this code path. Valid finding, fixing now." Or: "This finding isn't relevant because I'm using a parameterized query builder." The agent has the context to make that judgment call.

This is the feedback loop that doesn't exist yet. Review that happens alongside generation. Findings that go to the writer, not a third party. Self-correction by the entity that has the most context to evaluate what's actually wrong.

That's what we built.

---

## Mesa

Mesa is an open-source background daemon that reviews AI-generated code and feeds findings back to the same agent that wrote it.

Here's what it looks like in practice:

```
Turn 1:
  You: "Add user authentication to the API."
  Claude Code: writes auth handlers, middleware, token logic
  Mesa: (invisible) reviews in background

Turn 2:
  Claude Code: "I see some issues with my implementation —
  there's a potential SQL injection in the query handler and
  I'm not validating auth tokens on the admin routes. Fixing now."

  → Claude self-corrects. You typed nothing.
```

You didn't configure anything. You didn't write any rules. You didn't even know Mesa was running. The agent just got smarter about its own output.

### How It Works

When you run `mesa init`, Mesa installs as a Claude Code hook. From that point on:

1. **You tell Claude to build something.** Normal prompt. Nothing different.
2. **Claude writes code.** Normal Claude Code experience.
3. **Stop hook fires.** Mesa diffs the changes and queues a background review with the daemon. This happens invisibly — no spinner, no blocking, no indication to the user.
4. **Daemon reviews.** A background process (local HTTP server, SQLite job queue) reviews the changes like a senior staff engineer. It gets the agent's own summary of what it was building for context. It can read files across the codebase (up to 15 tool calls) to understand the full picture.
5. **Next turn.** When Claude finishes its next piece of work and the stop hook fires again, Mesa checks for completed reviews. If there are findings, they're injected into Claude's context.
6. **Agent self-corrects.** Claude sees the findings, evaluates them against its own reasoning, and fixes what's actually wrong. It dismisses what isn't relevant — it has the context to judge.

The daemon only flags issues where it's >80% confident they're real problems. No style nits. No formatting opinions. No "consider renaming this variable." Bugs, security gaps, regressions, dead code, performance issues. If nothing is wrong, silence.

The daemon self-spawns on demand and auto-shuts down after 30 minutes of inactivity. SQLite handles the job queue. Diff deduplication via SHA256 hashing ensures the same code is never reviewed twice. A `MESA_REVIEW_AGENT` environment variable prevents recursive hook triggering. The infrastructure is minimal by design — it's a local dev tool, not a service.

### Why False Positives Are Lower

This is the part that's hard to explain without seeing it, but easy to understand once you do.

When CodeRabbit reviews a PR, it sees a diff. That's it. It doesn't know what the developer was trying to do, what constraints they were working under, or what tradeoffs they considered.

When Mesa's daemon reviews, it gets the original agent's summary: "The developer described their work as: adding JWT-based authentication with refresh token rotation." Combined with read-only access to the full codebase, the reviewer has meaningful context about intent, not just the diff.

And when the findings go back to the original agent, that agent can evaluate them with full context. A human reviewer might see "potential null pointer" and flag it. The original agent knows that the value is guaranteed non-null by the validation layer it set up three files ago. The feedback loop is tighter and smarter at both ends.

---

## The Rules Engine (Power Users)

The daemon works out of the box with zero configuration. But teams that want deterministic enforcement of specific patterns can write rules.

Mesa rules are markdown files with YAML frontmatter, stored in `.mesa/rules/`:

```markdown
---
id: adapter-as-boundary-layer
title: CLI and MCP must use the adapter layer
severity: warning
globs:
  - "src/cli/**/*.ts"
  - "src/mcp/**/*.ts"
---

CLI handlers and MCP tools must import from `src/adapter/`, never directly
from implementation modules like `src/ai/`, `src/daemon/`, or `src/indexer/`.

### Violations

​```typescript
import { runReviewAgent } from '../../ai/sdk-reviewer';
​```

### Compliant

​```typescript
import { runReview } from '../../adapter/review';
​```
```

Rules have globs for file matching, severity levels, and violation/compliant examples that teach the reviewing AI exactly what you mean. Mesa matches changed files against rules using minimatch and injects relevant rules before the agent writes code (PreToolUse hook) and validates after (Stop hook).

You can write rules manually, or let Mesa generate them: `mesa rules generate` scans your codebase and proposes rules that reflect actual patterns in your code. We use this on our own codebase — Mesa reviews Mesa, with 14 rules covering architectural boundaries, security patterns, and serialization conventions.

The rules engine runs inline alongside the daemon. Both can operate independently. Together, you get the broad coverage of a senior staff engineer review plus the precision of deterministic rule enforcement.

---

## What It Costs

Nothing, if you already have a coding agent.

Mesa uses your existing Claude Code, Codex, or Gemini subscription. No API key needed. No Mesa account. No billing dashboard. No surprise invoices. Everything runs locally. Nothing touches our servers.

If you have a coding agent, you have Mesa.

---

## Why Open Source

Mesa is Apache-2.0. No proprietary server, no hosted component, no telemetry. Your code goes to the AI provider you already use. We have no servers to send it to even if we wanted to.

We're open-sourcing this because the "AI code review" layer is going to exist — it has to, given the volume of AI-generated code. The question is whether it's an open standard that works with any provider and lives on your machine, or a vendor-locked feature inside one platform. We're building the open version.

---

## Try It

```bash
npm install -g @mesadev/code-review
mesa init
```

Then go back to Claude Code and start coding. That's it.

Mesa wires up the hooks, spawns the daemon on demand, and starts reviewing in the background. The first time Claude finishes a task, Mesa reviews it. The next time Claude speaks, it'll start fixing things you didn't even know were wrong.

That's the moment you'll get it.

**GitHub:** https://github.com/mesa-dot-dev/code-review

If you find a bug, open an issue. If you have a rule idea, open a PR. The best rules will come from the community, not from us.

---

*We wrote about [why GitHub's PR model is breaking](link). Then we built the fix.*
