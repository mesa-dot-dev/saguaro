import type { ExportKind, ExportRef, ParseResult } from '../../../types.js';
import { createParser } from '../init.js';
import type { SyntaxNode } from '../types.js';
import { truncate } from '../types.js';

type UnresolvedImport = ParseResult['imports'][number];

export async function extractKotlin(source: string): Promise<ParseResult> {
  const parser = await createParser('kotlin');
  const tree = parser.parse(source)!;
  try {
    const root = tree.rootNode as unknown as SyntaxNode;

    const imports = extractImports(root);
    const exports = extractExports(root, source);

    return { language: 'kotlin', imports, exports };
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
    const child = root.namedChild(i);
    if (!child) continue;

    if (child.type === 'import_list') {
      // Grouped imports: iterate import_header children
      for (let j = 0; j < child.namedChildCount; j++) {
        const header = child.namedChild(j);
        if (header?.type === 'import_header') {
          const imp = parseImportHeader(header);
          if (imp) imports.push(imp);
        }
      }
    } else if (child.type === 'import_header') {
      // Standalone import (rare but valid)
      const imp = parseImportHeader(child);
      if (imp) imports.push(imp);
    }
  }

  return imports;
}

/**
 * Parse a Kotlin import header.
 *
 * Examples:
 *   import com.example.Foo       → source=com.example, symbols=[Foo], kind=named
 *   import com.example.*         → source=com.example, symbols=[], kind=wildcard
 *   import com.example.Foo as Bar → source=com.example, symbols=[Foo], kind=named
 */
function parseImportHeader(node: SyntaxNode): UnresolvedImport | null {
  // Check for wildcard import
  let isWildcard = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.text === '*') {
      isWildcard = true;
      break;
    }
  }

  // Find the identifier (dotted path)
  const identNode = findChildByType(node, 'identifier');
  if (!identNode) return null;

  const fullPath = identNode.text;

  if (isWildcard) {
    return { source: fullPath, symbols: [], kind: 'wildcard' };
  }

  // Split on last dot to separate source from symbol
  const lastDot = fullPath.lastIndexOf('.');
  if (lastDot === -1) {
    return { source: fullPath, symbols: [], kind: 'named' };
  }

  const source = fullPath.slice(0, lastDot);
  const symbol = fullPath.slice(lastDot + 1);
  return { source, symbols: [symbol], kind: 'named' };
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

/**
 * Kotlin tree-sitter grammar does NOT use field names for most nodes.
 * We find names by looking for child node types:
 *   class_declaration / object_declaration → type_identifier
 *   function_declaration → simple_identifier
 *   property_declaration → variable_declaration → simple_identifier
 */
function extractExports(root: SyntaxNode, source: string): ExportRef[] {
  const exports: ExportRef[] = [];

  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) continue;

    switch (child.type) {
      case 'class_declaration': {
        if (isPrivateOrInternal(child)) break;
        const nameNode = findChildByType(child, 'type_identifier');
        if (!nameNode) break;
        const kind: ExportKind = hasKeywordChild(child, 'interface') ? 'interface' : 'class';
        exports.push({
          name: nameNode.text,
          kind,
          signature: truncate(extractClassSignature(child)),
          isDefault: false,
          isTypeOnly: false,
        });
        break;
      }

      case 'object_declaration': {
        if (isPrivateOrInternal(child)) break;
        const nameNode = findChildByType(child, 'type_identifier');
        if (!nameNode) break;
        exports.push({
          name: nameNode.text,
          kind: 'class',
          isDefault: false,
          isTypeOnly: false,
        });
        break;
      }

      case 'function_declaration': {
        if (isPrivateOrInternal(child)) break;
        const nameNode = findChildByType(child, 'simple_identifier');
        if (!nameNode) break;
        exports.push({
          name: nameNode.text,
          kind: 'function',
          signature: truncate(extractFunctionSignature(child, source)),
          isDefault: false,
          isTypeOnly: false,
        });
        break;
      }

      case 'property_declaration': {
        if (isPrivateOrInternal(child)) break;
        const varDecl = findChildByType(child, 'variable_declaration');
        const nameNode = varDecl ? findChildByType(varDecl, 'simple_identifier') : null;
        if (!nameNode) break;
        exports.push({
          name: nameNode.text,
          kind: 'variable',
          isDefault: false,
          isTypeOnly: false,
        });
        break;
      }
    }
  }

  return exports;
}

/**
 * Check if a declaration has `private` or `internal` visibility modifier.
 * Kotlin defaults to `public`, so we only skip if explicitly restricted.
 */
function isPrivateOrInternal(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === 'modifiers') {
      for (let j = 0; j < child.childCount; j++) {
        const mod = child.child(j);
        if (mod?.type === 'visibility_modifier') {
          const text = mod.text;
          if (text === 'private' || text === 'internal') return true;
        }
      }
    }
  }
  return false;
}

function findChildByType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === type) return child;
  }
  return null;
}

function hasKeywordChild(node: SyntaxNode, keyword: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.text === keyword) return true;
  }
  return false;
}

/**
 * Extract class/interface signature — delegation specifiers (superclass/interfaces).
 */
function extractClassSignature(node: SyntaxNode): string | undefined {
  const delegation = findChildByType(node, 'delegation_specifier');
  return delegation ? delegation.text : undefined;
}

/**
 * Extract function signature — everything before the body.
 */
function extractFunctionSignature(node: SyntaxNode, source: string): string | undefined {
  const bodyNode = findChildByType(node, 'function_body');
  if (!bodyNode) return node.text.split('\n')[0];
  return source.slice(node.startIndex, bodyNode.startIndex).trim();
}
