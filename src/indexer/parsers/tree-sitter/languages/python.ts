import type { ExportRef, ParseResult } from '../../../types.js';
import type { SyntaxNode } from '../common.js';
import { truncate } from '../common.js';
import { createParser } from '../init.js';

type UnresolvedImport = ParseResult['imports'][number];

/**
 * Extract imports and exports from Python source code using tree-sitter.
 */
export async function extractPython(source: string): Promise<ParseResult> {
  const parser = await createParser('python');
  const tree = parser.parse(source)!;
  try {
    const root = tree.rootNode as unknown as SyntaxNode;

    const imports = extractImports(root);
    const exports = extractExports(root, source);

    return { language: 'python', imports, exports };
  } finally {
    tree.delete();
    parser.delete();
  }
}

function extractImports(root: SyntaxNode): UnresolvedImport[] {
  const imports: UnresolvedImport[] = [];

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i);
    if (!node) continue;

    if (node.type === 'import_statement') {
      // import os / import os.path
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        imports.push({ source: nameNode.text, symbols: [], kind: 'namespace' });
      }
    } else if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName('module_name');
      const moduleName = moduleNode ? moduleNode.text : '';

      // Check for wildcard: from foo import *
      if (hasChildType(node, 'wildcard_import')) {
        imports.push({ source: moduleName, symbols: [], kind: 'wildcard' });
        continue;
      }

      // Named imports: from foo import bar, baz, Config as Cfg
      // Skip children that are the module_name by comparing startIndex
      const moduleStart = moduleNode?.startIndex ?? -1;
      const symbols: string[] = [];
      for (let j = 0; j < node.childCount; j++) {
        const child = node.child(j);
        if (!child || !child.isNamed) continue;

        // Skip the module_name node
        if (child.startIndex === moduleStart) continue;

        if (child.type === 'dotted_name') {
          symbols.push(child.text);
        } else if (child.type === 'aliased_import') {
          // Use the original name, not the alias
          const nameChild = child.childForFieldName('name');
          if (nameChild) symbols.push(nameChild.text);
        }
      }

      imports.push({ source: moduleName, symbols, kind: 'named' });
    }
  }

  return imports;
}

function extractExports(root: SyntaxNode, source: string): ExportRef[] {
  const exports: ExportRef[] = [];

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i);
    if (!node) continue;

    switch (node.type) {
      case 'function_definition': {
        const ref = extractFunctionExport(node, source);
        if (ref) exports.push(ref);
        break;
      }

      case 'class_definition': {
        const ref = extractClassExport(node);
        if (ref) exports.push(ref);
        break;
      }

      case 'decorated_definition': {
        // @decorator\ndef foo(): or @decorator\nclass Foo:
        for (const child of node.namedChildren) {
          if (child.type === 'function_definition') {
            const ref = extractFunctionExport(child, source);
            if (ref) exports.push(ref);
          } else if (child.type === 'class_definition') {
            const ref = extractClassExport(child);
            if (ref) exports.push(ref);
          }
        }
        break;
      }

      case 'expression_statement': {
        // Top-level assignments: MY_VAR = value or MY_VAR: type = value
        const expr = node.namedChild(0);
        if (expr?.type === 'assignment') {
          const left = expr.childForFieldName('left');
          if (left?.type === 'identifier') {
            exports.push({
              name: left.text,
              kind: 'variable',
              isDefault: false,
              isTypeOnly: false,
            });
          }
        }
        break;
      }
    }
  }

  return exports;
}

function extractFunctionExport(node: SyntaxNode, source: string): ExportRef | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  return {
    name: nameNode.text,
    kind: 'function',
    signature: truncate(extractFunctionSignature(node, source)),
    isDefault: false,
    isTypeOnly: false,
  };
}

function extractClassExport(node: SyntaxNode): ExportRef | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const superclasses = node.childForFieldName('superclasses');

  return {
    name: nameNode.text,
    kind: 'class',
    signature: superclasses ? truncate(superclasses.text) : undefined,
    isDefault: false,
    isTypeOnly: false,
  };
}

/**
 * Extract the function signature — everything from start of the node to the colon before the body.
 */
function extractFunctionSignature(node: SyntaxNode, source: string): string {
  const bodyNode = node.childForFieldName('body');
  if (!bodyNode) return '';

  // Walk backwards from body to find the colon
  const sig = source.slice(node.startIndex, bodyNode.startIndex);
  // Remove trailing colon and whitespace
  return sig.replace(/:\s*$/, '').trim();
}

function hasChildType(node: SyntaxNode, type: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.type === type) return true;
  }
  return false;
}
