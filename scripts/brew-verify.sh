#!/usr/bin/env bash
set -euo pipefail

# Verify the Homebrew release artifact by building a compiled binary
# with sidecar WASM files, matching what CI produces.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT/.release"
VERSION=$(node -e 'process.stdout.write(require("./package.json").version)')

echo "==> Building @mesadev/saguaro v$VERSION"
cd "$ROOT"
bun run build

echo "==> Compiling binary"
bun build src/cli/bin.tsx --compile --minify \
  --define "__SAGUARO_VERSION__=\"$VERSION\"" \
  --external @swc/wasm \
  --outfile "$RELEASE_DIR/sag"
chmod +x "$RELEASE_DIR/sag"

echo "==> Copying WASM files"
mkdir -p "$RELEASE_DIR/wasm"
cp node_modules/web-tree-sitter/tree-sitter.wasm "$RELEASE_DIR/wasm/"
for lang in python go rust java kotlin; do
  cp "node_modules/tree-sitter-wasms/out/tree-sitter-${lang}.wasm" "$RELEASE_DIR/wasm/"
done

echo ""
echo "==> Verifying WASM files"
WASM_OK=true
for f in \
  "$RELEASE_DIR/wasm/tree-sitter.wasm" \
  "$RELEASE_DIR/wasm/tree-sitter-python.wasm" \
  "$RELEASE_DIR/wasm/tree-sitter-go.wasm" \
  "$RELEASE_DIR/wasm/tree-sitter-rust.wasm" \
  "$RELEASE_DIR/wasm/tree-sitter-java.wasm" \
  "$RELEASE_DIR/wasm/tree-sitter-kotlin.wasm"; do
  if [ -f "$f" ]; then
    echo "  OK  $(basename "$f")"
  else
    echo "  MISSING  $(basename "$f")"
    WASM_OK=false
  fi
done

if [ "$WASM_OK" = false ]; then
  echo ""
  echo "FAIL: Missing WASM files."
  exit 1
fi

echo ""
echo "==> Smoke tests"

echo "  sag --help"
"$RELEASE_DIR/sag" --help > /dev/null
echo "  OK"

echo ""
echo "==> Verification complete (v$VERSION)"
echo ""
echo "  Run the verified build:"
echo "    .release/sag --help"
echo "    .release/sag review"
echo "    .release/sag init --force"
