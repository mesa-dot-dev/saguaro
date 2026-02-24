/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { buildRuleGenerationPrompt, parseGeneratedPolicy, selectFewShotExamples } from './rule-generator.js';
import type { TargetAnalysis } from './target-analysis.js';

// --- selectFewShotExamples ---

describe('selectFewShotExamples', () => {
  test('returns 2-3 examples', () => {
    const examples = selectFewShotExamples('enforce logging best practices');
    expect(examples.length).toBeGreaterThanOrEqual(2);
    expect(examples.length).toBeLessThanOrEqual(3);
  });

  test('selects relevant examples by tag matching', () => {
    const examples = selectFewShotExamples('security secrets credentials');
    const ids = examples.map((e) => e.id);
    // Should include security-related rules
    const hasSecurityRule = ids.some(
      (id) => id.includes('secret') || id.includes('credential') || id.includes('security')
    );
    expect(hasSecurityRule).toBe(true);
  });

  test('selects relevant examples by title matching', () => {
    const examples = selectFewShotExamples('floating promises async await');
    const ids = examples.map((e) => e.id);
    expect(ids).toContain('no-floating-promises');
  });

  test('returns examples even for unrelated intent', () => {
    const examples = selectFewShotExamples('some completely unique and unmatched intent xyz123');
    expect(examples.length).toBeGreaterThanOrEqual(2);
  });
});

// --- parseGeneratedPolicy ---

describe('parseGeneratedPolicy', () => {
  const validYaml = [
    'id: test-rule',
    'title: Test Rule',
    'severity: error',
    'globs:',
    '  - "**/*.ts"',
    'instructions: |',
    '  ## What to Look For',
    '  Bad patterns.',
    '  ## Why This Matters',
    '  They cause bugs.',
    '  ## Correct Patterns',
    '  Good patterns.',
    '  ## Exceptions',
    '  None.',
    'examples:',
    '  violations:',
    '    - "badCode()"',
    '  compliant:',
    '    - "goodCode()"',
    'tags:',
    '  - test',
    '  - example',
  ].join('\n');

  test('parses valid YAML into a RulePolicy', () => {
    const result = parseGeneratedPolicy(validYaml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.policy.id).toBe('test-rule');
      expect(result.policy.title).toBe('Test Rule');
      expect(result.policy.severity).toBe('error');
      expect(result.policy.globs).toEqual(['**/*.ts']);
      expect(result.policy.instructions).toContain('What to Look For');
      expect(result.policy.examples?.violations).toEqual(['badCode()']);
      expect(result.policy.examples?.compliant).toEqual(['goodCode()']);
      expect(result.policy.tags).toEqual(['test', 'example']);
    }
  });

  test('strips markdown code fences before parsing', () => {
    const fencedYaml = `\`\`\`yaml\n${validYaml}\n\`\`\``;
    const result = parseGeneratedPolicy(fencedYaml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.policy.id).toBe('test-rule');
    }
  });

  test('strips plain code fences before parsing', () => {
    const fencedYaml = `\`\`\`\n${validYaml}\n\`\`\``;
    const result = parseGeneratedPolicy(fencedYaml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.policy.id).toBe('test-rule');
    }
  });

  test('returns error for invalid YAML', () => {
    const result = parseGeneratedPolicy('{{invalid yaml:: [');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  test('returns error for missing required fields', () => {
    const incompleteYaml = [
      'id: test-rule',
      // missing title, severity, globs, instructions
    ].join('\n');
    const result = parseGeneratedPolicy(incompleteYaml);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  test('returns error when YAML is not an object', () => {
    const result = parseGeneratedPolicy('just a plain string');
    expect(result.success).toBe(false);
  });
});

// --- buildRuleGenerationPrompt ---

function makeTargetAnalysis(overrides?: Partial<TargetAnalysis>): TargetAnalysis {
  return {
    resolvedPath: '/tmp/test/src/cli',
    relativePath: 'src/cli',
    files: [{ filePath: 'src/cli/lib/rules.ts', content: "import { generateRule } from '../../lib/rule-generator';" }],
    boundaryFiles: [{ filePath: 'src/adapter/review.ts', content: 'export function reviewAdapter() {}' }],
    directoryTree: 'src/\n├── cli/ ← target\n├── adapter/\n├── core/\n└── lib/',
    suggestedGlobs: ['src/cli/**/*.ts', '!**/*.test.*'],
    detectedLanguages: ['typescript'],
    placements: [],
    ...overrides,
  };
}

describe('buildRuleGenerationPrompt', () => {
  test('includes directory tree in prompt', () => {
    const target = makeTargetAnalysis();
    const prompt = buildRuleGenerationPrompt({
      intent: 'CLI should not import from lib',
      target,
      fewShotExamples: [],
    });

    expect(prompt).toContain('cli/ ← target');
    expect(prompt).toContain('adapter/');
  });

  test('includes target files in codebase context', () => {
    const target = makeTargetAnalysis();
    const prompt = buildRuleGenerationPrompt({
      intent: 'test',
      target,
      fewShotExamples: [],
    });

    expect(prompt).toContain('src/cli/lib/rules.ts');
    expect(prompt).toContain('import { generateRule }');
  });

  test('includes boundary files in codebase context', () => {
    const target = makeTargetAnalysis();
    const prompt = buildRuleGenerationPrompt({
      intent: 'test',
      target,
      fewShotExamples: [],
    });

    expect(prompt).toContain('src/adapter/review.ts');
    expect(prompt).toContain('Surrounding Code');
  });

  test('includes suggested globs in prompt', () => {
    const target = makeTargetAnalysis();
    const prompt = buildRuleGenerationPrompt({
      intent: 'test',
      target,
      fewShotExamples: [],
    });

    expect(prompt).toContain('src/cli/**/*.ts');
  });

  test('includes grounding instruction for examples', () => {
    const target = makeTargetAnalysis();
    const prompt = buildRuleGenerationPrompt({
      intent: 'test',
      target,
      fewShotExamples: [],
    });

    expect(prompt).toContain('Ground your violation and compliant examples');
    expect(prompt).toContain('ACTUAL code');
  });

  test('includes infer title instruction when no title provided', () => {
    const target = makeTargetAnalysis();
    const prompt = buildRuleGenerationPrompt({
      intent: 'test',
      target,
      fewShotExamples: [],
    });

    expect(prompt).toContain('Infer a concise, descriptive title');
  });

  test('includes title when provided', () => {
    const target = makeTargetAnalysis();
    const prompt = buildRuleGenerationPrompt({
      intent: 'test',
      target,
      fewShotExamples: [],
      title: 'CLI Never Calls Lib',
    });

    expect(prompt).toContain('CLI Never Calls Lib');
    expect(prompt).not.toContain('Infer a concise, descriptive title');
  });

  test('includes few-shot examples when provided', () => {
    const target = makeTargetAnalysis();
    const prompt = buildRuleGenerationPrompt({
      intent: 'test',
      target,
      fewShotExamples: [
        {
          id: 'example-rule',
          title: 'Example Rule',
          severity: 'warning',
          globs: ['**/*.ts'],
          instructions: 'Do not use eval().',
          tags: ['security'],
        },
      ],
    });

    expect(prompt).toContain('example-rule');
    expect(prompt).toContain('Example Rule');
  });
});
