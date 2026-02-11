import type { ExportKind, ExportRef, ParseResult } from '../../../types.js';
import { createParser } from '../init.js';
import type { SyntaxNode } from '../types.js';
import { truncate } from '../types.js';

type UnresolvedImport = ParseResult['imports'][number];

export async function extractJava(source: string): Promise<ParseResult> {
  const parser = await createParser('java');
  const tree = parser.parse(source)!;
  try {
    const root = tree.rootNode as unknown as SyntaxNode;

    const imports = extractImports(root);
    const exports = extractExports(root, source);

    return { language: 'java', imports, exports };
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
    if (node?.type !== 'import_declaration') continue;

    const imp = parseImportDeclaration(node);
    if (imp) imports.push(imp);
  }

  return imports;
}

/**
 * Parse a Java import declaration.
 *
 * Examples:
 *   import com.example.Foo;           → source=com.example, symbols=[Foo], kind=named
 *   import com.example.*;             → source=com.example, symbols=[], kind=wildcard
 *   import static com.example.Foo.bar → source=com.example.Foo, symbols=[bar], kind=named
 */
function parseImportDeclaration(node: SyntaxNode): UnresolvedImport | null {
  // The full text is something like "import com.example.Foo;" or "import static com.example.Foo.bar;"
  // We need to find the scoped_identifier or the asterisk child.
  let isWildcard = false;

  // Look for asterisk child (wildcard import)
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'asterisk') {
      isWildcard = true;
      break;
    }
  }

  // Find the scoped_identifier — this holds the full dotted path
  let scopedNode: SyntaxNode | null = null;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'scoped_identifier') {
      scopedNode = child;
      break;
    }
  }

  if (isWildcard && scopedNode) {
    // import com.example.* → scopedNode is "com.example"
    return { source: scopedNode.text, symbols: [], kind: 'wildcard' };
  }

  if (scopedNode) {
    // import com.example.Foo → split on last dot
    const fullPath = scopedNode.text;
    const lastDot = fullPath.lastIndexOf('.');
    if (lastDot === -1) {
      return { source: fullPath, symbols: [], kind: 'named' };
    }
    const source = fullPath.slice(0, lastDot);
    const symbol = fullPath.slice(lastDot + 1);
    return { source, symbols: [symbol], kind: 'named' };
  }

  // Fallback: simple identifier import (rare, e.g. import Foo;)
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'identifier') {
      return { source: '', symbols: [child.text], kind: 'named' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

const DECLARATION_KIND_MAP: Record<string, ExportKind> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'enum',
  record_declaration: 'class',
};

function extractExports(root: SyntaxNode, source: string): ExportRef[] {
  const exports: ExportRef[] = [];

  for (let i = 0; i < root.namedChildCount; i++) {
    const node = root.namedChild(i);
    if (!node) continue;

    const kind = DECLARATION_KIND_MAP[node.type];
    if (!kind) continue;
    if (!hasPublicModifier(node)) continue;

    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    exports.push({
      name: nameNode.text,
      kind,
      signature: truncate(extractClassSignature(node, source)),
      isDefault: false,
      isTypeOnly: false,
    });
  }

  return exports;
}

/**
 * Check if a declaration has a `public` modifier.
 * Java: modifiers node contains individual modifier keywords.
 */
function hasPublicModifier(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === 'modifiers') {
      for (let j = 0; j < child.childCount; j++) {
        if (child.child(j)?.text === 'public') return true;
      }
    }
  }
  return false;
}

/**
 * Extract class/interface signature — superclass and implements clauses.
 * Returns text like "extends Base implements Foo, Bar" or undefined.
 */
function extractClassSignature(node: SyntaxNode, _source: string): string | undefined {
  const parts: string[] = [];

  const superclass = node.childForFieldName('superclass');
  if (superclass) parts.push(`extends ${superclass.text}`);

  const interfaces = node.childForFieldName('interfaces');
  if (interfaces) parts.push(`implements ${interfaces.text}`);

  return parts.length > 0 ? parts.join(' ') : undefined;
}
