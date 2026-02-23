import type { ExportKind, ExportRef, ParseResult } from '../../../types.js';
import type { SyntaxNode } from '../common.js';
import { truncate } from '../common.js';
import { createParser } from '../init.js';

type UnresolvedImport = ParseResult['imports'][number];

export async function extractRust(source: string): Promise<ParseResult> {
  const parser = await createParser('rust');
  const tree = parser.parse(source)!;
  try {
    const root = tree.rootNode as unknown as SyntaxNode;

    const imports = extractImports(root);
    const exports = extractExports(root, source);

    return { language: 'rust', imports, exports };
  } finally {
    tree.delete();
    parser.delete();
  }
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

function extractImports(root: SyntaxNode): UnresolvedImport[] {
  const imports: UnresolvedImport[] = [];

  for (let i = 0; i < root.namedChildCount; i++) {
    const node = root.namedChild(i);
    if (node?.type !== 'use_declaration') continue;

    const argument = node.namedChild(0);
    if (!argument) continue;

    parseUseTree(argument, imports);
  }

  return imports;
}

function parseUseTree(node: SyntaxNode, imports: UnresolvedImport[]): void {
  switch (node.type) {
    case 'scoped_identifier': {
      // use a::b::c → path=a::b, symbol=c
      const { path, name } = splitScopedIdentifier(node);
      imports.push({ source: path, symbols: name ? [name] : [], kind: 'named' });
      break;
    }

    case 'scoped_use_list': {
      // use a::b::{c, d}
      const pathNode = node.childForFieldName('path');
      const listNode = node.childForFieldName('list');
      const basePath = pathNode ? pathNode.text : '';

      const symbols: string[] = [];
      if (listNode) {
        for (let i = 0; i < listNode.namedChildCount; i++) {
          const child = listNode.namedChild(i);
          if (!child) continue;
          if (child.type === 'identifier' || child.type === 'type_identifier') {
            symbols.push(child.text);
          } else if (child.type === 'use_as_clause') {
            // use a::{B as C} — use original name
            const pathField = child.childForFieldName('path');
            if (pathField) {
              const lastSegment = extractLastSegment(pathField);
              if (lastSegment) symbols.push(lastSegment);
            }
          } else if (child.type === 'self') {
            symbols.push('self');
          } else if (child.type === 'scoped_identifier') {
            // Nested scoped identifier in list — extract last segment
            const { name } = splitScopedIdentifier(child);
            if (name) symbols.push(name);
          }
        }
      }

      imports.push({ source: basePath, symbols, kind: 'named' });
      break;
    }

    case 'use_wildcard': {
      // use a::b::* — the child is the path (scoped_identifier or identifier)
      const pathChild = node.namedChild(0);
      const source = pathChild ? pathChild.text : '';
      imports.push({ source, symbols: [], kind: 'wildcard' });
      break;
    }

    case 'use_as_clause': {
      // use a::b::C as D — use the original path
      const pathNode = node.childForFieldName('path');
      if (pathNode) {
        if (pathNode.type === 'scoped_identifier') {
          const { path, name } = splitScopedIdentifier(pathNode);
          imports.push({ source: path, symbols: name ? [name] : [], kind: 'named' });
        } else {
          imports.push({ source: pathNode.text, symbols: [], kind: 'namespace' });
        }
      }
      break;
    }

    case 'identifier': {
      // use foo; (rare)
      imports.push({ source: node.text, symbols: [], kind: 'namespace' });
      break;
    }
  }
}

/**
 * Split a scoped_identifier into path (everything except last segment) and name (last segment).
 * e.g. std::io::Read → { path: "std::io", name: "Read" }
 */
function splitScopedIdentifier(node: SyntaxNode): { path: string; name: string } {
  const pathNode = node.childForFieldName('path');
  const nameNode = node.childForFieldName('name');
  return {
    path: pathNode ? pathNode.text : '',
    name: nameNode ? nameNode.text : '',
  };
}

function extractLastSegment(node: SyntaxNode): string | null {
  if (node.type === 'identifier' || node.type === 'type_identifier') return node.text;
  if (node.type === 'scoped_identifier') {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

function extractExports(root: SyntaxNode, source: string): ExportRef[] {
  const exports: ExportRef[] = [];

  for (let i = 0; i < root.namedChildCount; i++) {
    const node = root.namedChild(i);
    if (!node || !hasPubVisibility(node)) continue;

    switch (node.type) {
      case 'function_item': {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) break;
        exports.push({
          name: nameNode.text,
          kind: 'function',
          signature: truncate(extractSignatureLine(node, source)),
          isDefault: false,
          isTypeOnly: false,
        });
        break;
      }

      case 'struct_item': {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) break;
        exports.push({ name: nameNode.text, kind: 'class', isDefault: false, isTypeOnly: false });
        break;
      }

      case 'trait_item': {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) break;
        exports.push({ name: nameNode.text, kind: 'trait', isDefault: false, isTypeOnly: false });
        break;
      }

      case 'enum_item': {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) break;
        exports.push({ name: nameNode.text, kind: 'enum', isDefault: false, isTypeOnly: false });
        break;
      }

      case 'type_item': {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) break;
        exports.push({ name: nameNode.text, kind: 'type', isDefault: false, isTypeOnly: false });
        break;
      }

      case 'const_item': {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) break;
        exports.push({ name: nameNode.text, kind: 'constant', isDefault: false, isTypeOnly: false });
        break;
      }

      case 'static_item': {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) break;
        exports.push({ name: nameNode.text, kind: 'variable', isDefault: false, isTypeOnly: false });
        break;
      }
    }
  }

  return exports;
}

function hasPubVisibility(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.type === 'visibility_modifier') return true;
  }
  return false;
}

function extractSignatureLine(node: SyntaxNode, source: string): string {
  const bodyNode = node.childForFieldName('body');
  if (!bodyNode) return node.text.split('\n')[0];
  return source.slice(node.startIndex, bodyNode.startIndex).trim();
}
