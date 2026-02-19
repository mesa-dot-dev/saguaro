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
description: Run Mesa code review on current changes against defined rules
---
Use the mesa_review MCP tool to review the current changes against the base branch.
Present violations grouped by severity with file paths and line numbers.
If no violations are found, confirm the changes look clean.
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
## Flow

1. **Start the pipeline** — Call the \`mesa_generate_rules\` MCP tool.
   Tell the user this runs a multi-stage pipeline (codebase scanning, import graph indexing, LLM analysis, consolidation/dedup) and takes a few minutes depending on the size of the codebase.

2. **Present summary** — When the tool returns, show:
   - Files scanned
   - Rules generated
   - Duration
   - A compact list of all generated rules (ID + one-line description each)

3. **Choose review mode** — Always ask the user how they want to review the generated rules. Present these options:
   - **Accept all** — Create all rules as-is without individual review
   - **Bulk review by group** — Group rules by package/domain (inferred from their glob patterns) and let the user accept or skip entire groups at a time
   - **Review individually** — Go through each rule one by one for Accept/Skip/Edit decisions
   - **Skip all** — Discard all generated rules

4. **Execute the chosen review mode:**

   **If "Accept all":** proceed directly to writing all rules.

   **If "Bulk review by group":** Group rules by their target area based on glob patterns (e.g., all rules with \`packages/web/**\` globs form a "Web Package" group). Present the groups with rule counts and a brief description, then let the user select which groups to accept. All rules in non-selected groups are skipped.

   **If "Review individually":** For each rule, present:
   - **Title**, **ID**, **severity**
   - **Globs** (file patterns)
   - **Instructions** (the full rule body)
   - **Examples** (violations and compliant snippets, if present)

   Then ask: **Accept / Skip / Edit**
   - **Accept** — mark for creation
   - **Skip** — discard this rule
   - **Edit** — let the user modify fields, then re-confirm

   **If "Skip all":** discard everything and confirm.

5. **Write accepted rules** — Collect the IDs of all accepted rules, then call \`mesa_write_accepted_rules\` once with the full list of accepted rule IDs. The server holds the generated rules in memory and writes them using the same deterministic codepath as the CLI (scope placement, skill file structure). Do NOT call \`mesa_create_rule\` individually — use \`mesa_write_accepted_rules\` for batch generation results.

6. **Final summary** — Report how many rules were written vs. skipped, with their IDs and file paths (from the tool response).
`,
    },
  ];
}
