---
name: saguaro-review
description: Run Saguaro code review on current changes
---
## Flow

1. **Choose review mode** — You MUST use the `AskUserQuestion` tool with structured options (NOT a free-text question). Call it exactly like this:

   ```
   AskUserQuestion({
     questions: [{
       question: "What type of review would you like to run?",
       header: "Review type",
       options: [
         { label: "Both (Recommended)", description: "Run both rules and classic reviews together for maximum coverage" },
         { label: "Rules only", description: "Optimized for bug and codebase violations — maximum signal, lowest noise" },
         { label: "Classic only", description: "Senior-level review where the agent is more permissive in its analysis, borrowing the best elements from Saguaro's GitHub review product" }
       ],
       multiSelect: false
     }]
   })
   ```

   Map the user's selection: "Both" → mode "full", "Rules only" → mode "rules", "Classic only" → mode "classic".

2. **Run the review** — Call the `saguaro_review` MCP tool with:
   - `mode`: "rules", "classic", or "full" based on the user's choice
   - `base_branch`: defaults to "main" (ask only if the user specifies a different branch)
   - `head_branch`: defaults to "HEAD"

3. **Present results** —
   - **Rules mode**: Group violations by severity (error → warning → info) with file paths and line numbers.
   - **Classic mode**: Show findings grouped by category with severity and file locations.
   - **Both mode**: Present rules violations first under a "Rules Review" heading, then classic findings under a "Senior Engineer Review" heading.
   - If no issues are found in either review, confirm the changes look clean.
