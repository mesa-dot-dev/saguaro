import type { ExportKind, ExportRef, ParseResult } from '../../../types.js';
import { createParser } from '../init.js';
import type { SyntaxNode } from '../types.js';
import { truncate } from '../types.js';

type UnresolvedImport = ParseResult['imports'][number];

export async function extractGo(source: string): Promise<ParseResult> {
  const parser = await createParser('go');
  const tree = parser.parse(source)!;
  try {
    const root = tree.rootNode as unknown as SyntaxNode;

    const imports = extractImports(root);
    const exports = extractExports(root, source);

    return { language: 'go', imports, exports };
  } finally {
    tree.delete();
    parser.delete();
  }
}

function extractImports(root: SyntaxNode): UnresolvedImport[] {
  const imports: UnresolvedImport[] = [];

  for (let i = 0; i < root.namedChildCount; i++) {
    const node = root.namedChild(i);
    if (node?.type !== 'import_declaration') continue;

    for (let j = 0; j < node.namedChildCount; j++) {
      const child = node.namedChild(j);
      if (!child) continue;

      if (child.type === 'import_spec') {
        imports.push(parseImportSpec(child));
      } else if (child.type === 'import_spec_list') {
        for (let k = 0; k < child.namedChildCount; k++) {
          const spec = child.namedChild(k);
          if (spec?.type === 'import_spec') {
            imports.push(parseImportSpec(spec));
          }
        }
      }
    }
  }

  return imports;
}

function parseImportSpec(node: SyntaxNode): UnresolvedImport {
  const pathNode = node.childForFieldName('path');
  const nameNode = node.childForFieldName('name');
  const source = pathNode ? stripQuotes(pathNode.text) : '';

  // Dot import: import . "testing"
  if (nameNode?.type === 'dot') {
    return { source, symbols: [], kind: 'wildcard' };
  }

  return { source, symbols: [], kind: 'namespace' };
}

function extractExports(root: SyntaxNode, source: string): ExportRef[] {
  const exports: ExportRef[] = [];

  for (let i = 0; i < root.namedChildCount; i++) {
    const node = root.namedChild(i);
    if (!node) continue;

    switch (node.type) {
      case 'function_declaration': {
        const nameNode = node.childForFieldName('name');
        if (!nameNode || !isExported(nameNode.text)) break;
        exports.push({
          name: nameNode.text,
          kind: 'function',
          signature: truncate(extractSignatureLine(node, source)),
          isDefault: false,
          isTypeOnly: false,
        });
        break;
      }

      case 'method_declaration': {
        const nameNode = node.childForFieldName('name');
        if (!nameNode || !isExported(nameNode.text)) break;
        exports.push({
          name: nameNode.text,
          kind: 'function',
          signature: truncate(extractSignatureLine(node, source)),
          isDefault: false,
          isTypeOnly: false,
        });
        break;
      }

      case 'type_declaration': {
        for (let j = 0; j < node.namedChildCount; j++) {
          const spec = node.namedChild(j);
          if (spec?.type !== 'type_spec') continue;
          const nameNode = spec.childForFieldName('name');
          if (!nameNode || !isExported(nameNode.text)) continue;
          const typeNode = spec.childForFieldName('type');
          let kind: ExportKind = 'type';
          if (typeNode?.type === 'interface_type') kind = 'interface';
          else if (typeNode?.type === 'struct_type') kind = 'class';
          exports.push({
            name: nameNode.text,
            kind,
            isDefault: false,
            isTypeOnly: false,
          });
        }
        break;
      }

      case 'var_declaration': {
        collectVarConst(node, 'variable', exports);
        break;
      }

      case 'const_declaration': {
        collectVarConst(node, 'constant', exports);
        break;
      }
    }
  }

  return exports;
}

function collectVarConst(node: SyntaxNode, kind: ExportKind, exports: ExportRef[]): void {
  for (let j = 0; j < node.namedChildCount; j++) {
    const spec = node.namedChild(j);
    if (!spec) continue;
    const nameNode = spec.childForFieldName('name');
    if (nameNode && isExported(nameNode.text)) {
      exports.push({ name: nameNode.text, kind, isDefault: false, isTypeOnly: false });
    }
  }
}

/**
 * Go export rule: names starting with an uppercase letter are exported.
 * Uses Unicode-aware check per Go spec (not just ASCII A-Z).
 */
const UNICODE_UPPER = /^\p{Lu}/u;
function isExported(name: string): boolean {
  if (!name) return false;
  return UNICODE_UPPER.test(name);
}

function extractSignatureLine(node: SyntaxNode, source: string): string {
  const bodyNode = node.childForFieldName('body');
  if (!bodyNode) return node.text.split('\n')[0];
  return source.slice(node.startIndex, bodyNode.startIndex).trim();
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('`') && s.endsWith('`'))) {
    return s.slice(1, -1);
  }
  return s;
}
