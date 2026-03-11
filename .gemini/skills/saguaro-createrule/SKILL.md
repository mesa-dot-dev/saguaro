---
name: saguaro-createrule
description: Generate a single Saguaro review rule using the AI pipeline with preview and approval
---
## Flow

1. **Gather inputs** — Ask the user for:
   - **Target directory** (e.g., "src/cli", "packages/web") — the code area the rule applies to
   - **Intent** — what convention or pattern the rule should enforce
   - Optionally: a title and severity

2. **Generate proposal** — Call the `saguaro_generate_rule` MCP tool with the target and intent.
   Tell the user this may take 15-30 seconds while the pipeline analyzes their code.

3. **Present the proposal** — Show the user:
   - **Rule title, ID, severity, and globs**
   - **Instructions** (the full rule body)
   - **Preview data**: how many files would be flagged vs. passed, and which files
   - **Placement options**: where the rule can be saved (collocated, package, root) with the recommended option marked

4. **Ask for approval** — Use `AskUserQuestion` with structured options:

   ```
   AskUserQuestion({
     questions: [{
       question: "How would you like to proceed with this rule?",
       header: "Approval",
       options: [
         { label: "Accept", description: "Write the rule as-is" },
         { label: "Edit", description: "Modify fields (title, severity, instructions, globs) before writing" },
         { label: "Cancel", description: "Discard the proposal" }
       ],
       multiSelect: false
     }]
   })
   ```

5. **Choose placement** — If the user accepts, use `AskUserQuestion` to present the placement options from the proposal and ask which scope to use.

6. **Write the rule** — Call `saguaro_create_rule` with the final rule fields and the selected scope.
   Report the created rule ID and file path.
