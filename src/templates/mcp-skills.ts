export interface McpSkillFile {
  /** Relative path from .claude/skills/ (e.g., "mesa-review/SKILL.md") */
  skillFilePath: string;
  /** Markdown content for the SKILL.md file */
  content: string;
}

export function getMcpSkillFiles(): McpSkillFile[] {
  return [
    {
      skillFilePath: 'mesa-review/SKILL.md',
      content: `---
name: mesa-review
description: Run Mesa code review on current changes
---
## Flow

1. **Choose review mode** — Use \`AskUserQuestion\` to ask the user which type of review to run:
   - **Rules** — Review against defined rules in .mesa/rules/
   - **Classic** — Agentic staff-engineer review (bugs, security, regressions, dead code, performance)
   - **Both** — Run both reviews and present combined findings

2. **Run the review** — Call the \`mesa_review\` MCP tool with:
   - \`mode\`: "rules", "classic", or "full" based on the user's choice
   - \`base_branch\`: defaults to "main" (ask only if the user specifies a different branch)
   - \`head_branch\`: defaults to "HEAD"

3. **Present results** —
   - **Rules mode**: Group violations by severity (error → warning → info) with file paths and line numbers.
   - **Classic mode**: Show findings grouped by category with severity and file locations.
   - **Both mode**: Present rules violations first under a "Rules Review" heading, then classic findings under a "Staff Engineer Review" heading.
   - If no issues are found in either review, confirm the changes look clean.
`,
    },
    {
      skillFilePath: 'mesa-createrule/SKILL.md',
      content: `---
name: mesa-createrule
description: Generate a single Mesa review rule using the AI pipeline with preview and approval
---
## Flow

1. **Gather inputs** — Ask the user for:
   - **Target directory** (e.g., "src/cli", "packages/web") — the code area the rule applies to
   - **Intent** — what convention or pattern the rule should enforce
   - Optionally: a title and severity

2. **Generate proposal** — Call the \`mesa_generate_rule\` MCP tool with the target and intent.
   Tell the user this may take 15-30 seconds while the pipeline analyzes their code.

3. **Present the proposal** — Show the user:
   - **Rule title, ID, severity, and globs**
   - **Instructions** (the full rule body)
   - **Preview data**: how many files would be flagged vs. passed, and which files
   - **Placement options**: where the rule can be saved (collocated, package, root) with the recommended option marked

4. **Ask for approval** — Present three options:
   - **Accept** — proceed to write the rule as-is
   - **Edit** — let the user modify fields (title, severity, instructions, globs) then re-confirm
   - **Cancel** — discard the proposal

5. **Choose placement** — If the user accepts, present the placement options and ask which scope to use.

6. **Write the rule** — Call \`mesa_create_rule\` with the final rule fields and the selected scope.
   Report the created rule ID and file path.
`,
    },
    {
      skillFilePath: 'mesa-generaterules/SKILL.md',
      content: `---
name: mesa-generaterules
description: Auto-generate Mesa review rules using the full AI pipeline with approval before writing
---
## Important — Two-Phase Data Model

\`mesa_generate_rules\` returns **compact summaries only** (id, title, severity, globs) to stay within tool output limits. Full rule details (instructions, examples) are held in server session state.

- To inspect full rule details, call \`mesa_get_generated_rule_details\` with an array of rule IDs.
- To write rules to disk, call \`mesa_write_accepted_rules\` with an array of rule IDs.

Both tools read from the same session state populated by \`mesa_generate_rules\`. Do NOT call \`mesa_generate_rules\` again — it would overwrite the session.

## Flow

1. **Start the pipeline** — Call the \`mesa_generate_rules\` MCP tool.
   Tell the user this runs a multi-stage pipeline (codebase scanning, import graph indexing, LLM analysis, consolidation/dedup) and takes a few minutes depending on the size of the codebase.

2. **Present summary** — When the tool returns, show:
   - Files scanned
   - Rules generated
   - Duration
   Do NOT list individual rules here — the list is too long and users don't want to scroll.

3. **Choose review mode** — Use the \`AskUserQuestion\` tool to ask the user how they want to review the generated rules. Present these options:
   - **Accept all** — Create all rules as-is without individual review
   - **Bulk review by group** — Group rules by package/domain (inferred from their glob patterns) and let the user accept or skip entire groups at a time
   - **Review individually** — Go through each rule one by one for Accept/Skip/Edit decisions
   - **Skip all** — Discard all generated rules

4. **Execute the chosen review mode:**

   **If "Accept all":** Proceed directly to writing all rules.

   **If "Bulk review by group":** Group rules by their target area based on glob patterns (e.g., all rules with \`packages/web/**\` globs form a "Web Package" group). Present a single compact table with one row per group showing: group name and rule count. Do NOT list individual rules within each group. Then use \`AskUserQuestion\` with \`multiSelect: true\` to let the user select which groups to accept. All rules in non-selected groups are skipped.

   **If "Review individually":**
   - Call \`mesa_get_generated_rule_details\` with no arguments to get the next batch of 10 rules. The server tracks position automatically — just keep calling it for each batch.
   - For each rule in the batch, present: **Title**, **ID**, **severity**, **Globs**, **Instructions** (the full rule body), **Examples** (if present).
   - Then use \`AskUserQuestion\` to ask: **Accept / Skip / Accept all remaining / Edit**
     - **Accept** — mark for creation
     - **Skip** — discard this rule
     - **Accept all remaining** — mark this rule and all remaining unreviewed rules for creation, stop reviewing
     - **Edit** — let the user modify fields, then re-confirm
   - Repeat for each batch until all rules have been reviewed.

   **If "Skip all":** Discard everything and confirm.

5. **Write accepted rules** — Collect the IDs of all accepted rules, then call \`mesa_write_accepted_rules\` once with the full list of accepted rule IDs. The server writes them using the same deterministic codepath as the CLI (scope computed from globs, skill files created). Do NOT call \`mesa_create_rule\` individually — use \`mesa_write_accepted_rules\` for batch generation results.

6. **Final summary** — Report how many rules were written vs. skipped, with their IDs and file paths (from the tool response).
`,
    },
    {
      skillFilePath: 'mesa-model/SKILL.md',
      content: `---
name: mesa-model
description: Switch the AI model used for Mesa code reviews
---
## Flow

1. **Fetch catalog** — Call \`mesa_get_models\` once (no arguments). This returns all providers with their models (sorted newest-first, recommended flagged), the current model, and \`api_key_configured\` per provider.

2. **Show current model** — If \`current\` is set, display: "Current model: {provider} / {model}". Otherwise: "No model configured."

3. **Pick a provider** — Use \`AskUserQuestion\` with the providers from step 1 as options (there are exactly 3: Anthropic, OpenAI, Google).

4. **Pick a model** — From the step 1 data, find the selected provider's model list. Present the models as a numbered text list — do NOT use AskUserQuestion (there are too many models for 4 options). Format each line as:

\`\`\`
  1. model-id — Label (recommended)
  2. model-id — Label
  ...
\`\`\`

Then ask: "Pick a number, or type a model ID directly."

IMPORTANT: Use the exact \`id\` field from the catalog as the model identifier. Do NOT modify, reformat, or abbreviate model IDs.

5. **Set the model** — Call \`mesa_set_model\` with the exact \`provider\` and \`model\` id. If \`mesa_set_model\` returns an error, show the error and do NOT retry with a modified model ID.

6. **API key** — Check \`api_key_configured\` from the \`mesa_set_model\` response. If \`false\`, tell the user: "No {envKey} found. Paste your key or type 'n' to skip." If they provide a key, call \`mesa_set_model\` again with the \`api_key\` field.

7. **Confirm** — Say the model was updated. Always end with: "You can also set this directly in .mesa/config.yaml"
`,
    },
  ];
}
