export const VIEW_DIFF_TOOL_TEMPLATE = `
import { z } from "zod"
import { execSync } from "child_process"

export default {
  description: "View the git diff for a specific file between a base branch and HEAD. Returns only the diff output. If the file has no changes, returns 'No changes.'",
  args: {
    filepath: z.string().describe("The file path to diff"),
    base: z.string().describe("The base branch to diff against"),
  },
  async execute(args, ctx) {
    try {
      const output = execSync(
        \`git diff \${args.base}...HEAD -- \${args.filepath}\`,
        { encoding: "utf8", cwd: ctx.directory, maxBuffer: 1024 * 1024 }
      )
      if (!output.trim()) return "No changes."
      return output
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return \`[VIEW_DIFF_ERROR] \${message}\`
    }
  },
}
`;
