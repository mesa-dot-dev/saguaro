# Mesa Launch Plan

## Core Positioning

**One-liner:** A background code reviewer that makes Claude Code fix its own mistakes — in real time, with zero overhead.

**Tagline:** If you have a coding agent, you have Mesa.

**The pitch in 30 seconds:** Mesa is an open-source background daemon that reviews AI-generated code and feeds findings back to the same agent that wrote it. The agent evaluates the critique — it knows *why* it made those decisions — and self-corrects what's actually wrong. No blocking. No config. No API key. It uses your existing Claude Code / Codex / Gemini subscription. Just `mesa init` and go back to coding.

**The two products:**
1. **Background daemon** (90% of users, zero friction) — headless staff-engineer-quality code review that runs silently alongside your coding agent. No rules to write. No setup beyond `mesa init`. The daemon self-spawns, reviews in the background, and feeds findings back to the agent on the next turn.
2. **Rules engine** (power users, high precision) — version-controlled markdown rules for enforcing specific architectural patterns, security invariants, and team conventions. Deterministic, scoped, and precise.

**Lead with the daemon. Always.**

---

## What Makes the Daemon Different

This is the core argument. It needs to be clear everywhere:

**CodeRabbit / Greptile / etc:**
- Review at the PR level → after the agent is done → context is cold
- Findings go to the human → human has to interpret and fix
- The agent that wrote the code never sees the critique
- Blocks the workflow while reviewing

**Mesa daemon:**
- Reviews in the background during the agent's session → context is hot
- Findings go back to the *same agent that wrote the code*
- The agent evaluates: "I made this decision for X reason, but this review shows a gap in my thinking"
- Agent fixes what's actually wrong, dismisses what isn't — it has the context to judge
- Zero blocking. User doesn't even know Mesa is running until the agent starts fixing things.
- Fewer false positives because the daemon reviewer gets the original agent's context (agent summary)

**The user experience:** You tell Claude "build me a website." Claude starts coding. Mesa reviews in the background (invisible). On the next turn, Claude says "I see some issues with my code, fixing now" and corrects itself. The user only sees the agent being smarter about its own output.

---

## Launch Sequence (48-Hour Cascade)

| Hour | Channel | Purpose |
|------|---------|---------|
| 0 | **Hacker News** (Tue/Wed/Thu, 8-10am ET) | Credibility. Technical audience. Social proof for everything else. |
| 0-6 | HN comment duty | Respond to every comment within 15 minutes. Be technical, honest, specific. |
| 4-6 | **Twitter/X** | Visual proof. Demo video. Standalone — do NOT link to HN post. |
| 12-18 | **Blog post** (mesa.dev → cross-post Medium/dev.to) | Depth. The narrative article. |
| 24-36 | **Reddit** (r/programming, r/ExperiencedDevs) | Broader reach. |
| 36-48 | **Newsletter pitches** (TLDR, Bytes, Console.dev, Changelog) | Sustained traffic. Include HN rank + npm installs as proof. |

---

## Show HN

### Title (pick one)

1. `Show HN: Mesa – Code review CLI that makes Claude Code fix its own mistakes`
2. `Show HN: Mesa – A background daemon that reviews AI-generated code and feeds findings back to the agent`
3. `Show HN: Mesa – Open-source code review that runs alongside your AI coding agent (Apache-2.0)`

### Post Body

```
I've been using Claude Code Max and Codex daily and kept hitting the same problem:
AI quickly ships working code that have real issues: logic errors, security gaps,
subtle regressions. You catch them in review, fix them, but the agent session has
already closed. Doesn't it make sense to have the AI fix its own mistakes 
while it still knows why it made them?

Mesa is a background daemon that reviews AI-generated code and feeds findings
back to the same agent that wrote it. The agent evaluates the critique, it
knows why it made those decisions in the first place, and self-corrects what's actually wrong.

The flow: you tell Claude Code to build something. Claude writes code. Mesa's
stop hook triggers a background review (the user sees nothing). On the next
turn, findings come back to Claude. Claude says "I see some issues with my
approach, fixing now" and corrects itself. No human typed anything. No blocking.

It uses your existing Claude Code / Codex / Gemini subscription. No API key
needed. No external account. Everything runs locally. The daemon self-spawns on
demand and auto-shuts down after 30 minutes of inactivity.

There's also a rules engine for teams that want more deterministic enforcement.
You write rules as markdown files with YAML frontmatter, scoped to specific
file globs. But the daemon works out of the box with zero rules. It reviews
like a senior staff engineer: bugs, security, regressions, dead code. The rules
engine adds more precision for teams/individuals that need it.

Setup is `mesa init` + go back to coding. That's it.

Apache-2.0. TypeScript. ~100 source files.

https://github.com/mesa-dot-dev/code-review
```

### First Comment (post within 1-2 minutes)

```
Hey HN, author here.

The thing that makes this work is where in the loop the review happens.
CodeRabbit, Greptile, etc review at the PR level after the agent is done.
The findings go to a human who has to interpret them. The agent that wrote
the code never sees the critique. Most people just spin up a new agent and
ask "Are these review findings correct?" anyways. 

Mesa reviews during the agent's session and sends findings back to the same
agent. Because the agent still has its full context window, it knows *why*
it made each decision, it can evaluate the findings intelligently. "I made
this choice for X reason, but this review shows a gap in my thinking, let me
fix that." Or: "This finding isn't relevant because of Y." The agent has the
context to make that judgment call. That's why false positives are lower.

The daemon is completely invisible to the user. It self-spawns from the
Claude Code stop hook, runs a SQLite-backed job queue on localhost, and
auto-shuts down after 30 minutes idle. The review happens in the background
while the user keeps working. We feed context from the original programming
session into the review process. The findings surface on the next stop hook,
your agent just starts fixing things.

For teams that want more precision, there's a rules engine: markdown files
with YAML frontmatter that enforce specific patterns (architectural boundaries,
security invariants, etc). But the daemon works with zero rules out of the box.
The rules engine works great for teams with well-defined rules.

Some technical decisions:
- SQLite (via better-sqlite3) as job queue, right amount of infrastructure
  for a local dev tool.
- The daemon reviewer gets the original agent's summary ("the developer
  described their work as...") for context
- Agent gets read-only tools (Read, Glob, Grep) with up to 15 tool calls
  per review, it can inspect the full codebase for context but can't edit.

Limitations:
- The daemon review is async. Findings arrive on the *next* stop hook,
  not the current one. Fast iterations may miss a cycle.
- Review quality depends on the model. We default to your configured
  model but you can override for daemon specifically.
- Cost is your normal AI provider usage. `mesa stats` tracks it.

Happy to answer technical questions about the architecture.
```

### Prepared Answers for HN Questions

**"How is this different from just writing a CLAUDE.md file?"**
> CLAUDE.md is a static suggestion the agent reads at session start. Mesa actively
> reviews the code the agent *already wrote* and gives it specific, contextual
> feedback mid-session. CLAUDE.md says "please follow these patterns." Mesa says
> "you just introduced a bug on line 42, here's what's wrong." Different mechanism
> entirely.

**"How is this different from CodeRabbit / Greptile?"**
> Those tools review at the PR level — after the agent is done, findings go to a
> human. Mesa reviews during the agent's session and sends findings back to the
> agent itself. The agent that wrote the code evaluates the findings (it has the
> context to judge relevance) and self-corrects. It's a fundamentally different
> feedback loop. Also: Mesa is free if you have a coding agent, runs entirely
> locally, and is Apache-2.0.

**"Is this just a prompt wrapper?"**
> The daemon infrastructure is substantial: self-spawning background HTTP server,
> SQLite job queue with diff deduplication (SHA256 hashing), session isolation to
> prevent cross-session contamination, async polling with finding injection on
> next stop hook, read-only tool access (15 turns) for cross-file context,
> recursive hook prevention. The rules engine adds tree-sitter + SWC import
> graphs, blast radius analysis, minimatch glob resolution. ~100 source files.

**"Why not just use ESLint / semgrep?"**
> The daemon doesn't replace linters — it catches the things linters can't: logic
> errors, security gaps, regressions, architectural issues that require understanding
> intent. The rules engine catches semantic patterns: "all API handlers must use
> the centralized auth module." These require understanding code purpose, not syntax.

**"How much does this cost per review?"**
> Zero marginal cost — it uses your existing Claude Code / Codex / Gemini subscription.
> No API key needed. No Mesa billing. If you have a coding agent, you're already
> paying for the compute. `mesa stats` tracks cumulative usage.

**"Doesn't this slow down the agent?"**
> No. The daemon review is fully async. It runs in the background while the user
> keeps working. Findings arrive on the next stop hook. Zero blocking. The user
> doesn't even know Mesa is running until the agent starts fixing things.

---

## Twitter/X

### Strategy

Single tweet with 45-second demo video. GitHub link in the first reply. Thread as backup.

### Hook (pick one)

**Top picks:**
1. "We open-sourced the tool we use to stop Claude Code from slowly destroying our codebase."
2. "We built a background daemon that reviews your AI agent's code and feeds findings back to the agent — it fixes its own mistakes. No human in the loop. No blocking. Open source."
3. "Your AI agent writes code. Nobody reviews it. We built a daemon that does — and the agent fixes its own mistakes in real time."
4. "Code review that happens DURING the agent's session, not after. Findings go back to the same agent. It decides what to fix. Zero overhead. Open source."
5. "Claude Code just fixed its own bug. It didn't know it had one until Mesa told it — silently, in the background, without me doing anything."

### Demo Video Storyboard (45 seconds)

**This is the most important asset of the entire launch.**

The demo should show the INVISIBLE experience — the user doing nothing while the agent self-corrects.

**Beat 1 (0:00-0:08) — The Setup**
Text overlay: "I asked Claude Code to build a feature."
Show: User types a natural prompt like "Add user authentication to the API." Claude starts coding. Multiple files being created/edited. Normal Claude Code experience.

**Beat 2 (0:08-0:15) — The Invisible Review**
Text overlay: "Mesa is reviewing in the background. I don't see anything."
Show: Claude continues working. Maybe a subtle indicator that the daemon is running (or nothing at all — the point is the user doesn't notice). Claude finishes a turn of work.

**Beat 3 (0:15-0:30) — THE MOMENT (agent self-corrects)**
Text overlay: "Claude just got its own code review back."
Show: Claude's next response starts with something like "I see some issues with my implementation — there's a potential SQL injection in the query handler and I'm not properly validating the auth tokens. Fixing now." Claude then starts editing the files it just wrote. The agent is fixing REAL issues (not toy examples) that it introduced moments ago.

This is the holy shit moment. Nobody typed anything. The agent is correcting itself.

**Beat 4 (0:30-0:40) — The Reveal**
Text overlay: "Mesa reviewed. Claude fixed. I did nothing."
Show: The corrected code. Maybe a quick `mesa stats` showing the review happened.

**Beat 5 (0:40-0:45) — The Close**
Text overlay: "Background daemon. Zero config. Open source."
`mesa init` as the install command. GitHub URL. Clean cut.

**Key principle:** The demo is NOT about Mesa's UI. Mesa has no UI in this flow. The demo is about the *absence* of human effort — the agent fixing its own mistakes autonomously.

### Full Thread (if going thread route)

**Tweet 1** (with demo video):
> Claude Code just fixed its own bug.
>
> It didn't know it had one until Mesa reviewed its code — silently, in the background — and fed the findings back.
>
> Claude evaluated the critique, agreed it was valid, and fixed the issue. I didn't type anything.

**Tweet 2:**
> Here's how it works:
>
> You code with Claude / Codex / Gemini like normal. Mesa runs a background daemon that reviews what the agent writes. Findings come back to the same agent on the next turn.
>
> The agent decides what to fix. It has the context — it wrote the code. It knows why.

**Tweet 3:**
> This is different from CodeRabbit, Greptile, etc.
>
> Those review at the PR level. Findings go to a human. The agent never sees them.
>
> Mesa reviews during the session. The agent that wrote the code gets the critique back while context is hot. Fewer false positives. Faster fixes. No human bottleneck.

**Tweet 4:**
> Setup: `mesa init`. That's it.
>
> Uses your existing Claude Code / Codex / Gemini subscription. No API key. No billing. No config.
>
> The daemon self-spawns, reviews in the background, and auto-shuts down when idle. You won't even know it's running.

**Tweet 5:**
> For power users: there's also a rules engine.
>
> Write rules as markdown. Scope them to file globs. Enforce architectural boundaries, security patterns, team conventions.
>
> But the daemon works with zero rules. It reviews like a senior staff engineer out of the box.

**Tweet 6:**
> Just went open source. Apache-2.0.
>
> `npx @mesadev/code-review` to try it.

**First reply:**
> GitHub: [link]
>
> The daemon catches real bugs — logic errors, security gaps, regressions. Not style nits.
>
> If something's broken, open an issue.

### Engagement Plan

- Tag @AnthropicAI, @OpenAI, @GoogleDeepMind in a REPLY, not in the main tweet
- DM 5-10 people with actual relationships BEFORE launch — give early access, ask for honest feedback
- Reply to every technical question in first 2 hours
- 2-3 days after launch: "Show me your worst AI-generated bug and I'll show you Mesa catching it" — interactive challenge

---

## Blog Post

### Title Options

**Primary:** AI Agents Don't Need Pull Requests. They Need Feedback Loops.

**Secondary (dev.to):** Mesa: The Background Code Reviewer That Makes Your AI Agent Fix Its Own Mistakes

### Structure (revised)

```
1. COLD OPEN (150-200 words)
   Callback to the GitHub article.

2. THE GAP (300-400 words)
   Nobody is reviewing AI-generated code in real time.
   Tools that do exist (CodeRabbit, etc) review too late — at the PR level.
   The agent that wrote the code never sees the findings.

3. THE INSIGHT (200-300 words)
   Review should happen DURING the session, not after.
   Findings should go to the AGENT, not the human.
   The agent has context to judge relevance — it wrote the code.

4. THE DAEMON (500-700 words) — LEAD WITH THIS
   Zero-config background review. Self-spawning daemon.
   The exact flow: user prompts → agent writes → daemon reviews (invisible)
   → findings come back → agent self-corrects.
   Show the user experience — agent says "I see issues, fixing now."
   Why this produces fewer false positives (agent context).

5. THE RULES ENGINE (300-400 words) — POWER USER UPGRADE
   For teams that want deterministic enforcement.
   Markdown rules, version controlled, scoped to file globs.
   Show one real rule. Mention auto-generation.

6. THE ECONOMICS (150-200 words)
   Uses existing subscription. No API key. Zero cost.

7. OPEN SOURCE INVITATION (200-300 words)
   Apache-2.0. Local-only. No telemetry.

8. LINKS / CTA BLOCK
```

### The Diagram (revised)

```
Turn 1:
┌────────────┐    ┌─────────────┐
│ User: "Add │───▶│ Claude Code │──── writes code ────┐
│ auth to    │    │ starts      │                      │
│ the API"   │    │ coding      │                      ▼
└────────────┘    └─────────────┘              ┌──────────────┐
                                               │ Mesa daemon  │
                                               │ reviews in   │
                                               │ background   │
Turn 2:                                        │ (invisible)  │
┌─────────────┐                                └──────┬───────┘
│ Claude sees │◀── findings injected ─────────────────┘
│ review      │
│ findings    │
│             │
│ "I see some │
│ issues with │
│ my code,    │
│ fixing now" │
│             │──── self-corrects ────▶ better code
└─────────────┘
```

### Call to Action

**Primary:** Try it.
```bash
npm install -g @mesadev/code-review
mesa init
```
Then go back to Claude Code and start coding. That's it.

---

## Key Messages to Hit Everywhere

These should appear within the first 3 sentences of every piece of content:

1. **The loop:** Agent writes → Mesa reviews in background → agent self-corrects
2. **Zero friction:** No config, no API key, no blocking. Uses your existing subscription.
3. **The agent decides:** Findings go back to the agent that wrote the code — it has context to judge what's real.

## Credibility Signals

- **Dogfooding:** "Mesa reviews itself. Here are the 14 rules we enforce on our own codebase."
- **Zero overhead:** "You won't even know it's running until the agent starts fixing things."
- **Not style nits:** The daemon only flags issues at >80% confidence — bugs, security, regressions.
- **Apache-2.0:** State it early and clearly.
- **No account, no telemetry, no server:** "Everything runs locally. Nothing touches our servers."

## What to Avoid

- Leading with the rules engine (it's friction — lead with the daemon)
- "AI-powered" in titles — overused
- Feature lists before explaining the user experience
- Comparing to CodeRabbit/Greptile by name upfront (explain the difference when asked)
- Asking for GitHub stars directly
- Launching on the same day as a major AI model release
- Using a landing page as the primary link instead of the GitHub repo
- "We're excited to announce..." (press release energy)
- Describing Mesa as "two things" — it's one product with two modes
