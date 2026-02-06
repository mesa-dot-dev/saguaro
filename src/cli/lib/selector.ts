import fs from 'fs';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';
import path from 'path';
import type { Rule } from '../../types/types.js';

const findMesaDir = (): string | null => {
  let currentDir = process.cwd();
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const mesaDir = path.join(currentDir, '.mesa');
    if (fs.existsSync(mesaDir)) {
      return mesaDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return null;
};

const getRulesDir = (): string | null => {
  const mesaDir = findMesaDir();
  if (!mesaDir) return null;
  const rulesDir = path.join(mesaDir, 'rules');
  return fs.existsSync(rulesDir) ? rulesDir : null;
};

const loadAllRules = (rulesDir?: string): Rule[] => {
  const dir = rulesDir ?? getRulesDir();
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }
  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'));
  return files
    .map((f: string) => {
      try {
        const content = fs.readFileSync(path.join(dir, f), 'utf8');
        const rule = yaml.load(content) as Rule;
        return rule;
      } catch (e) {
        return null;
      }
    })
    .filter((r: Rule | null): r is Rule => r !== null);
};

const selectRulesForFiles = (files: string[], rules: Rule[]): Map<string, Rule[]> => {
  const fileRules = new Map<string, Rule[]>();

  files.forEach((file) => {
    const applicableRules = rules.filter((rule) => {
      if (!rule.globs) return true;
      let matched = false;
      let excluded = false;
      rule.globs.forEach((g) => {
        if (g.startsWith('!')) {
          if (minimatch(file, g.slice(1))) excluded = true;
        } else if (minimatch(file, g)) {
          matched = true;
        }
      });
      return matched && !excluded;
    });
    const uniqueRules = new Set<string>();
    applicableRules.forEach((rule) => {
      uniqueRules.add(rule.id);
    });
    if (uniqueRules.size !== applicableRules.length) {
      console.warn(`Duplicate rules found for file: ${file}`);
    }
    if (applicableRules.length > 0) {
      fileRules.set(file, applicableRules);
    }
  });

  return fileRules;
};

export { findMesaDir, getRulesDir, loadAllRules, selectRulesForFiles };
