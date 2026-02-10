import type {
  BindingIdentifier,
  Class,
  Declaration,
  Fn,
  Module,
  Param,
  ParseOptions,
  Pattern,
  TsEntityName,
  TsExpressionWithTypeArguments,
  TsInterfaceDeclaration,
  TsType,
  TsTypeAliasDeclaration,
  VariableDeclarator,
} from '@swc/core';
import { parseSync } from '@swc/core';
import type { ExportKind, ExportRef, ImportRef, Language, ParseResult } from '../types.js';

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXTENSION_MAP: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
};

function detectLanguage(filePath: string): Language | null {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return null;
  return EXTENSION_MAP[filePath.slice(dot)] ?? null;
}

function buildParseOptions(lang: Language): ParseOptions {
  switch (lang) {
    case 'typescript':
      return { syntax: 'typescript', target: 'esnext', comments: false };
    case 'tsx':
      return { syntax: 'typescript', tsx: true, target: 'esnext', comments: false };
    case 'javascript':
      return { syntax: 'ecmascript', target: 'esnext', comments: false };
    case 'jsx':
      return { syntax: 'ecmascript', jsx: true, target: 'esnext', comments: false };
    default:
      return { syntax: 'ecmascript', target: 'esnext', comments: false };
  }
}

// ---------------------------------------------------------------------------
// Type simplification — turns SWC TsType nodes into readable strings.
// Only handles the common cases; exotic types collapse to "...".
// ---------------------------------------------------------------------------

const MAX_TYPE_LEN = 200;

function simplifyType(typeNode: TsType | undefined | null): string | undefined {
  if (!typeNode) return undefined;
  const result = walkType(typeNode);
  if (result.length > MAX_TYPE_LEN) return `${result.slice(0, MAX_TYPE_LEN - 3)}...`;
  return result;
}

function walkType(node: TsType): string {
  if (!node) return 'unknown';

  switch (node.type) {
    case 'TsKeywordType':
      return node.kind ?? 'unknown';

    case 'TsTypeReference': {
      const name =
        node.typeName?.type === 'Identifier'
          ? node.typeName.value
          : node.typeName?.type === 'TsQualifiedName'
            ? walkQualifiedName(node.typeName)
            : '...';
      if (node.typeParams?.params?.length) {
        return `${name}<${node.typeParams.params.map(walkType).join(', ')}>`;
      }
      return name;
    }

    case 'TsArrayType':
      return `${walkType(node.elemType)}[]`;

    case 'TsUnionType':
      return (node.types ?? []).map(walkType).join(' | ');

    case 'TsIntersectionType':
      return (node.types ?? []).map(walkType).join(' & ');

    case 'TsLiteralType': {
      const lit = node.literal;
      if (lit?.type === 'StringLiteral') return `"${lit.value}"`;
      if (lit?.type === 'NumericLiteral') return String(lit.value);
      if (lit?.type === 'BooleanLiteral') return String(lit.value);
      return 'unknown';
    }

    case 'TsTypeLiteral':
    case 'TsMappedType':
      return '{ ... }';

    case 'TsParenthesizedType':
      return `(${walkType(node.typeAnnotation)})`;

    case 'TsFunctionType':
      return '(...) => ...';

    default:
      return '...';
  }
}

function walkQualifiedName(node: TsEntityName): string {
  if (!node) return '';
  if (node.type === 'Identifier') return node.value;
  if (node.type === 'TsQualifiedName') {
    return `${walkQualifiedName(node.left)}.${node.right?.value ?? ''}`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Signature builders
// ---------------------------------------------------------------------------

function buildFunctionSignature(fn: Fn): string | undefined {
  if (!fn) return undefined;

  const params = (fn.params ?? []).map((p: Param) => formatPattern(p.pat)).join(', ');

  const ret = fn.returnType?.typeAnnotation ? simplifyType(fn.returnType.typeAnnotation) : undefined;

  let sig = `(${params})`;
  if (ret) sig += `: ${ret}`;

  if (sig.length > 200) return `${sig.slice(0, 197)}...`;
  return sig;
}

function formatPattern(pat: Pattern): string {
  if (!pat) return '_';

  switch (pat.type) {
    case 'Identifier': {
      const name = pat.value;
      const optional = pat.optional ? '?' : '';
      const typeAnn = (pat as BindingIdentifier).typeAnnotation?.typeAnnotation;
      if (typeAnn) return `${name}${optional}: ${simplifyType(typeAnn) ?? 'unknown'}`;
      return `${name}${optional}`;
    }
    case 'AssignmentPattern':
      return `${formatPattern(pat.left)} = ...`;
    case 'RestElement':
      return `...${formatPattern(pat.argument)}`;
    case 'ArrayPattern':
      return '[...]';
    case 'ObjectPattern':
      return '{ ... }';
    default:
      return '_';
  }
}

function buildClassSignature(classNode: Class): string | undefined {
  const parts: string[] = [];

  if (classNode.superClass) {
    const superName = classNode.superClass.type === 'Identifier' ? classNode.superClass.value : '...';
    parts.push(`extends ${superName}`);
  }

  const impls = classNode.implements;
  if (impls && impls.length > 0) {
    const names = impls
      .map((impl: TsExpressionWithTypeArguments) => {
        const expr = impl.expression;
        return expr?.type === 'Identifier' ? expr.value : '...';
      })
      .join(', ');
    parts.push(`implements ${names}`);
  }

  if (parts.length === 0) return undefined;
  const sig = parts.join(' ');
  if (sig.length > 200) return `${sig.slice(0, 197)}...`;
  return sig;
}

function buildVariableSignature(declarator: VariableDeclarator): string | undefined {
  const id = declarator.id;
  if (id.type !== 'Identifier') return undefined;
  const typeAnn = (id as BindingIdentifier).typeAnnotation?.typeAnnotation;
  if (!typeAnn) return undefined;
  const t = simplifyType(typeAnn);
  if (!t) return undefined;
  const sig = `: ${t}`;
  if (sig.length > 200) return `${sig.slice(0, 197)}...`;
  return sig;
}

function buildInterfaceSignature(decl: TsInterfaceDeclaration): string | undefined {
  const ext = decl.extends;
  if (!ext || ext.length === 0) return undefined;
  const names = ext
    .map((e: TsExpressionWithTypeArguments) => {
      const expr = e.expression;
      return expr?.type === 'Identifier' ? expr.value : '...';
    })
    .join(', ');
  const sig = `extends ${names}`;
  if (sig.length > 200) return `${sig.slice(0, 197)}...`;
  return sig;
}

function buildTypeAliasSignature(decl: TsTypeAliasDeclaration): string | undefined {
  const typeAnn = decl.typeAnnotation;
  if (!typeAnn) return undefined;
  const t = simplifyType(typeAnn);
  if (!t) return undefined;
  const sig = `= ${t}`;
  if (sig.length > 200) return `${sig.slice(0, 197)}...`;
  return sig;
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

type UnresolvedImport = Omit<ImportRef, 'resolvedPath'>;

function extractImports(ast: Module): UnresolvedImport[] {
  const imports: UnresolvedImport[] = [];

  for (const item of ast.body) {
    if (item.type !== 'ImportDeclaration') continue;

    const source = item.source.value;
    const declTypeOnly = item.typeOnly;

    if (item.specifiers.length === 0) {
      imports.push({
        source,
        symbols: [],
        typeSymbols: [],
        kind: 'side-effect',
        isTypeOnly: false,
      });
      continue;
    }

    const namedValueSymbols: string[] = [];
    const namedTypeSymbols: string[] = [];
    let defaultAlias: string | undefined;
    let namespaceAlias: string | undefined;

    for (const spec of item.specifiers) {
      switch (spec.type) {
        case 'ImportDefaultSpecifier':
          defaultAlias = spec.local.value;
          break;

        case 'ImportNamespaceSpecifier':
          namespaceAlias = spec.local.value;
          break;

        case 'ImportSpecifier': {
          const specTypeOnly = spec.isTypeOnly === true;
          const importedName = spec.imported
            ? spec.imported.type === 'Identifier'
              ? spec.imported.value
              : spec.imported.value
            : spec.local.value;

          if (declTypeOnly || specTypeOnly) {
            namedTypeSymbols.push(importedName);
          } else {
            namedValueSymbols.push(importedName);
          }
          break;
        }
      }
    }

    if (defaultAlias) {
      imports.push({
        source,
        symbols: [],
        typeSymbols: [],
        kind: 'default',
        isTypeOnly: declTypeOnly,
        defaultAlias,
      });
    }

    if (namespaceAlias) {
      imports.push({
        source,
        symbols: [],
        typeSymbols: [],
        kind: 'namespace',
        isTypeOnly: declTypeOnly,
        namespaceAlias,
      });
    }

    if (namedValueSymbols.length > 0 || namedTypeSymbols.length > 0) {
      imports.push({
        source,
        symbols: namedValueSymbols,
        typeSymbols: namedTypeSymbols,
        kind: 'named',
        isTypeOnly: declTypeOnly,
      });
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

function extractExports(ast: Module): ExportRef[] {
  const exports: ExportRef[] = [];

  for (const item of ast.body) {
    switch (item.type) {
      // export function foo() {} / export class Bar {} / export const x = ...
      case 'ExportDeclaration': {
        const ref = exportRefFromDeclaration(item.declaration);
        if (ref) exports.push(ref);
        break;
      }

      // export default function() {} / export default class {}
      case 'ExportDefaultDeclaration': {
        const decl = item.decl;

        if (decl.type === 'FunctionExpression') {
          exports.push({
            name: decl.identifier?.value ?? 'default',
            kind: 'function',
            signature: buildFunctionSignature(decl),
            isDefault: true,
            isTypeOnly: false,
          });
        } else if (decl.type === 'ClassExpression') {
          exports.push({
            name: decl.identifier?.value ?? 'default',
            kind: 'class',
            signature: buildClassSignature(decl),
            isDefault: true,
            isTypeOnly: false,
          });
        } else if (decl.type === 'TsInterfaceDeclaration') {
          exports.push({
            name: decl.id.value,
            kind: 'interface',
            signature: buildInterfaceSignature(decl),
            isDefault: true,
            isTypeOnly: true,
          });
        }
        break;
      }

      // export default <expression>
      case 'ExportDefaultExpression': {
        const expr = item.expression;
        exports.push({
          name: expr.type === 'Identifier' ? expr.value : 'default',
          kind: 'variable',
          isDefault: true,
          isTypeOnly: false,
        });
        break;
      }

      // export { a, b } from 'c'  /  export { a, b }
      case 'ExportNamedDeclaration': {
        const source = item.source?.value;
        const declTypeOnly = item.typeOnly;

        for (const spec of item.specifiers) {
          switch (spec.type) {
            case 'ExportSpecifier': {
              const origName = spec.orig.type === 'Identifier' ? spec.orig.value : spec.orig.value;
              const exportedName = spec.exported
                ? spec.exported.type === 'Identifier'
                  ? spec.exported.value
                  : spec.exported.value
                : origName;
              const specTypeOnly = spec.isTypeOnly === true;

              exports.push({
                name: exportedName,
                kind: source ? 're-export' : 'variable',
                isDefault: false,
                isTypeOnly: declTypeOnly || specTypeOnly,
                reExportSource: source,
              });
              break;
            }

            case 'ExportNamespaceSpecifier': {
              const name = spec.name.type === 'Identifier' ? spec.name.value : spec.name.value;
              exports.push({
                name,
                kind: 're-export',
                isDefault: false,
                isTypeOnly: declTypeOnly,
                reExportSource: source,
              });
              break;
            }

            case 'ExportDefaultSpecifier': {
              exports.push({
                name: spec.exported.value,
                kind: 're-export',
                isDefault: true,
                isTypeOnly: declTypeOnly,
                reExportSource: source,
              });
              break;
            }
          }
        }
        break;
      }

      // export * from 'c'
      case 'ExportAllDeclaration': {
        exports.push({
          name: '*',
          kind: 're-export-all',
          isDefault: false,
          isTypeOnly: 'typeOnly' in item && (item as unknown as { typeOnly: boolean }).typeOnly === true,
          reExportSource: item.source.value,
        });
        break;
      }
    }
  }

  return exports;
}

/**
 * Extract an ExportRef from an exported declaration (export function/class/const/etc).
 */
function exportRefFromDeclaration(decl: Declaration): ExportRef | null {
  switch (decl.type) {
    case 'FunctionDeclaration': {
      const name = decl.identifier?.value ?? '<anonymous>';
      return { name, kind: 'function', signature: buildFunctionSignature(decl), isDefault: false, isTypeOnly: false };
    }
    case 'ClassDeclaration': {
      const name = decl.identifier?.value ?? '<anonymous>';
      return { name, kind: 'class', signature: buildClassSignature(decl), isDefault: false, isTypeOnly: false };
    }
    case 'VariableDeclaration': {
      const firstDecl = decl.declarations?.[0];
      if (!firstDecl) return null;
      const name = firstDecl.id?.type === 'Identifier' ? firstDecl.id.value : null;
      if (!name) return null;
      const kind: ExportKind = decl.kind === 'const' ? 'constant' : 'variable';
      return { name, kind, signature: buildVariableSignature(firstDecl), isDefault: false, isTypeOnly: false };
    }
    case 'TsInterfaceDeclaration': {
      const name = decl.id?.value ?? '<anonymous>';
      return { name, kind: 'interface', signature: buildInterfaceSignature(decl), isDefault: false, isTypeOnly: true };
    }
    case 'TsTypeAliasDeclaration': {
      const name = decl.id?.value ?? '<anonymous>';
      return { name, kind: 'type', signature: buildTypeAliasSignature(decl), isDefault: false, isTypeOnly: true };
    }
    case 'TsEnumDeclaration': {
      const name = decl.id?.value ?? '<anonymous>';
      return { name, kind: 'enum', isDefault: false, isTypeOnly: false };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// SwcParser class
// ---------------------------------------------------------------------------

export class SwcParser {
  parse(filePath: string, content: string): ParseResult {
    const language = detectLanguage(filePath);
    if (!language) {
      return { language: 'unknown', imports: [], exports: [] };
    }

    const options = buildParseOptions(language);
    const ast = parseSync(content, options) as Module;

    const imports = extractImports(ast);
    const exports = extractExports(ast);

    return { language, imports, exports };
  }
}
