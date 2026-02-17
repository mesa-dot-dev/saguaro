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
description: Create a new Mesa code review rule
---
Ask the user what coding pattern or convention they want to enforce and which files
it applies to. Then use the mesa_create_rule MCP tool to create the rule.
Confirm the created rule details with the user.
`,
    },
    {
      skillFilePath: 'mesa-generaterules/SKILL.md',
      content: `---
name: mesa-generaterules
description: Auto-generate Mesa review rules by analyzing codebase patterns
---
Ask the user which directory or package to analyze for patterns.
Use mesa_list_rules to show what rules already exist.
Then analyze the codebase and use mesa_create_rule to generate rules
that capture the conventions and patterns found in the code.
`,
    },
  ];
}
