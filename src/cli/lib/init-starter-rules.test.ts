/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectEcosystems } from '../../rules/detect-ecosystems.js';
import { loadSaguaroRules, writeSaguaroRuleFile } from '../../rules/saguaro-rules.js';
import { selectStarterRules } from '../../rules/starter.js';
import { STARTER_RULES } from '../../templates/starter-rules.js';

/**
 * Creates a temporary directory with a `.git` folder (to simulate a repo root),
 * runs a setup function to seed files, then runs the test assertions. Cleans up
 * the temp directory on exit regardless of success or failure.
 */
function withTempRepo(setup: (dir: string) => void, run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saguaro-init-'));
  try {
    fs.mkdirSync(path.join(dir, '.git'));
    setup(dir);
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Integration Tests ──────────────────────────────────────────────────

describe('init-starter-rules integration', () => {
  test('react+typescript project gets relevant rules', () => {
    withTempRepo(
      (dir) => {
        // tsconfig.json triggers typescript detection
        fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');

        // package.json with react dep triggers react + javascript detection
        fs.writeFileSync(
          path.join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
          })
        );
      },
      (dir) => {
        const ecosystems = detectEcosystems(dir);

        // Verify detected ecosystems
        expect(ecosystems.has('typescript')).toBe(true);
        expect(ecosystems.has('react')).toBe(true);

        const selected = selectStarterRules(STARTER_RULES, ecosystems, () => false);
        const selectedIds = selected.map((r) => r.id);

        // Should include universal rules (ecosystems: [])
        const universalRules = STARTER_RULES.filter((r) => r.ecosystems.length === 0);
        for (const rule of universalRules) {
          expect(selectedIds).toContain(rule.id);
        }

        // Should include react-specific rules that have no file requirements
        // (rules with requires.files are excluded because fileMatchChecker returns false)
        const reactRuleIds = STARTER_RULES.filter(
          (r) =>
            r.ecosystems.length > 0 &&
            r.ecosystems.includes('react') &&
            r.ecosystems.every((e) => ecosystems.has(e)) &&
            !r.requires
        ).map((r) => r.id);
        for (const id of reactRuleIds) {
          expect(selectedIds).toContain(id);
        }

        // Should NOT include go-specific rules
        const goRuleIds = STARTER_RULES.filter((r) => r.ecosystems.includes('go')).map((r) => r.id);
        for (const id of goRuleIds) {
          expect(selectedIds).not.toContain(id);
        }

        // Sanity: we actually selected some react rules
        expect(reactRuleIds.length).toBeGreaterThan(0);
      }
    );
  });

  test('python project gets universal + python-specific rules', () => {
    withTempRepo(
      (dir) => {
        fs.writeFileSync(
          path.join(dir, 'pyproject.toml'),
          ['[project]', 'name = "myapp"', 'dependencies = ["flask"]'].join('\n')
        );
        fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src', 'main.py'), 'print("hello")');
      },
      (dir) => {
        const ecosystems = detectEcosystems(dir);
        expect(ecosystems.has('python')).toBe(true);
        expect(ecosystems.has('react')).toBe(false);

        const selected = selectStarterRules(STARTER_RULES, ecosystems, () => false);
        const selectedIds = new Set(selected.map((r) => r.id));

        // Should include all universal rules
        const universalIds = STARTER_RULES.filter((r) => r.ecosystems.length === 0).map((r) => r.id);
        for (const id of universalIds) {
          expect(selectedIds.has(id)).toBe(true);
        }

        // Should include python-specific rules
        expect(selectedIds.has('python-http-no-timeout')).toBe(true);

        // Should NOT include react rules
        const reactRuleIds = STARTER_RULES.filter((r) => r.ecosystems.includes('react')).map((r) => r.id);
        for (const id of reactRuleIds) {
          expect(selectedIds.has(id)).toBe(false);
        }
      }
    );
  });

  test('empty project gets only universal rules', () => {
    withTempRepo(
      () => {
        // No files created — empty project
      },
      (dir) => {
        const ecosystems = detectEcosystems(dir);

        // No ecosystems detected in an empty directory
        expect(ecosystems.size).toBe(0);

        const selected = selectStarterRules(STARTER_RULES, ecosystems, () => false);
        const selectedIds = new Set(selected.map((r) => r.id));

        // Every selected rule should be a universal rule (ecosystems: [])
        const universalIds = new Set(STARTER_RULES.filter((r) => r.ecosystems.length === 0).map((r) => r.id));
        for (const id of selectedIds) {
          expect(universalIds.has(id)).toBe(true);
        }

        // All universal rules should be present
        for (const id of universalIds) {
          expect(selectedIds.has(id)).toBe(true);
        }

        // No ecosystem-specific rules should be included
        const ecosystemSpecificRules = STARTER_RULES.filter((r) => r.ecosystems.length > 0);
        for (const rule of ecosystemSpecificRules) {
          expect(selectedIds.has(rule.id)).toBe(false);
        }
      }
    );
  });

  test('selected rules can be written and loaded back', () => {
    withTempRepo(
      (dir) => {
        // Set up a react+typescript project
        fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
        fs.writeFileSync(
          path.join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
          })
        );
      },
      (dir) => {
        const ecosystems = detectEcosystems(dir);
        const selected = selectStarterRules(STARTER_RULES, ecosystems, () => false);

        // Sanity: we have rules to write
        expect(selected.length).toBeGreaterThan(0);

        // Write each selected rule to .saguaro/rules/
        for (const policy of selected) {
          writeSaguaroRuleFile(dir, policy);
        }

        // Load them back
        const { rules, errors } = loadSaguaroRules(dir);

        // No parse errors
        expect(errors).toHaveLength(0);

        // Loaded count matches selected count
        expect(rules.length).toBe(selected.length);

        // Verify each loaded rule has a matching id from the selected set
        const selectedIds = new Set(selected.map((r) => r.id));
        for (const rule of rules) {
          expect(selectedIds.has(rule.policy.id)).toBe(true);
        }
      }
    );
  });
});
