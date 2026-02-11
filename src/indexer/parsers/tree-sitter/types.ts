/**
 * Minimal tree-sitter SyntaxNode interface.
 * Avoids importing the full web-tree-sitter types at the cost of a local definition.
 */
export type SyntaxNode = {
  type: string;
  text: string;
  childCount: number;
  namedChildCount: number;
  startIndex: number;
  child(i: number): SyntaxNode | null;
  namedChild(i: number): SyntaxNode | null;
  childForFieldName(name: string): SyntaxNode | null;
  namedChildren: SyntaxNode[];
  isNamed: boolean;
};

export const MAX_SIGNATURE_LEN = 200;

export function truncate(sig: string | undefined): string | undefined {
  if (!sig) return undefined;
  if (sig.length > MAX_SIGNATURE_LEN) return `${sig.slice(0, MAX_SIGNATURE_LEN - 3)}...`;
  return sig;
}
