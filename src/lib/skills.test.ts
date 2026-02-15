/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkillFiles, resolveSkillsForFiles, validateParsedSkills } from './skills.js';

function withTempRepo(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-skills-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeSkill(
  root: string,
  relativeDir: string,
  options: {
    name: string;
    description: string;
    policyYaml: string;
  }
): void {
  const skillDir = path.join(root, relativeDir, '.claude', 'skills', options.name);
  const referencesDir = path.join(skillDir, 'references');
  fs.mkdirSync(referencesDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${options.name}\ndescription: ${options.description}\n---\n\nPolicy source: references/mesa-policy.yaml\n`
  );
  fs.writeFileSync(path.join(referencesDir, 'mesa-policy.yaml'), options.policyYaml);
}

describe('skills loader', () => {
  test('applies ancestor hierarchy with nearest override by policy id', () => {
    withTempRepo((root) => {
      writeSkill(root, '.', {
        name: 'no-console-log',
        description: 'Root skill',
        policyYaml: [
          'id: no-console-log',
          'title: No console.log',
          'severity: warning',
          'globs:',
          '  - "**/*.ts"',
          'instructions: |',
          '  root policy',
        ].join('\n'),
      });

      writeSkill(root, 'packages/web', {
        name: 'no-console-log',
        description: 'Package override skill',
        policyYaml: [
          'id: no-console-log',
          'title: No console.log (web strict)',
          'severity: error',
          'globs:',
          '  - "packages/web/**/*.ts"',
          'instructions: |',
          '  web override policy',
          'priority: 10',
        ].join('\n'),
      });

      const changedFile = 'packages/web/src/app.ts';
      const result = resolveSkillsForFiles([changedFile], { startDir: root });
      const fileSkills = result.filesWithRules.get(changedFile);

      expect(result.rulesLoaded).toBe(2);
      expect(fileSkills).toBeDefined();
      expect(fileSkills?.length).toBe(1);
      expect(fileSkills?.[0]?.id).toBe('no-console-log');
      expect(fileSkills?.[0]?.severity).toBe('error');
      expect(fileSkills?.[0]?.instructions.trim()).toBe('web override policy');
    });
  });

  test('handles include and exclude globs for matching', () => {
    withTempRepo((root) => {
      writeSkill(root, '.', {
        name: 'no-tests',
        description: 'Matches source files only',
        policyYaml: [
          'id: no-tests',
          'title: No tests policy',
          'severity: warning',
          'globs:',
          '  - "**/*.ts"',
          '  - "!**/*.test.ts"',
          'instructions: |',
          '  source only',
        ].join('\n'),
      });

      const matched = resolveSkillsForFiles(['src/service.ts'], { startDir: root });
      expect(matched.filesWithRules.get('src/service.ts')?.length).toBe(1);

      const excluded = resolveSkillsForFiles(['src/service.test.ts'], { startDir: root });
      expect(excluded.filesWithRules.has('src/service.test.ts')).toBe(false);
    });
  });

  test('ignores skills without policy sidecar', () => {
    withTempRepo((root) => {
      const skillDir = path.join(root, '.claude', 'skills', 'missing-policy');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: missing-policy\ndescription: Missing sidecar\n---\n\nNo sidecar policy.\n'
      );

      const { parsed, issues } = parseSkillFiles(path.join(root, '.claude', 'skills'));
      expect(parsed.length).toBe(0);
      expect(issues.length).toBe(0);
    });
  });

  test('validates duplicate policy ids as semantic errors', () => {
    withTempRepo((root) => {
      const policy = [
        'id: duplicate-id',
        'title: Duplicate',
        'severity: warning',
        'globs:',
        '  - "**/*.ts"',
        'instructions: |',
        '  same id',
      ].join('\n');

      writeSkill(root, '.', { name: 'skill-one', description: 'One', policyYaml: policy });
      writeSkill(root, '.', { name: 'skill-two', description: 'Two', policyYaml: policy });

      const { parsed, issues } = parseSkillFiles(path.join(root, '.claude', 'skills'));
      expect(issues.length).toBe(0);

      const validation = validateParsedSkills(parsed);
      expect(validation.length).toBe(1);
      expect(validation[0]?.message).toContain('duplicate id');
    });
  });
});
