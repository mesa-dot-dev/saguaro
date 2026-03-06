---
name: mesa-generaterules
description: Auto-generate Mesa review rules using the full AI pipeline with approval before writing
---
## Important — Two-Phase Data Model

`mesa_generate_rules` returns **compact summaries only** (id, title, severity, globs) to stay within tool output limits. Full rule details (instructions, examples) are held in server session state.

- To inspect full rule details, call `mesa_get_generated_rule_details` with an array of rule IDs.
- To write rules to disk, call `mesa_write_accepted_rules` with an array of rule IDs.

Both tools read from the same session state populated by `mesa_generate_rules`. Do NOT call `mesa_generate_rules` again — it would overwrite the session.

## Flow

1. **Start the pipeline** — Call the `mesa_generate_rules` MCP tool.
   Tell the user this runs a multi-stage pipeline (codebase scanning, import graph indexing, LLM analysis, consolidation/dedup) and takes a few minutes depending on the size of the codebase.

2. **Present summary** — When the tool returns, show:
   - Files scanned
   - Rules generated
   - Duration
   Do NOT list individual rules here — the list is too long and users don't want to scroll.

3. **Choose review mode** — Use `AskUserQuestion` with structured options (NOT a free-text question):

   ```
   AskUserQuestion({
     questions: [{
       question: "How would you like to review the generated rules?",
       header: "Review mode",
       options: [
         { label: "Bulk review by group (Recommended)", description: "Group rules by package/domain and accept or skip entire groups at a time" },
         { label: "Accept all", description: "Create all rules as-is without individual review" },
         { label: "Review individually", description: "Go through each rule one by one for Accept/Skip/Edit decisions" },
         { label: "Skip all", description: "Discard all generated rules" }
       ],
       multiSelect: false
     }]
   })
   ```

4. **Execute the chosen review mode:**

   **If "Accept all":** Proceed directly to writing all rules.

   **If "Bulk review by group":** Group rules by their target area based on glob patterns (e.g., all rules with `packages/web/**` globs form a "Web Package" group). Present a single compact table with one row per group showing: group name and rule count. Do NOT list individual rules within each group. Then use `AskUserQuestion` with `multiSelect: true` to let the user select which groups to accept. All rules in non-selected groups are skipped.

   **If "Review individually":**
   - Call `mesa_get_generated_rule_details` with no arguments to get the next batch of 10 rules. The server tracks position automatically — just keep calling it for each batch.
   - For each rule in the batch, present: **Title**, **ID**, **severity**, **Globs**, **Instructions** (the full rule body), **Examples** (if present).
   - Then use `AskUserQuestion` with structured options:

     ```
     AskUserQuestion({
       questions: [{
         question: "What would you like to do with this rule?",
         header: "Decision",
         options: [
           { label: "Accept", description: "Mark this rule for creation" },
           { label: "Skip", description: "Discard this rule" },
           { label: "Accept all remaining", description: "Accept this and all remaining rules, stop reviewing" },
           { label: "Edit", description: "Modify fields before accepting" }
         ],
         multiSelect: false
       }]
     })
     ```
   - Repeat for each batch until all rules have been reviewed.

   **If "Skip all":** Discard everything and confirm.

5. **Write accepted rules** — Collect the IDs of all accepted rules, then call `mesa_write_accepted_rules` once with the full list of accepted rule IDs. The server writes them using the same deterministic codepath as the CLI (scope computed from globs, skill files created). Do NOT call `mesa_create_rule` individually — use `mesa_write_accepted_rules` for batch generation results.

6. **Final summary** — Report how many rules were written vs. skipped, with their IDs and file paths (from the tool response).
