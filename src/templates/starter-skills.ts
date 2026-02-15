import yaml from 'js-yaml';
import { STARTER_RULE_SKILLS } from './starter-rule-skills.js';

export interface StarterSkillFiles {
  skillFilePath: string;
  policyFilePath: string;
  skillMarkdown: string;
  policyYaml: string;
}

export function getStarterSkillFiles(): StarterSkillFiles[] {
  const output: StarterSkillFiles[] = [];

  for (const policy of STARTER_RULE_SKILLS) {
    const id = policy.id;
    const title = policy.title;

    output.push({
      skillFilePath: `${id}/SKILL.md`,
      policyFilePath: `${id}/references/mesa-policy.yaml`,
      skillMarkdown: buildSkillMarkdown({ id, title, globs: policy.globs }),
      policyYaml: yaml.dump(policy, { noRefs: true, lineWidth: -1 }),
    });
  }

  return output;
}

function buildSkillMarkdown(options: { id: string; title: string; globs: string[] }): string {
  const scope = options.globs.join(', ');
  return `---
name: ${options.id}
description: ${options.title}. Enforces this rule in ${scope}. Use when changed code matches this scope and touches the policy behavior. Do not use for files outside scope or unrelated refactors.
---

This skill enforces the ${options.title} policy.

Machine-readable policy is defined in references/mesa-policy.yaml.
`;
}
