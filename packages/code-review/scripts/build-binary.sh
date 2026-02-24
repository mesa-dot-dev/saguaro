#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTRY="$PKG_DIR/src/cli/bin/index.ts"

VERSION=$(node -e "process.stdout.write(require('$PKG_DIR/package.json').version)")
OUTDIR="${1:-$PKG_DIR/dist/bin}"

mkdir -p "$OUTDIR"

echo "Building mesa v$VERSION → $OUTDIR"

bun build "$ENTRY" --compile --minify \
  --define "__MESA_VERSION__=\"$VERSION\"" \
  --external @swc/wasm \
  --outfile "$OUTDIR/mesa"

WASM_DIR="$OUTDIR/wasm"
mkdir -p "$WASM_DIR"
cp "$(bun -e "process.stdout.write(require.resolve('web-tree-sitter/tree-sitter.wasm'))")" "$WASM_DIR/"
for lang in python go rust java kotlin; do
  cp "$(bun -e "process.stdout.write(require.resolve('tree-sitter-wasms/out/tree-sitter-${lang}.wasm'))")" "$WASM_DIR/"
done

echo ""
echo "Built:"
ls -lh "$OUTDIR/mesa"
echo ""
echo "WASM files:"
ls -lh "$WASM_DIR/"
echo ""
echo "Test with: $OUTDIR/mesa --version"
